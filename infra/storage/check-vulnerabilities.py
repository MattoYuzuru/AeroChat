#!/usr/bin/env python3
"""Проверяет обе storage source closure на exact SHA до сборки image."""

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import urllib.request


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fingerprint(root):
    files = [(str(p.relative_to(root)), hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(root.rglob("*")) if p.is_file() and str(p.relative_to(root)) not in ("go.mod", "go.sum")]
    return hashlib.sha256(json.dumps(files, separators=(",", ":")).encode()).hexdigest()


def clean(root, head):
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip() == head and not subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip()


def acquire(name, commit, archive, cached):
    if cached:
        shutil.copyfile(cached / (name + "-source.tar.gz"), archive)
        return
    url = "https://codeload.github.com/minio/" + name + "/tar.gz/" + commit
    with urllib.request.urlopen(url, timeout=120) as response, archive.open("xb") as target:
        size = 0
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > 64 * 1024 * 1024:
                raise ValueError("Source archive size exceeded")
            target.write(chunk)


def extract(archive, source):
    source.mkdir(mode=0o700)
    with tarfile.open(archive) as bundle:
        expanded = 0
        for member in bundle:
            parts = Path(member.name).parts
            if len(parts) <= 1:
                continue
            if Path(member.name).is_absolute() or ".." in parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise ValueError("Unsupported archive member")
            expanded += member.size
            if expanded > 512 * 1024 * 1024:
                raise ValueError("Expanded source limit exceeded")
            member.name = str(Path(*parts[1:]))
            bundle.extract(member, source, filter="data")


def execute(command, source, environment, output, name, timeout):
    process = subprocess.Popen(command, cwd=source, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            stdout, stderr = process.communicate()
        (output / (name + ".json")).write_text(stdout)
        (output / (name + ".stderr")).write_text(stderr)
        raise
    (output / (name + ".json")).write_text(stdout)
    (output / (name + ".stderr")).write_text(stderr)
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--source-sha", required=True)
    args.add_argument("--scanner", type=Path, required=True)
    args.add_argument("--output-dir", type=Path, required=True)
    args.add_argument("--archives-directory", type=Path)
    args.add_argument("--goarch", choices=("amd64", "arm64"), required=True)
    options = args.parse_args()
    root = Path(__file__).resolve().parents[2]
    if not re.fullmatch(r"[0-9a-f]{40}", options.source_sha) or not clean(root, options.source_sha):
        raise ValueError("Storage gate requires exact clean source")
    output = options.output_dir.resolve()
    if output.is_relative_to(root):
        raise ValueError("Evidence must remain outside source checkout")
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    sys.path.insert(0, str(root / "infra/scripts"))
    application = load(root / "infra/scripts/check-go-vuln.py", "application_vuln")
    maintenance = load(root / "infra/storage/verify-maintenance.py", "storage_maintenance")
    manifest = json.loads((root / "infra/storage/maintenance.json").read_text())
    digest = maintenance.validate(manifest, root / "infra/storage")
    tools = application.pins(root)
    if tools["go_version"] != manifest["goVersion"] or tools["govulncheck_version"] != manifest["govulncheckVersion"] or tools["go_builder_image"] != manifest["compilerImage"]:
        raise ValueError("Application/storage tool pins disagree")
    environment = dict(os.environ, GOTOOLCHAIN="local", GOWORK="off", GOFLAGS="-mod=readonly", CGO_ENABLED="0", GOMAXPROCS="2", GOOS="linux", GOARCH=options.goarch, GOSUMDB="sum.golang.org", GOPROXY="https://proxy.golang.org,direct")
    actual = subprocess.check_output(["go", "env", "GOVERSION"], env=environment, text=True).strip()
    if actual != "go" + tools["go_version"]:
        raise ValueError("Actual source compiler differs from maintained pins")
    scanner = str(options.scanner.resolve())
    status = {"sourceSha": options.source_sha, "manifestDigest": digest, "goVersion": actual, "goos": "linux", "goarch": options.goarch, "database": application.DATABASE, "startedAt": datetime.now(timezone.utc).isoformat(), "components": {}}
    def save():
        (output / "status.json").write_text(json.dumps(status, indent=2) + "\n")
    for name, metadata in manifest["components"].items():
        entry = {"ok": False}
        status["components"][name] = entry
        archive = output / (name + "-source.tar.gz")
        source = output / name
        before = None
        stage = "source-acquisition"
        try:
            acquire(name, metadata["upstream"]["commit"], archive, options.archives_directory)
            if maintenance.digest(archive) != metadata["upstream"]["archiveSha256"]:
                raise ValueError("Archive checksum mismatch")
            extract(archive, source)
            stage = "original-provenance"
            maintenance.verify_original(manifest, name, source, archive)
            before = fingerprint(source)
            stage = "effective-overlay"
            for filename, expected in metadata["effectiveModuleHashes"].items():
                shutil.copyfile(root / "infra/storage/deps" / name / filename, source / filename)
                if maintenance.digest(source / filename) != expected:
                    raise ValueError("Effective overlay mismatch")
            stage = "official-source-scan"
            result = execute([scanner, "-format=json", "-mode=source", "-scan=symbol", "-db", application.DATABASE, "./..."], source, environment, output, name, 300)
            entry["scanExit"] = result.returncode
            entry.update(application.parse_stream(result.stdout, tools["go_version"], tools["govulncheck_version"]))
            entry["ok"] = application.module_passed(result.returncode, entry)
        except (OSError, ValueError, TypeError, KeyError, tarfile.TarError, subprocess.SubprocessError) as error:
            entry["error"] = stage + ": " + str(error)
        finally:
            try:
                entry["sourceCodeUnchanged"] = before is not None and fingerprint(source) == before
                entry["effectiveModuleUnchanged"] = all(maintenance.digest(source / f) == expected for f, expected in metadata["effectiveModuleHashes"].items())
            except OSError:
                entry["sourceCodeUnchanged"] = False
                entry["effectiveModuleUnchanged"] = False
            entry["ok"] = entry["ok"] and entry["sourceCodeUnchanged"] and entry["effectiveModuleUnchanged"]
            save()
        print(name + ": " + ("source gate PASS" if entry["ok"] else "source gate FAIL; evidence retained"))
    status["sourceUnchanged"] = clean(root, options.source_sha)
    status["ok"] = status["sourceUnchanged"] and len(status["components"]) == 2 and all(e["ok"] for e in status["components"].values())
    status["finishedAt"] = datetime.now(timezone.utc).isoformat()
    save()
    if not status["ok"]:
        raise ValueError("Storage source findings/infrastructure failure")


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, tarfile.TarError, subprocess.SubprocessError) as error:
        print("Storage source gate failed: " + str(error), file=sys.stderr)
        sys.exit(1)
