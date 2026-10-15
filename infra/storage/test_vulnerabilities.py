#!/usr/bin/env python3
"""Проверяет границы acquisition и агрегации двух storage source scans."""

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infra/scripts"))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gate = load(ROOT / "infra/storage/check-vulnerabilities.py", "storage_gate")
application = load(ROOT / "infra/scripts/check-go-vuln.py", "application_gate")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class StorageGateTests(unittest.TestCase):
    def test_unsafe_archive_members_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, (name, kind) in enumerate((
                ("source/../../escape", tarfile.REGTYPE),
                ("/source/escape", tarfile.REGTYPE),
                ("source/link", tarfile.SYMTYPE),
                ("source/link", tarfile.LNKTYPE),
            )):
                with self.subTest(name=name, kind=kind):
                    archive = root / (str(index) + ".tar.gz")
                    with tarfile.open(archive, "w:gz") as bundle:
                        member = tarfile.TarInfo(name)
                        member.type = kind
                        member.linkname = "../../escape"
                        bundle.addfile(member)
                    with self.assertRaises(ValueError):
                        gate.extract(archive, root / str(index))
            self.assertFalse((root / "escape").exists())

    def run_components(self, failure):
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            root = temporary / "source"
            storage = root / "infra/storage"
            storage.mkdir(parents=True)
            components = {}
            archives = {}
            for name in ("minio", "mc"):
                deps = storage / "deps" / name
                deps.mkdir(parents=True)
                for filename in ("go.mod", "go.sum"):
                    (deps / filename).write_text("effective " + filename)
                archive = temporary / (name + ".tar.gz")
                with tarfile.open(archive, "w:gz") as bundle:
                    for filename in ("go.mod", "go.sum", "main.go"):
                        data = ("original " + filename).encode()
                        member = tarfile.TarInfo("upstream/" + filename)
                        member.size = len(data)
                        bundle.addfile(member, io.BytesIO(data))
                if name == "minio" and failure == "archive":
                    archive.write_bytes(b"corrupted tar fixture")
                archives[name] = archive
                components[name] = {
                    "upstream": {"commit": "a" * 40, "archiveSha256": digest(archive)},
                    "effectiveModuleHashes": {f: digest(deps / f) for f in ("go.mod", "go.sum")},
                }
            manifest = {"goVersion": "1.27.2", "govulncheckVersion": "1.7.0", "compilerImage": "pinned", "components": components}
            (storage / "maintenance.json").write_text(json.dumps(manifest))
            tools = {"go_version": "1.27.2", "govulncheck_version": "1.7.0", "go_builder_image": "pinned"}
            app = SimpleNamespace(pins=lambda _: tools, DATABASE=application.DATABASE, parse_stream=application.parse_stream, module_passed=application.module_passed)
            maintenance = SimpleNamespace(validate=lambda *_: "manifest", digest=digest, verify_original=lambda *_: None)
            output = temporary / "evidence"
            called = []

            def acquire(name, _commit, destination, _cached):
                destination.write_bytes(archives[name].read_bytes())

            def execute(command, source, environment, evidence, name, timeout):
                called.append(name)
                self.assertEqual(environment["GOOS"], "linux")
                self.assertEqual(environment["GOARCH"], "arm64")
                if name == "minio" and failure == "process":
                    raise subprocess.TimeoutExpired(command, timeout)
                config = {"protocol_version": "v1.0.0", "scanner_name": "govulncheck", "scanner_version": "v1.7.0", "go_version": "go1.27.2", "db": application.DATABASE, "scan_level": "symbol", "scan_mode": "source"}
                messages = [{"config": config}, {"SBOM": {"go_version": "go1.27.2", "roots": [name]}}]
                if name == "minio" and failure == "called":
                    messages.append({"finding": {"osv": "GO-2026-1234", "trace": [{"module": name, "function": "Reachable"}]}})
                if name == "minio" and failure in ("source", "module"):
                    (source / ("main.go" if failure == "source" else "go.mod")).write_text("mutation")
                return subprocess.CompletedProcess(command, 0, "\n".join(json.dumps(m) for m in messages), "")

            argv = ["gate", "--source-sha", "a" * 40, "--scanner", "/unused/scanner", "--output-dir", str(output), "--goarch", "arm64"]
            with patch.object(gate, "__file__", str(storage / "check-vulnerabilities.py")), patch.object(gate, "clean", return_value=True), patch.object(gate, "load", side_effect=[app, maintenance]), patch.object(gate, "acquire", side_effect=acquire), patch.object(gate, "execute", side_effect=execute), patch.object(gate.subprocess, "check_output", return_value="go1.27.2\n"), patch.object(sys, "argv", argv):
                with self.assertRaises(ValueError):
                    gate.main()
            status = json.loads((output / "status.json").read_text())
            self.assertEqual(called, ["mc"] if failure == "archive" else ["minio", "mc"])
            self.assertFalse(status["ok"])
            self.assertFalse(status["components"]["minio"]["ok"])
            self.assertTrue(status["components"]["mc"]["ok"])
            return status

    def test_first_scan_failure_preserves_second_result(self):
        status = self.run_components("process")
        self.assertIn("official-source-scan", status["components"]["minio"]["error"])

    def test_corrupted_archive_preserves_second_result(self):
        status = self.run_components("archive")
        self.assertIn("source-acquisition", status["components"]["minio"]["error"])

    def test_exit_zero_called_finding_fails_whole_gate(self):
        status = self.run_components("called")
        self.assertEqual(status["components"]["minio"]["called"], ["GO-2026-1234"])

    def test_scanner_source_mutation_fails_whole_gate(self):
        status = self.run_components("source")
        self.assertFalse(status["components"]["minio"]["sourceCodeUnchanged"])

    def test_scanner_module_mutation_fails_whole_gate(self):
        status = self.run_components("module")
        self.assertFalse(status["components"]["minio"]["effectiveModuleUnchanged"])


if __name__ == "__main__":
    unittest.main()
