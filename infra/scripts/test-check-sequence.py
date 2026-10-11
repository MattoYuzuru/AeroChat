#!/usr/bin/env python3
"""Проверяет реальный Task barrier и остановку consumers после failed preparation."""

import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


task = sys.argv[1] if len(sys.argv) > 1 else "task"
text = Path("Taskfile.yml").read_text()
block = text[text.index("\n  check:\n"):]
if "\n    deps:" in block or "\n    cmds:" not in block:
    raise RuntimeError("check должен использовать последовательные task calls")
phases = re.findall(r"^      - task: ([a-z:]+)$", block, flags=re.MULTILINE)
expected = ["tools", "web:install", "proto:lint", "generated:check", "go:test", "go:lint", "web:lint", "web:test", "web:build", "compose:config", "compose:server:config"]
if phases != expected:
    raise RuntimeError("check не соответствует preparation/consumer barrier")

for failed in (None, "tools", "web:install", "generated:check"):
    with tempfile.TemporaryDirectory() as directory:
        fixture = Path(directory)
        definitions = "version: '3'\ntasks:\n" + block
        for phase in phases:
            definitions += f"\n  {phase}:\n    cmds:\n      - sh command.sh {phase}\n"
        (fixture / "Taskfile.yml").write_text(definitions)
        (fixture / "command.sh").write_text('''set -eu
phase="$1"
printf '%s\\n' "$phase" >> trace
if [ "$phase" = "${FAIL_PHASE:-}" ]; then exit 42; fi
case "$phase" in
  tools) touch tools-ready ;;
  web:install) test -f tools-ready; touch web-ready ;;
  proto:lint) test -f tools-ready; test -f web-ready ;;
  generated:check) test -f tools-ready; test -f web-ready; touch generation-ready ;;
  *) test -f tools-ready; test -f web-ready; test -f generation-ready ;;
esac
''')
        environment = dict(os.environ)
        if failed:
            environment["FAIL_PHASE"] = failed
        else:
            environment.pop("FAIL_PHASE", None)
        result = subprocess.run([task, "check"], cwd=fixture, env=environment, capture_output=True, text=True)
        actual = (fixture / "trace").read_text().splitlines()
        expected_trace = phases if failed is None else phases[:phases.index(failed) + 1]
        if actual != expected_trace or (result.returncode == 0) != (failed is None):
            raise RuntimeError(f"Task barrier/failure regression: phase={failed}")
print("Task sequential preparation and failed-preparation barrier fixtures passed")
