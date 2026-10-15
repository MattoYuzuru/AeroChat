#!/usr/bin/env python3
"""Сохраняет known-good selection и останавливает непроверенный schema rollout."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid

from release_manifest import DIGEST, SHA, read_json, validate


STAGES = ("preflight", "config", "pull", "runtime", "health", "selection", "complete")


def inventory(sha):
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError("Некорректный inventory source SHA")
    paths = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", sha, "services"], text=True).splitlines()
    result = {}
    for path in paths:
        parts = path.split("/")
        if len(parts) == 5 and parts[2:4] == ["db", "schema"] and path.endswith(".sql"):
            data = subprocess.check_output(["git", "show", f"{sha}:{path}"])
            result[path] = hashlib.sha256(data).hexdigest()
    return result


def inventory_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def schema_policy(previous_sha, candidate_sha, previous, candidate, declaration=None):
    changed = sorted(path for path, checksum in previous.items() if candidate.get(path) != checksum)
    if changed:
        raise ValueError("Изменение/удаление applied SQL запрещено; нужен отдельный migration plan")
    added = sorted(set(candidate) - set(previous))
    if added:
        expected = {
            "schema_version": 1,
            "previous_sha": previous_sha,
            "candidate_sha": candidate_sha,
            "previous_inventory_sha256": inventory_digest(previous),
            "candidate_inventory_sha256": inventory_digest(candidate),
            "image_rollback_compatible": True,
        }
        if not isinstance(declaration, dict) or set(declaration) != set(expected) | {"review", "evidence", "roll_forward"}:
            raise ValueError("Новые SQL требуют reviewed compatibility declaration")
        if type(declaration["schema_version"]) is not int or declaration["image_rollback_compatible"] is not True:
            raise ValueError("Неподтверждённая image rollback compatibility")
        if any(declaration[key] != value for key, value in expected.items()):
            raise ValueError("Compatibility declaration не соответствует точным SHA/inventory")
        if any(not isinstance(declaration[key], str) or not 1 <= len(declaration[key]) <= 2048 for key in ("review", "evidence", "roll_forward")):
            raise ValueError("Нужны review, regression evidence и roll-forward strategy")
    return {"previous": previous, "candidate": candidate, "added": added, "compatibility": declaration if added else None}


def schema_state(previous, state):
    if not isinstance(state, list):
        raise ValueError("Некорректный applied schema inventory")
    applied = {}
    for row in state:
        if not isinstance(row, dict) or set(row) != {"service_name", "migration_name", "checksum"}:
            raise ValueError("Некорректная applied migration row")
        service, name, checksum = (row[key] for key in ("service_name", "migration_name", "checksum"))
        if not all(isinstance(value, str) for value in (service, name, checksum)):
            raise ValueError("Некорректные applied migration types")
        path = f"services/{service}/db/schema/{name}"
        if path in applied:
            raise ValueError("Duplicate applied migration")
        applied[path] = checksum
    if applied != previous:
        raise ValueError("Actual schema не совпадает с previous source inventory: нужен operator baseline/recovery review")


def read_schema(args):
    command = ["docker", "compose", "--env-file", args.env_file, "--env-file", args.secret_env_file, "-f", args.compose_file, "exec", "-T", "postgres", "sh", "-c", 'exec psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 --command "SELECT coalesce(json_agg(x), \'[]\'::json) FROM (SELECT service_name,migration_name,checksum FROM schema_migrations ORDER BY service_name,migration_name) x"']
    result = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if len(result.stdout) > 65536:
        raise ValueError("Applied migration inventory превышает bound")
    return json.loads(result.stdout)


def atomic_write(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    with open(temporary, "x", encoding="utf-8") as output:
        os.chmod(temporary, 0o600)
        json.dump(value, output, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def selected(env_path):
    result = {}
    for line in Path(env_path).read_text().splitlines():
        key, separator, value = line.partition("=")
        if separator and key in ("AERO_RELEASE_DIGEST", "AERO_RELEASE_SOURCE_SHA"):
            if key in result:
                raise ValueError("Duplicate known-good selection key")
            result[key] = value
    sha = result.get("AERO_RELEASE_SOURCE_SHA", "")
    digest = result.get("AERO_RELEASE_DIGEST", "")
    if not SHA.fullmatch(sha) or not DIGEST.fullmatch(digest):
        raise ValueError("Known-good selection неизвестен: нужен explicit operator baseline; автоматический bootstrap запрещён")
    return sha, digest


def begin(args):
    candidate = validate(read_json(args.release), args.source_sha, args.namespace)
    root = Path(args.recovery_dir)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory = root / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex)
    directory.mkdir(mode=0o700)
    record_path = directory / "record.json"
    record = {"schema_version": 1, "stage": "preflight", "status": "pending", "candidate": candidate, "candidate_release_digest": args.release_digest, "previous": None}
    if not DIGEST.fullmatch(args.release_digest):
        raise ValueError("Некорректный candidate release digest")
    try:
        previous_sha, previous_digest = selected(args.env_file)
        previous = validate(read_json(f"release-{previous_sha}.json"), previous_sha, args.namespace)
        record["previous"] = {"release_digest": previous_digest, "release": previous}
        overlay = {"services": {service: {"image": ref} for service, ref in previous["images"].items()}}
        atomic_write(directory / "previous-compose.json", overlay)
        declaration = read_json(args.compatibility_file) if args.compatibility_file else None
        old_inventory = inventory(previous_sha)
        applied = read_schema(args)
        schema_state(old_inventory, applied)
        record["schema"] = schema_policy(previous_sha, args.source_sha, old_inventory, inventory(args.source_sha), declaration)
        record["schema"]["applied"] = applied
        record["status"] = "prepared"
    except (ValueError, OSError, subprocess.CalledProcessError):
        record["status"] = "failed"
        atomic_write(record_path, record)
        print(f"Recovery record: {record_path}; preflight failed, runtime unchanged", file=sys.stderr)
        raise
    atomic_write(record_path, record)
    print(record_path)


def advance(path, stage, status):
    if stage not in STAGES or status not in ("pending", "failed", "success"):
        raise ValueError("Некорректный recovery stage/status")
    record = read_json(path)
    if record.get("schema_version") != 1 or "previous" not in record:
        raise ValueError("Некорректный recovery record")
    record["stage"] = stage
    record["status"] = status
    atomic_write(path, record)


def save_selection(env_path, sha, digest):
    if not SHA.fullmatch(sha) or not DIGEST.fullmatch(digest):
        raise ValueError("Некорректный selection")
    path = Path(env_path)
    if path.is_symlink():
        raise ValueError("Selection env не должен быть symlink")
    lines = path.read_text().splitlines()
    keys = ("AERO_RELEASE_DIGEST", "AERO_RELEASE_SOURCE_SHA")
    lines = [line for line in lines if line.partition("=")[0] not in keys]
    lines.extend([f"AERO_RELEASE_DIGEST={digest}", f"AERO_RELEASE_SOURCE_SHA={sha}"])
    temporary = path.with_name(path.name + ".selection-" + uuid.uuid4().hex)
    try:
        with open(temporary, "x", encoding="utf-8") as output:
            os.chmod(temporary, stat.S_IMODE(path.stat().st_mode))
            output.write("\n".join(lines) + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="mode", required=True)
    prepare = subparsers.add_parser("begin")
    for name in ("release", "source-sha", "release-digest", "namespace", "env-file", "secret-env-file", "compose-file", "recovery-dir"):
        prepare.add_argument("--" + name, required=True)
    prepare.add_argument("--compatibility-file")
    stage = subparsers.add_parser("stage")
    stage.add_argument("path")
    stage.add_argument("--stage", choices=STAGES, required=True)
    stage.add_argument("--status", choices=("pending", "failed", "success"), required=True)
    selection = subparsers.add_parser("select")
    selection.add_argument("--env-file", required=True)
    selection.add_argument("--source-sha", required=True)
    selection.add_argument("--release-digest", required=True)
    args = parser.parse_args()
    if args.mode == "begin":
        begin(args)
    elif args.mode == "stage":
        advance(args.path, args.stage, args.status)
    else:
        save_selection(args.env_file, args.source_sha, args.release_digest)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError):
        print("Recovery preflight отклонён; проверьте selection/schema baseline и compatibility evidence", file=sys.stderr)
        sys.exit(1)
