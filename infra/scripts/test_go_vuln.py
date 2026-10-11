#!/usr/bin/env python3
"""Проверяет fail-closed scanner evidence и source pin drift без network/Go compilation."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

from go_lifecycle import MODULES, check


spec = importlib.util.spec_from_file_location("vulnerability_gate", Path(__file__).with_name("check-go-vuln.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def stream(*messages):
    return "\n".join(json.dumps(message, indent=2) for message in messages)


def config():
    return {"config": {"protocol_version": "v1.0.0", "scanner_name": "govulncheck", "scanner_version": "v1.7.0", "go_version": "go1.27.2", "db": "https://vuln.go.dev", "scan_level": "symbol", "scan_mode": "source"}}


def sbom():
    return {"SBOM": {"go_version": "go1.27.2", "roots": ["fixture/package"]}}


class VulnerabilityGateTests(unittest.TestCase):
    def test_called_json_finding_with_exit_zero_still_fails(self):
        finding = {"finding": {"osv": "GO-2026-5004", "trace": [{"function": "SanitizeSQL", "module": "fixture/module"}, {"function": "Query"}]}}
        value = gate.parse_stream(stream(config(), sbom(), finding), "1.27.2", "1.7.0")
        self.assertEqual(value["called"], ["GO-2026-5004"])
        self.assertFalse(gate.module_passed(0, value))
        self.assertFalse(gate.module_passed(3, value))

    def test_imported_candidate_is_reported_separately_from_called(self):
        finding = {"finding": {"osv": "GO-2026-5004", "trace": [{"module": "fixture/module", "package": "fixture/package"}]}}
        value = gate.parse_stream(stream(config(), sbom(), finding), "1.27.2", "1.7.0")
        self.assertEqual(value["candidates"], ["GO-2026-5004"])
        self.assertEqual(value["called"], [])
        self.assertTrue(gate.module_passed(0, value))
        self.assertFalse(gate.module_passed(3, value))
        self.assertFalse(gate.module_passed(1, value))

    def test_missing_malformed_and_wrong_baseline_are_not_green(self):
        for data in ("", "No vulnerabilities found", stream(config()), stream(sbom()), stream(config(), sbom()) + "malformed"):
            with self.assertRaises(ValueError):
                gate.parse_stream(data, "1.27.2", "1.7.0")
        for key, wrong in (("go_version", "go1.25.8"), ("db", "file:///empty"), ("scanner_version", "devel"), ("scan_level", "module")):
            changed = config()
            changed["config"][key] = wrong
            with self.assertRaises(ValueError):
                gate.parse_stream(stream(changed, sbom()), "1.27.2", "1.7.0")
        invalid_traces = ([{}], [{"module": ""}], [{"module": False}],
                          [{"module": "fixture/module"}, {"function": "Query"}],
                          [{"module": "fixture/module", "function": False}],
                          [{"module": "fixture/module", "function": "Vulnerable"}, {"function": False}])
        for trace in invalid_traces:
            with self.subTest(trace=trace), self.assertRaises(ValueError):
                malformed = {"finding": {"osv": "GO-2026-5004", "trace": trace}}
                gate.parse_stream(stream(config(), sbom(), malformed), "1.27.2", "1.7.0")

    def test_source_versions_and_builder_digest_cannot_drift_silently(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "infra").mkdir()
            baseline = {"go_version": "1.27.2", "golangci_lint_version": "2.14.0", "govulncheck_version": "1.7.0", "go_builder_image": "golang:1.27.2-alpine3.24@sha256:" + "a" * 64}
            (root / "infra/go-toolchain.json").write_text(json.dumps(baseline))
            (root / "go.work").write_text("go 1.27.2\n\nuse (\n" + "\n".join("\t./" + module for module in MODULES) + "\n)\n")
            for module in MODULES:
                path = root / module
                path.mkdir(parents=True)
                (path / "go.mod").write_text("module fixture\n\ngo 1.27.2\n")
                if module.startswith("services/"):
                    (path / "Dockerfile").write_text("FROM " + baseline["go_builder_image"] + " AS builder\n")
            with contextlib.redirect_stdout(io.StringIO()):
                check(root)
            target = root / "services/aero-chat/go.mod"
            target.write_text("module fixture\n\ngo 1.25.0\n")
            with self.assertRaises(ValueError):
                check(root)
            target.write_text("module fixture\n\ngo 1.27.2\n")
            (root / "services/aero-chat/Dockerfile").write_text("FROM golang:1.27.2-alpine AS builder\n")
            with self.assertRaises(ValueError):
                check(root)


if __name__ == "__main__":
    unittest.main()
