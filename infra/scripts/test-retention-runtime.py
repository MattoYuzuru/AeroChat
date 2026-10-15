#!/usr/bin/env python3
"""Real bounded cleanup из rendered env только в новых owned DB/bucket fixtures."""

import argparse
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
from urllib import request
from urllib.parse import urlsplit, urlunsplit
import uuid


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--state-dir", required=True)
parser.add_argument("--fixture-env", required=True)
parser.add_argument("--main-project", required=True)
args = parser.parse_args()
if args.main_project != "aerochat-remediation-20261011":
    raise SystemExit("Fixture ограничен explicit owned local remediation project")
root = Path(args.state_dir)
root.mkdir(mode=0o700, parents=True, exist_ok=False)
os.umask(0o077)
checkout = Path.cwd()
processes = []
logs = []


def run(command, *, environment=None, expected=0):
    result = subprocess.run(command, env=environment, capture_output=True)
    if (result.returncode == 0) != (expected == 0):
        raise RuntimeError("Retention fixture child status mismatch; raw output suppressed")
    return result.stdout


def rendered(server, retention):
    environment = dict(os.environ, AERO_MEDIA_DETACHED_ATTACHMENT_RETENTION=retention)
    command = ["docker", "compose", "--env-file", ".env.server.example" if server else ".env.example"]
    if server:
        command += ["--env-file", ".env.server.secrets.example"]
    command += ["--env-file", args.fixture_env, "-f", "infra/compose/docker-compose.server.yml" if server else "infra/compose/docker-compose.yml", "config", "--format", "json"]
    return json.loads(run(command, environment=environment))


def ready(port):
    end = time.monotonic() + 30
    while time.monotonic() < end:
        if processes and processes[-1].poll() is not None:
            raise RuntimeError("Native fixture вышел до readiness; private log сохранён в external state")
        try:
            with request.urlopen(f"http://127.0.0.1:{port}/readyz", timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(0.1)
    raise RuntimeError("Native fixture не стал ready")


def stop_native():
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
    processes.clear()
    for log in logs:
        log.close()
    logs.clear()


for port in (28491, 28492):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", port))
source_sha = run(["git", "rev-parse", "HEAD"]).decode().strip()
for service in ("identity", "chat"):
    run(["go", "build", "-ldflags", "-X main.version=" + source_sha, "-o", str(root / service), f"./services/aero-{service}/cmd/aero-{service}"])

pg_container = run(["docker", "ps", "--filter", f"label=com.docker.compose.project={args.main_project}", "--filter", "label=com.docker.compose.service=postgres", "--format", "{{.ID}}"]).decode().strip()
if not pg_container or "\n" in pg_container:
    raise RuntimeError("Ожидался один owned main fixture PostgreSQL")
bootstrap = rendered(False, "2s")
database_url = bootstrap["services"]["aero-chat"]["environment"]["AERO_DATABASE_URL"]
database_user = urlsplit(database_url).username
if not database_user or not re.fullmatch(r"[a-zA-Z0-9_]+", database_user):
    raise RuntimeError("Unexpected fixture PostgreSQL user")


def sql(database, statement):
    return run(["docker", "exec", pg_container, "psql", "-U", database_user, "-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c", statement]).decode().strip()


base = ["docker", "compose", "--project-name", args.main_project, "--env-file", args.fixture_env, "-f", str(checkout / "infra/compose/docker-compose.yml")]


def mc(code, expected=0):
    shell = 'set -eu; mc alias set own http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; ' + code
    return run(base + ["run", "--rm", "--no-deps", "--pull", "never", "--entrypoint", "/bin/sh", "minio-bootstrap", "-c", shell], expected=expected)


summaries = []
try:
    for server, retention in ((False, "2s"), (True, "4s")):
        tag = uuid.uuid4().hex[:12]
        database = "aerochat_retention174_" + tag
        bucket = "aerochat-retention174-" + tag
        sql("postgres", f"CREATE DATABASE {database}")
        mc(f"mc mb own/{bucket} >/dev/null; mc anonymous set none own/{bucket} >/dev/null")
        model = rendered(server, retention)
        for service, port in (("identity", 28491), ("chat", 28492)):
            environment = dict(os.environ, **model["services"][f"aero-{service}"]["environment"])
            # Оба rendered TTL потребляются с credentials owned local fixture, не server examples.
            parsed = urlsplit(database_url)
            environment["AERO_DATABASE_URL"] = urlunsplit((parsed.scheme, parsed.netloc.rsplit("@", 1)[0] + "@127.0.0.1:25432", "/" + database, parsed.query, parsed.fragment))
            environment["AERO_HTTP_ADDR"] = f"127.0.0.1:{port}"
            environment["AERO_REDIS_ADDR"] = "127.0.0.1:26379"
            environment.update(AERO_WEB_PUSH_SUBSCRIBER="", AERO_WEB_PUSH_VAPID_PUBLIC_KEY="", AERO_WEB_PUSH_VAPID_PRIVATE_KEY="")
            if service == "chat":
                assert environment["AERO_MEDIA_DETACHED_ATTACHMENT_RETENTION"] == retention
                fixture_media = bootstrap["services"]["aero-chat"]["environment"]
                environment.update(AERO_MEDIA_S3_INTERNAL_ENDPOINT="127.0.0.1:29000", AERO_MEDIA_S3_PRESIGN_ENDPOINT="localhost:29000", AERO_MEDIA_S3_BUCKET=bucket, AERO_MEDIA_S3_ACCESS_KEY=fixture_media["AERO_MEDIA_S3_ACCESS_KEY"], AERO_MEDIA_S3_SECRET_KEY=fixture_media["AERO_MEDIA_S3_SECRET_KEY"], AERO_MEDIA_S3_INTERNAL_SECURE="false", AERO_MEDIA_S3_PRESIGN_SECURE="false", AERO_MEDIA_ATTACHMENT_CLEANUP_INTERVAL="100ms")
            log = open(root / f"{tag}-{service}.log", "x")
            logs.append(log)
            process = subprocess.Popen([str(root / service)], env=environment, stdout=log, stderr=log)
            processes.append(process)
            ready(port)
        ids = [str(uuid.uuid4()) for _ in range(6)]
        owner, peer, conversation, old, fresh, attached = ids
        low, high = sorted((owner, peer))
        sql(database, f"INSERT INTO users(id,login,nickname,created_at,updated_at) VALUES('{owner}','retentionowner','Fixture',now(),now()),('{peer}','retentionpeer','Fixture',now(),now()); INSERT INTO direct_chats(id,created_by_user_id,user_low_id,user_high_id,created_at,updated_at) VALUES('{conversation}','{owner}','{low}','{high}',now(),now())")
        for name in ("old", "fresh", "attached"):
            mc(f"printf synthetic-retention-object | mc pipe own/{bucket}/{name} >/dev/null")
        sql(database, f"INSERT INTO attachments(id,owner_user_id,scope_kind,direct_chat_id,bucket_name,object_key,file_name,mime_type,size_bytes,status,created_at,updated_at,attached_at) VALUES('{old}','{owner}','direct','{conversation}','{bucket}','old','fixture.bin','application/octet-stream',26,'detached',now()-interval '1h',now()-interval '1h',now()-interval '1h'),('{fresh}','{owner}','direct','{conversation}','{bucket}','fresh','fixture.bin','application/octet-stream',26,'detached',now(),now(),now()),('{attached}','{owner}','direct','{conversation}','{bucket}','attached','fixture.bin','application/octet-stream',26,'attached',now()-interval '1h',now()-interval '1h',now()-interval '1h')")
        seeded = time.monotonic()
        while sql(database, f"SELECT status FROM attachments WHERE id='{old}'") != "deleted":
            if time.monotonic() - seeded > 1:
                raise AssertionError("Short rendered retention не удалил eligible old detached object")
            time.sleep(0.1)
        assert sql(database, f"SELECT status FROM attachments WHERE id='{fresh}'") == "detached"
        mc(f"mc stat own/{bucket}/old >/dev/null", expected=1)
        mc(f"mc stat own/{bucket}/fresh >/dev/null; mc stat own/{bucket}/attached >/dev/null")
        while sql(database, f"SELECT status FROM attachments WHERE id='{fresh}'") != "deleted":
            if time.monotonic() - seeded > int(retention[:-1]) + 3:
                raise AssertionError("Fresh detached object не удалён после configured TTL")
            time.sleep(0.1)
        assert sql(database, f"SELECT status FROM attachments WHERE id='{attached}'") == "attached"
        mc(f"mc stat own/{bucket}/fresh >/dev/null", expected=1)
        mc(f"mc stat own/{bucket}/attached >/dev/null")
        assert all(process.poll() is None for process in processes)
        summaries.append({"profile": "server" if server else "local", "retention": retention, "old_deleted": True, "fresh_protected_then_deleted": True, "attached_preserved": True, "database": database, "bucket": bucket})
        stop_native()
    (root / "summary.json").write_text(json.dumps({"source_sha": source_sha, "profiles": summaries}, indent=2) + "\n")
    print("Both rendered profiles: actual short-TTL DB/S3 cleanup, fresh grace and attached protection passed")
finally:
    stop_native()
    print("Native fixtures stopped; dedicated DBs/buckets retained; main containers/config/volumes unchanged")
