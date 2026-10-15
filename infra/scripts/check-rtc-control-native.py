#!/usr/bin/env python3
"""Строгая hosted-приёмка public-control adapter на собственном PostgreSQL."""

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time


PACKAGE = "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/storage/postgres"
EXPECTED_TESTS = (
    "TestPrivateControlAuthorityClientActualTLSBoundary",
    "TestOwnMediaControlStatusFreshIdentityOnly",
    "TestOwnMediaControlSavedLeaveReplayFromNewSession",
    "TestPublicMediaControlNewLeaveExactHeldBinding",
    "TestPublicMediaControlEndFreshCreatorAndCurrentEligibility",
    "TestPublicMediaControlTotalDeadlineCancellationAndLostResponse",
    "TestPublicMediaControlUnknownProviderNeverComplete",
    "TestAuthorizedGroupMediaControlFactoryRemainsUnmounted",
)
NATIVE_FILES = (
    "services/aero-rtc-control/internal/storage/postgres/public_control_auth_native_test.go",
    "services/aero-rtc-control/internal/storage/postgres/public_control_auth_native_fixture_test.go",
)


class GateError(Exception):
    """Статическое сообщение без вывода credentials или native payload."""


def parse_test_events(raw):
    runs, completed = Counter(), Counter()
    package_passes = 0
    safe_events = []
    for line in raw.splitlines():
        try:
            event = json.loads(line)
        except (ValueError, TypeError) as exc:
            raise GateError("invalid_go_test_json") from exc
        if not isinstance(event, dict):
            raise GateError("invalid_go_test_event")
        action, test = event.get("Action"), event.get("Test")
        if action not in {"start", "run", "pause", "cont", "output", "pass", "fail", "skip", "build-output", "build-fail"}:
            raise GateError("unknown_go_test_action")
        if action not in {"build-output", "build-fail"} and event.get("Package") != PACKAGE:
            raise GateError("unexpected_go_test_package")
        if action in {"fail", "skip", "build-fail"}:
            raise GateError("failed_or_skipped_native_case")
        if test is not None:
            if not isinstance(test, str) or test.split("/", 1)[0] not in EXPECTED_TESTS:
                raise GateError("unexpected_native_case")
            if action == "run":
                runs[test] += 1
            elif action == "pass":
                completed[test] += 1
        elif action == "pass":
            package_passes += 1
        # Output остаётся в private log: artifact содержит только lifecycle тестов.
        if action != "output":
            safe_events.append({key: event[key] for key in ("Action", "Package", "Test", "Elapsed") if key in event})
    if package_passes != 1 or any(runs[name] != 1 or completed[name] != 1 for name in EXPECTED_TESTS):
        raise GateError("missing_or_duplicate_native_case")
    if runs != completed or any(count != 1 for count in runs.values()):
        raise GateError("unfinished_or_duplicate_native_subtest")
    return {"top_level_passed": len(EXPECTED_TESTS), "all_cases_passed": len(completed), "skipped": 0, "failed": 0}, safe_events


def parse_registry(raw):
    begins, schemas, absent, started, stopped = Counter(), Counter(), Counter(), Counter(), Counter()
    for line in raw.splitlines():
        try:
            event = json.loads(line)
        except ValueError as exc:
            raise GateError("invalid_native_registry_json") from exc
        if not isinstance(event, dict):
            raise GateError("invalid_native_registry_event")
        kind = event.get("kind")
        if kind == "fixture_begin":
            name = event.get("test")
            if name not in EXPECTED_TESTS:
                raise GateError("unexpected_native_fixture")
            begins[name] += 1
        elif kind in {"schema_created", "schema_absent"}:
            schema = event.get("schema")
            if not isinstance(schema, str) or not re.fullmatch(r"rtc_test_[0-9a-f]{32}", schema):
                raise GateError("invalid_owned_schema")
            (schemas if kind == "schema_created" else absent)[schema] += 1
        elif kind in {"child_started", "child_stopped"}:
            pid = event.get("pid")
            if type(pid) is not int or pid <= 1:
                raise GateError("invalid_owned_child_pid")
            (started if kind == "child_started" else stopped)[pid] += 1
        else:
            raise GateError("unknown_native_registry_event")
    if begins != Counter(EXPECTED_TESTS) or len(schemas) != len(EXPECTED_TESTS) or schemas != absent:
        raise GateError("incomplete_native_fixture_cleanup")
    if any(count != 1 for count in schemas.values()) or sum(started.values()) != 2 * len(EXPECTED_TESTS) or started != stopped:
        raise GateError("incomplete_native_child_cleanup")
    return {"fixtures": len(begins), "schemas_created_and_removed": len(schemas), "children_started_and_stopped": sum(started.values())}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def check_source(root, sha):
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    dirty = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], cwd=root, text=True)
    if head != sha or dirty:
        raise GateError("source_not_exact_and_clean")


def check_native_inventory(root):
    for path in NATIVE_FILES:
        if not (root / path).read_text().startswith("//go:build integration\n\n"):
            raise GateError("native_build_constraint_missing")
    names = re.findall(r"^func (Test\w+)\(t \*testing.T\)", (root / NATIVE_FILES[0]).read_text(), re.MULTILINE)
    if Counter(names) != Counter(EXPECTED_TESTS):
        raise GateError("native_case_inventory_changed")


def run_command(command, root, env, private, name, timeout):
    # Собственная process group включает go test и оба native child, без shell.
    with (private / (name + ".stdout")).open("wb") as out, (private / (name + ".stderr")).open("wb") as err:
        process = subprocess.Popen(command, cwd=root, env=env, stdout=out, stderr=err, start_new_session=True)
        timed_out = False
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            code = -1
        finally:
            # Не оставляем owned group при panic, timeout или неполном test cleanup.
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                group_remained = False
            else:
                group_remained = True
                os.killpg(process.pid, signal.SIGTERM)
                until = time.monotonic() + 3
                while time.monotonic() < until:
                    try:
                        os.killpg(process.pid, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(0.05)
                else:
                    os.killpg(process.pid, signal.SIGKILL)
            if process.poll() is None:
                process.wait(timeout=5)
    if timed_out or code != 0 or group_remained:
        raise GateError(name + "_failed_or_incomplete_cleanup")


def binary_info(path, package, sha, version, env):
    raw = subprocess.check_output(["go", "version", "-m", str(path)], text=True, env=env)
    if not raw.splitlines():
        raise GateError("native_binary_metadata_absent")
    fields = {}
    for line in raw.splitlines()[1:]:
        values = line.strip().split("\t", 1)
        if len(values) == 2:
            if values[0] == "path":
                fields["package"] = values[1]
            elif values[0] == "build" and "=" in values[1]:
                key, value = values[1].split("=", 1)
                fields[key] = value
    if not raw.splitlines()[0].endswith("go" + version) or fields.get("package") != package or fields.get("vcs.revision") != sha or fields.get("vcs.modified") != "false":
        raise GateError("native_binary_provenance_mismatch")
    return {"package": package, "go_version": version, "source_sha": sha, "sha256": digest(path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    output = args.output_dir.resolve()
    if not re.fullmatch(r"[0-9a-f]{40}", args.source_sha) or output == root or root in output.parents:
        parser.error("requires exact SHA and output outside source")
    os.umask(0o077)
    output.mkdir(parents=True, exist_ok=False)
    evidence, private = output / "evidence", output / "private"
    evidence.mkdir()
    private.mkdir()
    result = {"schema_version": 1, "source_sha": args.source_sha, "status": "running", "expected_tests": list(EXPECTED_TESTS), "scope": "actual Identity main + Chat test host + RTC TLS/PostgreSQL; no SFU/provider/audio proof"}
    result_path = evidence / "result.json"
    write_json(result_path, result)
    stage = "prepare"
    try:
        check_source(root, args.source_sha)
        check_native_inventory(root)
        version = json.loads((root / "infra/go-toolchain.json").read_text())["go_version"]
        if version != "1.27.2":
            raise GateError("native_fixture_toolchain_contract_changed")
        env = os.environ.copy()
        env.update({"GOTOOLCHAIN": "go" + version, "GOWORK": str(root / "go.work"), "GOFLAGS": "-mod=readonly", "TMPDIR": str(private)})
        actual = subprocess.check_output(["go", "env", "GOVERSION", "GOOS", "GOARCH"], env=env, text=True).splitlines()
        if actual != ["go" + version, "linux", "amd64"]:
            raise GateError("requires_hosted_linux_amd64_toolchain")
        result["target"] = {"go": actual[0], "os": actual[1], "arch": actual[2]}
        dsn = env.get("AERO_RTC_TEST_DATABASE_URL", "")
        if not dsn:
            raise GateError("required_native_database_profile_absent")
        profile = private / "rtc.env"
        profile.write_text("AERO_DATABASE_URL=" + dsn + "\n")
        registry = private / "native-registry.jsonl"
        registry.touch(mode=0o600)
        env["AERO_RTC_TEST_DATABASE_ENV_FILE"] = str(profile)
        env["AERO_RTC_CONTROL_AUTH_TEST_HEAD"] = args.source_sha
        env["AERO_RTC_CONTROL_AUTH_NATIVE_REGISTRY"] = str(registry)
        identity, chat = private / "aero-identity", private / "chat-auth-host.test"
        stage = "identity_build"
        run_command(["go", "build", "-buildvcs=true", "-ldflags=-X main.version=" + args.source_sha, "-o", str(identity), "./services/aero-identity/cmd/aero-identity"], root, env, private, stage, 600)
        stage = "chat_host_build"
        run_command(["go", "test", "-c", "-buildvcs=true", "-o", str(chat), "./services/aero-chat/internal/app"], root, env, private, stage, 600)
        result["binaries"] = {
            "identity": binary_info(identity, "github.com/MattoYuzuru/AeroChat/services/aero-identity/cmd/aero-identity", args.source_sha, version, env),
            "chat_host": binary_info(chat, "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/app.test", args.source_sha, version, env),
        }
        env.update({"AERO_RTC_CONTROL_IDENTITY_TEST_BINARY": str(identity), "AERO_RTC_CONTROL_IDENTITY_TEST_BINARY_SHA256": result["binaries"]["identity"]["sha256"], "AERO_RTC_CONTROL_CHAT_TEST_BINARY": str(chat), "AERO_RTC_CONTROL_CHAT_TEST_BINARY_SHA256": result["binaries"]["chat_host"]["sha256"]})
        check_source(root, args.source_sha)
        stage = "native_tests"
        run_command(["go", "test", "-tags=integration", "-race", "-count=1", "-timeout=10m", "-json", "-run", "^(" + "|".join(EXPECTED_TESTS) + ")$", "./services/aero-rtc-control/internal/storage/postgres"], root, env, private, stage, 660)
        stage = "native_evidence"
        result["tests"], events = parse_test_events((private / "native_tests.stdout").read_text())
        result["lifecycle"] = parse_registry(registry.read_text())
        (evidence / "test-events.jsonl").write_text("".join(json.dumps(event) + "\n" for event in events))
        check_source(root, args.source_sha)
        result["source_clean"] = True
        result["status"] = "pass"
    except (GateError, OSError, ValueError, subprocess.SubprocessError) as exc:
        result["status"] = "fail"
        result["failed_stage"] = stage
        result["error"] = str(exc) if isinstance(exc, GateError) else type(exc).__name__
    # Даже failed go test сохраняет имена и terminal outcomes без Output/payload.
    raw_tests = private / "native_tests.stdout"
    if raw_tests.exists():
        diagnostics = []
        for line in raw_tests.read_text(errors="replace").splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if isinstance(event, dict) and event.get("Action") not in {"output", "build-output"}:
                diagnostics.append({key: event[key] for key in ("Action", "Package", "Test", "Elapsed") if key in event})
        (evidence / "test-events.jsonl").write_text("".join(json.dumps(event) + "\n" for event in diagnostics))
    write_json(result_path, result)
    print(json.dumps({key: result[key] for key in ("status", "source_sha", "failed_stage", "error", "tests") if key in result}))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
