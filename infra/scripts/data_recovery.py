#!/usr/bin/env python3
"""Encrypted DB/S3 snapshot и restore только в distinct empty owned targets."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

from release_manifest import DIGEST, read_json, validate


NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}")
MAX_PAYLOAD = 16 * 1024 * 1024 * 1024


def run(command, **kwargs):
    # Ни stderr dump, ни Docker config env не выводятся в operator logs.
    return subprocess.run(command, check=True, stderr=subprocess.PIPE, **kwargs)


def inspect(kind, name):
    if not NAME.fullmatch(name):
        raise ValueError("Некорректное resource name")
    return json.loads(run(["docker", kind, "inspect", name], stdout=subprocess.PIPE).stdout)[0]


def targets(project, postgres, database, user, minio):
    if not all(NAME.fullmatch(name) for name in (project, database, user)):
        raise ValueError("Некорректный project/database/user")
    pg = inspect("container", postgres)
    storage = inspect("container", minio)
    for container in (pg, storage):
        if container["Config"].get("Labels", {}).get("com.docker.compose.project") != project:
            raise ValueError("Container не принадлежит указанному Compose project")
    if pg["Config"].get("Labels", {}).get("com.docker.compose.service") != "postgres" or storage["Config"].get("Labels", {}).get("com.docker.compose.service") != "minio":
        raise ValueError("Неожиданная role owned container")
    mounts = [mount for mount in storage["Mounts"] if mount["Destination"] == "/data"]
    if len(mounts) != 1 or mounts[0]["Type"] != "volume":
        raise ValueError("MinIO требует один named volume /data")
    volume = mounts[0]["Name"]
    labels = inspect("volume", volume).get("Labels") or {}
    if labels.get("com.docker.compose.project") != project:
        raise ValueError("Storage volume ownership не подтверждён")
    if not pg["State"]["Running"]:
        raise ValueError("PostgreSQL target не запущен")
    return pg, storage, volume


def pg_command(container, user, database, command):
    return ["docker", "exec", "-i", container, command, "--username", user, "--dbname", database]


def query(container, user, database, sql):
    return run(pg_command(container, user, database, "psql") + ["--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", sql], stdout=subprocess.PIPE).stdout.decode().strip()


def helper(image, project, volume, readonly=True):
    return ["docker", "run", "--rm", "-i", "--network", "none", "--label", f"com.docker.compose.project={project}", "--label", "aerochat.owner=recovery-helper", "--mount", f"type=volume,src={volume},dst=/storage" + (",readonly" if readonly else ""), "--entrypoint", "/bin/sh", image]


def checksum(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"size": Path(path).stat().st_size, "sha256": digest.hexdigest()}


def verify_tar(path):
    total = 0
    seen = set()
    with tarfile.open(path) as archive:
        for member in archive:
            clean = str(PurePosixPath(member.name))
            if member.name.startswith("/") or ".." in PurePosixPath(member.name).parts or clean in seen or not (member.isfile() or member.isdir()):
                raise ValueError("Storage tar содержит traversal/links/duplicate/special files")
            seen.add(clean)
            if len(seen) > 100000:
                raise ValueError("Storage archive превышает member count bound")
            if member.size < 0:
                raise ValueError("Некорректный tar member size")
            total += member.size
            if total > MAX_PAYLOAD:
                raise ValueError("Storage archive превышает restore bound")


def check_age(path):
    version = run([path, "--version"], stdout=subprocess.PIPE).stdout.decode().strip()
    if version != "v1.3.2":
        raise ValueError("Нужен закреплённый age v1.3.2")


def backup(args):
    _, storage, volume = targets(args.project, args.postgres, args.database, args.user, args.minio)
    if not args.writers_quiesced:
        raise ValueError("Нужен явный quiesce external/native writers")
    containers = run(["docker", "ps", "--filter", f"label=com.docker.compose.project={args.project}", "--format", "{{.ID}}"], stdout=subprocess.PIPE).stdout.decode().splitlines()
    for container in containers:
        service = inspect("container", container)["Config"].get("Labels", {}).get("com.docker.compose.service")
        if service not in ("postgres", "redis", "minio"):
            raise ValueError("Application/cleanup writer ещё запущен; сначала quiesce project")
    release = read_json(args.release)
    if not isinstance(release, dict):
        raise ValueError("Некорректная release metadata")
    validate(release, release.get("source_sha", ""), args.namespace)
    if not DIGEST.fullmatch(args.release_digest or ""):
        raise ValueError("Нужен immutable release digest snapshot")
    destination = Path(args.archive)
    if destination.exists():
        raise ValueError("Backup archive уже существует")
    check_age(args.age)
    started = time.monotonic()
    quiesced = datetime.now(timezone.utc).isoformat()
    was_running = storage["State"]["Running"]
    partial = destination.with_name(destination.name + ".partial")
    if partial.exists():
        raise ValueError("Partial backup уже существует; нужен новый output path")
    try:
        if was_running:
            run(["docker", "stop", "--time", "30", args.minio], stdout=subprocess.PIPE)
        with tempfile.TemporaryDirectory(prefix="aerochat-backup-", dir=args.scratch) as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            dump = root / "database.dump"
            with open(dump, "xb") as output:
                os.chmod(dump, 0o600)
                run(pg_command(args.postgres, args.user, args.database, "pg_dump") + ["--format=custom", "--no-owner", "--no-acl"], stdout=output)
            if dump.stat().st_size > MAX_PAYLOAD:
                raise ValueError("Database dump превышает restore bound")
            objects = root / "storage.tar"
            with open(objects, "xb") as output:
                os.chmod(objects, 0o600)
                run(helper(storage["Image"], args.project, volume) + ["-c", "tar -C /storage -cf - ."], stdout=output)
            verify_tar(objects)
            migrations = query(args.postgres, args.user, args.database, "SELECT to_regclass('public.schema_migrations') IS NOT NULL")
            migration_state = []
            if migrations == "t":
                migration_state = json.loads(query(args.postgres, args.user, args.database, "SELECT coalesce(json_agg(x), '[]'::json) FROM (SELECT service_name,migration_name,checksum FROM schema_migrations ORDER BY service_name,migration_name) x"))
            manifest = {
                "schema_version": 1, "source_project": args.project,
                "quiesced_at": quiesced, "snapshot_completed_at": datetime.now(timezone.utc).isoformat(),
                "database": args.database, "postgres_major": int(query(args.postgres, args.user, args.database, "SHOW server_version_num")) // 10000,
                "minio_image_id": storage["Image"],
                "minio_revision": storage["Config"].get("Labels", {}).get("org.opencontainers.image.revision"),
                "release": release, "release_digest": args.release_digest, "schema_migrations": migration_state,
                "payloads": {name: checksum(root / name) for name in ("database.dump", "storage.tar")},
            }
            metadata = root / "manifest.json"
            metadata.write_text(json.dumps(manifest, indent=2) + "\n")
            metadata.chmod(0o600)
            bundle = root / "bundle.tar"
            with tarfile.open(bundle, "w") as archive:
                for name in ("manifest.json", "database.dump", "storage.tar"):
                    archive.add(root / name, arcname=name)
            bundle.chmod(0o600)
            run([args.age, "--encrypt", "--recipients-file", args.recipients, "--output", str(partial), str(bundle)], stdout=subprocess.PIPE)
            partial.chmod(0o600)
            # Не перезаписывать concurrently появившийся final archive.
            os.link(partial, destination)
            partial.unlink()
    finally:
        partial.unlink(missing_ok=True)
        if was_running:
            run(["docker", "start", args.minio], stdout=subprocess.PIPE)
    print(json.dumps({"backup": "encrypted", "duration_seconds": round(time.monotonic() - started, 3), "rpo": "quiesced snapshot; production RPO = snapshot age"}))


def unpack(bundle, root):
    expected = {"manifest.json", "database.dump", "storage.tar"}
    with tarfile.open(bundle) as archive:
        members = []
        for member in archive:
            members.append(member)
            if len(members) > 3:
                raise ValueError("Backup bundle содержит лишние members")
        if len(members) != 3 or {member.name for member in members} != expected:
            raise ValueError("Некорректный backup bundle")
        for member in members:
            limit = 65536 if member.name == "manifest.json" else MAX_PAYLOAD
            if not member.isfile() or not 0 <= member.size <= limit:
                raise ValueError("Некорректный backup payload type/size")
            with open(root / member.name, "xb") as output:
                os.chmod(root / member.name, 0o600)
                shutil.copyfileobj(archive.extractfile(member), output)
    manifest = read_json(root / "manifest.json")
    fields = {"schema_version", "source_project", "quiesced_at", "snapshot_completed_at", "database", "postgres_major", "minio_image_id", "minio_revision", "release", "release_digest", "schema_migrations", "payloads"}
    if not isinstance(manifest, dict) or set(manifest) != fields or type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1:
        raise ValueError("Некорректный backup manifest")
    if not isinstance(manifest["payloads"], dict) or set(manifest["payloads"]) != {"database.dump", "storage.tar"}:
        raise ValueError("Некорректный backup payload inventory")
    if not isinstance(manifest["release_digest"], str) or not DIGEST.fullmatch(manifest["release_digest"]):
        raise ValueError("Некорректный backup release digest")
    for name, value in manifest["payloads"].items():
        if not isinstance(value, dict) or set(value) != {"size", "sha256"} or type(value["size"]) is not int or value != checksum(root / name):
            raise ValueError("Backup payload checksum/size mismatch")
    verify_tar(root / "storage.tar")
    return manifest


def restore(args):
    started = time.monotonic()
    _, storage, volume = targets(args.project, args.postgres, args.database, args.user, args.minio)
    if storage["State"]["Running"]:
        raise ValueError("Target MinIO должен быть остановлен")
    check_age(args.age)
    if Path(args.archive).stat().st_size > 2 * MAX_PAYLOAD + 64 * 1024 * 1024:
        raise ValueError("Encrypted archive превышает restore bound")
    with tempfile.TemporaryDirectory(prefix="aerochat-restore-", dir=args.scratch) as directory:
        root = Path(directory)
        root.chmod(0o700)
        bundle = root / "bundle.tar"
        run([args.age, "--decrypt", "--identity", args.identity, "--output", str(bundle), args.archive], stdout=subprocess.PIPE)
        bundle.chmod(0o600)
        manifest = unpack(bundle, root)
        if manifest["source_project"] == args.project or not isinstance(manifest["source_project"], str) or not NAME.fullmatch(manifest["source_project"]):
            raise ValueError("Restore требует distinct source/target project")
        release = manifest["release"]
        if not isinstance(release, dict):
            raise ValueError("Некорректная backup release metadata")
        validate(release, release.get("source_sha", ""), args.namespace)
        if storage["Image"] != manifest["minio_image_id"]:
            raise ValueError("Storage restore требует тот же exact image ID")
        major = int(query(args.postgres, args.user, args.database, "SHOW server_version_num")) // 10000
        if type(manifest["postgres_major"]) is not int or major != manifest["postgres_major"]:
            raise ValueError("Restore требует проверенный PostgreSQL major")
        count = query(args.postgres, args.user, args.database, "SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema') + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema') + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema') + (SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema','public')) + (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql')")
        if count != "0":
            raise ValueError("PostgreSQL target не пустой")
        run(helper(storage["Image"], args.project, volume) + ["-c", "test -z \"$(find /storage -mindepth 1 -maxdepth 1 -print -quit)\""], stdout=subprocess.PIPE)
        with open(root / "database.dump", "rb") as source:
            run(pg_command(args.postgres, args.user, args.database, "pg_restore") + ["--exit-on-error", "--single-transaction", "--no-owner", "--no-acl"], stdin=source, stdout=subprocess.PIPE)
        with open(root / "storage.tar", "rb") as source:
            run(helper(storage["Image"], args.project, volume, readonly=False) + ["-c", "tar -C /storage -xf -"], stdin=source, stdout=subprocess.PIPE)
    print(json.dumps({"restore": "data copied; target remains stopped/offline, verify identities/schema/object bytes before selection", "duration_seconds": round(time.monotonic() - started, 3)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("backup", "restore"))
    for name in ("project", "postgres", "database", "user", "minio", "archive", "age", "namespace"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--scratch", required=True)
    parser.add_argument("--release")
    parser.add_argument("--release-digest")
    parser.add_argument("--recipients")
    parser.add_argument("--identity")
    parser.add_argument("--writers-quiesced", action="store_true")
    args = parser.parse_args()
    if args.mode == "backup":
        if not args.release or not args.recipients:
            raise ValueError("Нужны release metadata и recipients file")
        backup(args)
    else:
        if not args.identity:
            raise ValueError("Нужен отдельный identity file")
        restore(args)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, tarfile.TarError, subprocess.CalledProcessError):
        print("Data recovery остановлен: проверьте ownership/quiesce, encryption, payload validation и пустоту целей; partial target не переключать live", file=sys.stderr)
        sys.exit(1)
