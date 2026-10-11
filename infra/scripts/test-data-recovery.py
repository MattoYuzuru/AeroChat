#!/usr/bin/env python3
"""Реальный synthetic restore drill только в новые source/target Compose projects."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request

from release_manifest import SERVICES


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--state-dir", required=True)
parser.add_argument("--source-project", required=True)
parser.add_argument("--target-project", required=True)
parser.add_argument("--age-dir", required=True)
parser.add_argument("--minio-image", required=True)
parser.add_argument("--mc-image", required=True)
parser.add_argument("--postgres-image", required=True)
args = parser.parse_args()
if args.source_project == args.target_project or not all(name.startswith("aerochat-recovery-") for name in (args.source_project, args.target_project)):
    raise SystemExit("Нужны distinct owned recovery projects")
root = Path(args.state_dir)
root.mkdir(mode=0o700, parents=True, exist_ok=False)
os.umask(0o077)
checkout = Path.cwd()


def run(command, *, environment=None, input=None, expected=0):
    result = subprocess.run(command, env=environment, input=input, capture_output=True)
    if (result.returncode == 0) != (expected == 0):
        raise RuntimeError("Fixture child status mismatch; raw output suppressed")
    return result.stdout


credentials = root / "fixture.env"
password = secrets.token_hex(24)
credentials.write_text(f"POSTGRES_USER=recovery\nPOSTGRES_PASSWORD={password}\nPOSTGRES_DB=recovery_fixture\nMINIO_ROOT_USER=recovery-root\nMINIO_ROOT_PASSWORD={password}\nFIXTURE_READER=recovery-reader\nFIXTURE_READER_PASSWORD={secrets.token_hex(24)}\n")
credentials.chmod(0o600)
configuration = root / "compose.json"
configuration.write_text(json.dumps({"services": {
    "postgres": {"image": args.postgres_image, "environment": {name: "${" + name + "}" for name in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB")}, "ports": ["127.0.0.1:${PG_PORT}:5432"], "volumes": ["postgres-data:/var/lib/postgresql/data"], "healthcheck": {"test": ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"], "interval": "1s", "timeout": "3s", "retries": 30}},
    "minio": {"image": args.minio_image, "environment": {name: "${" + name + "}" for name in ("MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD")}, "command": ["server", "/data"], "ports": ["127.0.0.1:${S3_PORT}:9000"], "volumes": ["minio-data:/data"], "healthcheck": {"test": ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:9000/minio/health/ready"], "interval": "1s", "timeout": "3s", "retries": 30}},
    "mc": {"image": args.mc_image, "profiles": ["fixture"], "environment": {name: "${" + name + "}" for name in ("MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD", "FIXTURE_READER", "FIXTURE_READER_PASSWORD")}},
}, "volumes": {"postgres-data": {}, "minio-data": {}}}, indent=2))


def environment(project):
    return dict(os.environ, PG_PORT="29532" if project == args.source_project else "29542", S3_PORT="29500" if project == args.source_project else "29510")


def compose(project, *command, expected=0):
    return run(["docker", "compose", "-p", project, "--env-file", str(credentials), "-f", str(configuration), *command], environment=environment(project), expected=expected)


def mc(project, command):
    prefix = 'set -eu; mc alias set owned http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
    return compose(project, "run", "--rm", "--no-deps", "--pull", "never", "--entrypoint", "/bin/sh", "mc", "-c", prefix + command)


def sql(project, statement):
    return compose(project, "exec", "-T", "postgres", "psql", "-U", "recovery", "-d", "recovery_fixture", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement).decode().strip()


age = Path(args.age_dir) / "age"
keygen = Path(args.age_dir) / "age-keygen"
identity = root / "identity.txt"
wrong_identity = root / "wrong-identity.txt"
run([str(keygen), "--output", str(identity)])
run([str(keygen), "--output", str(wrong_identity)])
recipients = root / "recipients.txt"
recipients.write_bytes(run([str(keygen), "-y", str(identity)]))
release = root / "release.json"
release.write_text(json.dumps({"schema_version": 1, "source_sha": "a" * 40, "images": {name: f"ghcr.io/mattoyuzuru/aerochat-{name}@sha256:" + "b" * 64 for name in SERVICES}}))
archive = root / "snapshot.tar.age"
scratch = root / "scratch"
scratch.mkdir(mode=0o700)
source_container = target_container = ""
started = time.monotonic()
try:
    for project in (args.source_project, args.target_project):
        if run(["docker", "ps", "-a", "--filter", f"label=com.docker.compose.project={project}", "--format", "{{.ID}}"]):
            raise RuntimeError("Fixture project уже существует; нет повторного restore поверх retained data")
        if run(["docker", "volume", "ls", "--filter", f"label=com.docker.compose.project={project}", "--format", "{{.Name}}"]):
            raise RuntimeError("Fixture project имеет retained volumes; нужен новый project")
    compose(args.source_project, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "60", "postgres", "minio")
    compose(args.target_project, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "60", "postgres")
    compose(args.target_project, "create", "--no-build", "--pull", "never", "minio")
    source_container = compose(args.source_project, "ps", "-q", "minio").decode().strip()
    target_container = compose(args.target_project, "ps", "-a", "-q", "minio").decode().strip()
    source_pg = compose(args.source_project, "ps", "-q", "postgres").decode().strip()
    target_pg = compose(args.target_project, "ps", "-q", "postgres").decode().strip()
    sql(args.source_project, "CREATE TABLE recovery_items(id integer PRIMARY KEY,object_key text NOT NULL); INSERT INTO recovery_items VALUES(1,'one.bin'),(2,'two.bin'); CREATE TABLE schema_migrations(service_name text,migration_name text,checksum text); INSERT INTO schema_migrations VALUES('fixture','initial.sql',repeat('a',64))")
    old_source = root / "old-client.go"
    old_source.write_text('''package main
import ("context"; "os"; "fmt"; "github.com/jackc/pgx/v5")
func main() { ctx:=context.Background(); conn,err:=pgx.Connect(ctx,os.Getenv("FIXTURE_DATABASE_URL")); if err!=nil { panic("connect") }; defer conn.Close(ctx)
rows,err:=conn.Query(ctx,"SELECT id,object_key FROM recovery_items ORDER BY id"); if err!=nil { panic("old query") }; n:=0; for rows.Next(){ var id int; var key string; if rows.Scan(&id,&key)!=nil {panic("scan")}; n++ }; if rows.Err()!=nil {panic("rows")}; rows.Close(); if n!=2 {panic("count")}; _,err=conn.Exec(ctx,"UPDATE recovery_items SET object_key=object_key WHERE id=1"); if err!=nil {panic("old update")}; fmt.Println("frozen old SQL consumer passed") }
''')
    binary = root / "old-client"
    run(["go", "build", "-o", str(binary), str(old_source)])
    client_environment = dict(os.environ, FIXTURE_DATABASE_URL=f"postgres://recovery:{password}@127.0.0.1:29532/recovery_fixture?sslmode=disable")
    run([str(binary)], environment=client_environment)
    old_binary_hash = hashlib.sha256(binary.read_bytes()).hexdigest()
    sql(args.source_project, "ALTER TABLE recovery_items ADD COLUMN nullable_extension text; INSERT INTO schema_migrations VALUES('fixture','nullable.sql',repeat('b',64))")
    run([str(binary)], environment=client_environment)
    assert hashlib.sha256(binary.read_bytes()).hexdigest() == old_binary_hash
    mc(args.source_project, 'mc mb owned/recovery-fixture >/dev/null; mc anonymous set none owned/recovery-fixture >/dev/null; printf synthetic-object-one | mc pipe owned/recovery-fixture/one.bin >/dev/null; printf synthetic-object-two | mc pipe owned/recovery-fixture/two.bin >/dev/null; mc admin user add owned "$FIXTURE_READER" "$FIXTURE_READER_PASSWORD" >/dev/null; mc admin policy attach owned readonly --user "$FIXTURE_READER" >/dev/null; mc ilm rule add owned/recovery-fixture --prefix staging/ --expire-days 1 >/dev/null')
    before = {key: hashlib.sha256(mc(args.source_project, f"mc cat owned/recovery-fixture/{key}")).hexdigest() for key in ("one.bin", "two.bin")}
    lifecycle = mc(args.source_project, "mc ilm rule export owned/recovery-fixture")
    arguments = [sys.executable, "-B", str(checkout / "infra/scripts/data_recovery.py")]
    common = ["--database", "recovery_fixture", "--user", "recovery", "--age", str(age), "--namespace", "ghcr.io/mattoyuzuru", "--archive", str(archive), "--scratch", str(scratch)]
    backup_started = time.monotonic()
    run(arguments + ["backup", "--project", args.source_project, "--postgres", source_pg, "--minio", source_container, "--release", str(release), "--release-digest", "sha256:" + "c" * 64, "--recipients", str(recipients), "--writers-quiesced", *common])
    backup_seconds = time.monotonic() - backup_started
    restore_args = arguments + ["restore", "--project", args.target_project, "--postgres", target_pg, "--minio", target_container, *common]
    run(restore_args + ["--identity", str(wrong_identity)], expected=1)
    assert sql(args.target_project, "SELECT count(*) FROM pg_tables WHERE schemaname='public'") == "0"
    assert not any(scratch.iterdir())
    restore_started = time.monotonic()
    run(restore_args + ["--identity", str(identity)])
    assert sql(args.target_project, "SELECT string_agg(id::text||':'||object_key,',' ORDER BY id) FROM recovery_items") == "1:one.bin,2:two.bin"
    assert sql(args.target_project, "SELECT count(*) FROM schema_migrations") == "2"
    assert sql(args.target_project, "SELECT is_nullable FROM information_schema.columns WHERE table_name='recovery_items' AND column_name='nullable_extension'") == "YES"
    # Повторная запись в nonempty DB/volume обязана отказать до мутации.
    run(restore_args + ["--identity", str(identity)], expected=1)
    compose(args.target_project, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "60", "minio")
    after = {key: hashlib.sha256(mc(args.target_project, f"mc cat owned/recovery-fixture/{key}")).hexdigest() for key in before}
    assert before == after
    assert mc(args.target_project, "mc ilm rule export owned/recovery-fixture") == lifecycle
    mc(args.target_project, 'mc alias set intended http://minio:9000 "$FIXTURE_READER" "$FIXTURE_READER_PASSWORD" >/dev/null; mc cat intended/recovery-fixture/one.bin >/dev/null; mc admin user info owned "$FIXTURE_READER" >/dev/null')
    try:
        urllib.request.urlopen("http://127.0.0.1:29510/recovery-fixture/one.bin", timeout=3)
        raise AssertionError("Restored bucket unexpectedly public")
    except urllib.error.HTTPError as error:
        assert error.code == 403
    restore_seconds = time.monotonic() - restore_started
    assert restore_seconds < 300
    assert not any(scratch.iterdir())
    print(json.dumps({"result": "PASS", "db_rows": 2, "objects": 2, "private_bucket": True, "restored_iam_and_lifecycle": True, "wrong_identity_and_nonempty_rejected": True, "frozen_synthetic_old_binary_on_nullable_schema": True, "rpo_since_quiesce": 0, "backup_seconds": round(backup_seconds, 3), "restore_and_smoke_seconds": round(restore_seconds, 3), "total_seconds": round(time.monotonic() - started, 3)}))
finally:
    for project in (args.source_project, args.target_project):
        compose(project, "stop", "--timeout", "10")
    print("Owned recovery source/target stopped; all named volumes and encrypted archive retained. No retained project touched.")
