#!/usr/bin/env python3
"""Сканирует все workspace modules на exact clean SHA без маскирования missing/failed checks."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

from go_lifecycle import MODULES, check, pins


DATABASE = "https://vuln.go.dev"


def parse_stream(data, expected_go, expected_scanner):
    decoder = json.JSONDecoder()
    messages = []
    offset = 0
    while offset < len(data):
        if data[offset].isspace():
            offset += 1
            continue
        message, offset = decoder.raw_decode(data, offset)
        if not isinstance(message, dict) or len(message) != 1 or next(iter(message)) not in ("config", "SBOM", "progress", "osv", "finding"):
            raise ValueError("Некорректный govulncheck JSON protocol message")
        messages.append(message)
    if not messages or "config" not in messages[0]:
        raise ValueError("Missing scanner configuration")
    configs = [message["config"] for message in messages if "config" in message]
    if len(configs) != 1 or not isinstance(configs[0], dict):
        raise ValueError("Некорректная scanner configuration")
    config = configs[0]
    expected = {"protocol_version": "v1.0.0", "scanner_name": "govulncheck", "scanner_version": "v" + expected_scanner, "go_version": "go" + expected_go, "db": DATABASE, "scan_level": "symbol", "scan_mode": "source"}
    if any(config.get(key) != value for key, value in expected.items()):
        raise ValueError("Scanner toolchain/database/mode не соответствует pinned baseline")
    sbom = [message["SBOM"] for message in messages if "SBOM" in message]
    if len(sbom) != 1 or not isinstance(sbom[0], dict) or sbom[0].get("go_version") != "go" + expected_go or not isinstance(sbom[0].get("roots"), list) or not sbom[0]["roots"] or any(not isinstance(root, str) or not root for root in sbom[0]["roots"]):
        raise ValueError("Missing/wrong module SBOM/root analysis")
    candidates, called = set(), set()
    for message in messages:
        if "finding" not in message:
            continue
        finding = message["finding"]
        if not isinstance(finding, dict) or not isinstance(finding.get("osv"), str) or not re.fullmatch(r"GO-[0-9]{4}-[0-9]+", finding["osv"]):
            raise ValueError("Malformed vulnerability finding")
        trace = finding.get("trace")
        if not isinstance(trace, list) or not trace or any(not isinstance(frame, dict) for frame in trace):
            raise ValueError("Finding без typed trace")
        candidates.add(finding["osv"])
        if "function" in trace[0] and not isinstance(trace[0]["function"], str):
            raise ValueError("Некорректный symbol trace")
        if trace[0].get("function"):
            called.add(finding["osv"])
    return {"candidates": sorted(candidates), "called": sorted(called), "db_last_modified": config.get("db_last_modified")}


def module_passed(exit_code, parsed):
    # JSON mode может вернуть0 при findings: threshold проверяется по symbol traces тоже.
    return exit_code == 0 and not parsed["called"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--scanner", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    if not re.fullmatch(r"[0-9a-f]{40}", args.source_sha):
        raise ValueError("Нужен exact source SHA")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip()
    if head != args.source_sha or dirty:
        raise ValueError("Scanner требует frozen clean checkout выбранного SHA")
    check(root)
    baseline = pins(root)
    actual_go = subprocess.check_output(["go", "env", "GOVERSION"], cwd=root, text=True).strip()
    if actual_go != "go" + baseline["go_version"]:
        raise ValueError("Actual Go не соответствует baseline")
    output = args.output_dir.resolve()
    if output.is_relative_to(root):
        raise ValueError("Scanner evidence должен храниться вне source tree")
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    scanner = str(Path(args.scanner).resolve())
    environment = dict(os.environ, GOWORK="off")
    status = {"source_sha": head, "go_version": actual_go, "scanner_version": baseline["govulncheck_version"], "database": DATABASE, "goos": subprocess.check_output(["go", "env", "GOOS"], text=True).strip(), "goarch": subprocess.check_output(["go", "env", "GOARCH"], text=True).strip(), "started_at": datetime.now(timezone.utc).isoformat(), "modules": {}}
    for module in MODULES:
        name = module.replace("/", "-")
        entry = {"ok": False}
        try:
            result = subprocess.run([scanner, "-format=json", "-mode=source", "-scan=symbol", "-db", DATABASE, "./..."], cwd=root / module, env=environment, capture_output=True, text=True, timeout=300)
            (output / (name + ".json")).write_text(result.stdout)
            (output / (name + ".stderr")).write_text(result.stderr)
            entry["exit_code"] = result.returncode
            parsed = parse_stream(result.stdout, baseline["go_version"], baseline["govulncheck_version"])
            entry.update(parsed)
            entry["ok"] = module_passed(result.returncode, parsed)
        except (ValueError, TypeError, KeyError):
            entry["error"] = "invalid/missing scanner JSON evidence"
        except subprocess.TimeoutExpired:
            entry.update(exit_code=124, error="scanner module timeout")
        except OSError:
            entry.update(exit_code=1, error="scanner process/output failure")
        status["modules"][module] = entry
        print(f"{module}: {'PASS' if entry['ok'] else 'FAIL'}")
    after = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    changed = subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip()
    status["source_unchanged"] = after == head and not changed
    status["ok"] = status["source_unchanged"] and len(status["modules"]) == len(MODULES) and all(entry["ok"] for entry in status["modules"].values())
    status["finished_at"] = datetime.now(timezone.utc).isoformat()
    (output / "status.json").write_text(json.dumps(status, indent=2) + "\n")
    if not status["ok"]:
        raise ValueError("Findings/infrastructure/source failure; evidence сохранён для triage")


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"Go vulnerability gate failed: {error}", file=sys.stderr)
        sys.exit(1)
