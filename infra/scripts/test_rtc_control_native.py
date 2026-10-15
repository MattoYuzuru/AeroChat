#!/usr/bin/env python3
"""Проверяет отказ при неполном, skipped или ложном native evidence без runtime."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("rtc_native_gate", Path(__file__).with_name("check-rtc-control-native.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def stream(events):
    return "\n".join(json.dumps(event) for event in events)


def passed_events():
    events = [{"Package": gate.PACKAGE, "Action": "start"}]
    for name in gate.EXPECTED_TESTS:
        events.extend([{"Package": gate.PACKAGE, "Test": name, "Action": "run"}, {"Package": gate.PACKAGE, "Test": name, "Action": "pass"}])
    return events + [{"Package": gate.PACKAGE, "Action": "pass"}]


def complete_registry():
    events = []
    for index, name in enumerate(gate.EXPECTED_TESTS):
        schema = "rtc_test_" + format(index, "032x")
        events.extend([{"kind": "fixture_begin", "test": name}, {"kind": "schema_created", "schema": schema}])
        for pid in (100 + index * 2, 101 + index * 2):
            events.extend([{"kind": "child_started", "pid": pid}, {"kind": "child_stopped", "pid": pid}])
        events.append({"kind": "schema_absent", "schema": schema})
    return events


class NativeEvidenceTests(unittest.TestCase):
    def test_complete_cohort_and_subtest_pass(self):
        events = passed_events()
        events[2:2] = [{"Package": gate.PACKAGE, "Test": gate.EXPECTED_TESTS[0] + "/tls", "Action": action} for action in ("run", "pass")]
        summary, _ = gate.parse_test_events(stream(events))
        self.assertEqual(summary, {"top_level_passed": 8, "all_cases_passed": 9, "failed": 0, "skipped": 0})

    def test_failed_and_skipped_subtests_reject_even_with_package_pass(self):
        for action in ("fail", "skip", "build-fail"):
            with self.subTest(action=action), self.assertRaises(gate.GateError):
                gate.parse_test_events(stream(passed_events() + [{"Package": gate.PACKAGE, "Test": gate.EXPECTED_TESTS[0] + "/tls", "Action": action}]))

    def test_missing_case_rejects(self):
        with self.assertRaises(gate.GateError):
            gate.parse_test_events(stream([e for e in passed_events() if e.get("Test") != gate.EXPECTED_TESTS[0]]))

    def test_duplicate_and_unfinished_cases_reject(self):
        for event in ({"Action": "run", "Test": gate.EXPECTED_TESTS[0]}, {"Action": "pass", "Test": gate.EXPECTED_TESTS[0]}, {"Action": "run", "Test": gate.EXPECTED_TESTS[0] + "/tls"}):
            with self.subTest(event=event), self.assertRaises(gate.GateError):
                gate.parse_test_events(stream(passed_events() + [{"Package": gate.PACKAGE, **event}]))

    def test_empty_malformed_and_wrong_package_reject(self):
        for raw in ("", "not json", "[]", stream(passed_events()).replace(gate.PACKAGE, "unrelated/package"), stream([{key: value for key, value in e.items() if key != "Package"} for e in passed_events()])):
            with self.subTest(raw=raw[:40]), self.assertRaises(gate.GateError):
                gate.parse_test_events(raw)

    def test_missing_or_duplicate_package_pass_rejects(self):
        for events in (passed_events()[:-1], passed_events() + [passed_events()[-1]]):
            with self.assertRaises(gate.GateError):
                gate.parse_test_events(stream(events))

    def test_output_payload_not_in_artifact(self):
        events = passed_events() + [{"Action": "output", "Package": gate.PACKAGE, "Output": "synthetic private payload"}]
        _, safe = gate.parse_test_events(stream(events))
        self.assertNotIn("payload", json.dumps(safe))

    def test_actual_lifecycle_counts_required(self):
        result = gate.parse_registry(stream(complete_registry()))
        self.assertEqual(result, {"fixtures": 8, "schemas_created_and_removed": 8, "children_started_and_stopped": 16})

    def test_registry_missing_schema_or_child_cleanup_rejects(self):
        for kind in ("schema_absent", "child_stopped", "fixture_begin"):
            events = complete_registry()
            events.pop(next(i for i, e in enumerate(events) if e["kind"] == kind))
            with self.subTest(kind=kind), self.assertRaises(gate.GateError):
                gate.parse_registry(stream(events))

    def test_registry_empty_malformed_or_foreign_scope_rejects(self):
        for raw in ("", "[]", "not json", stream(complete_registry()).replace("rtc_test_", "foreign_"), stream(complete_registry() + [{"kind": "unknown"}])):
            with self.subTest(raw=raw[:40]), self.assertRaises(gate.GateError):
                gate.parse_registry(raw)

    def test_binary_provenance_cannot_accept_wrong_vcs_package_or_toolchain(self):
        sha = "a" * 40
        raw = "fixture: go1.27.2\n\tpath\tfixture/package\n\tbuild\tvcs.revision=" + sha + "\n\tbuild\tvcs.modified=false\n"
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / "fixture"
            binary.write_bytes(b"synthetic binary for metadata parser")
            with patch.object(gate.subprocess, "check_output", return_value=raw):
                self.assertEqual(gate.binary_info(binary, "fixture/package", sha, "1.27.2", {})["source_sha"], sha)
            for changed in ("", raw.replace("go1.27.2", "go1.25.8"), raw.replace("fixture/package", "wrong/package"), raw.replace(sha, "b" * 40), raw.replace("modified=false", "modified=true")):
                with self.subTest(changed=changed[:45]), patch.object(gate.subprocess, "check_output", return_value=changed), self.assertRaises(gate.GateError):
                    gate.binary_info(binary, "fixture/package", sha, "1.27.2", {})


if __name__ == "__main__":
    unittest.main()
