#!/usr/bin/env python3
"""Проверяет оба rendered Compose профиля без запуска контейнеров и вывода env."""

import json
import os
from pathlib import Path
import subprocess
import tempfile


key = "AERO_MEDIA_DETACHED_ATTACHMENT_RETENTION"
profiles = (
    ("infra/compose/docker-compose.yml", (".env.example",)),
    ("infra/compose/docker-compose.server.yml", (".env.server.example", ".env.server.secrets.example")),
)
for compose, examples in profiles:
    for value in (None, "30s"):
        with tempfile.TemporaryDirectory() as directory:
            environment = dict(os.environ)
            environment.pop(key, None)
            if value is not None:
                environment[key] = value
            command = ["docker", "compose"]
            for index, example in enumerate(examples):
                source = Path(example).read_text()
                # Удаление ключа из example проверяет настоящий Compose default.
                lines = [line for line in source.splitlines() if not line.startswith(key + "=")]
                path = Path(directory) / f"example-{index}.env"
                path.write_text("\n".join(lines) + "\n")
                command.extend(["--env-file", str(path)])
            command.extend(["-f", compose, "config", "--format", "json"])
            result = subprocess.run(command, env=environment, capture_output=True, text=True, check=False)
            if result.returncode:
                raise RuntimeError(f"Compose validation failed: {compose}")
            actual = json.loads(result.stdout)["services"]["aero-chat"]["environment"].get(key)
            if actual != (value or "168h"):
                raise RuntimeError(f"Retention wiring/default mismatch: {compose}")
print("Both Compose profiles: retention override=30s and absent-key default=168h passed")
