#!/usr/bin/env python3
"""Проверяет полный immutable release перед публикацией или выбором deployment."""

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys


SERVICES = ("web", "aero-gateway", "aero-identity", "aero-chat", "aero-rtc-control")
SHA = re.compile(r"[0-9a-f]{40}")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
NAMESPACE = re.compile(r"ghcr\.io/[a-z0-9][a-z0-9-]*")
ARTIFACT_TYPE = "application/vnd.aerochat.release.v1+json"


def read_json(path):
    if Path(path).stat().st_size > 65536:
        raise ValueError("Release metadata превышает 64 KiB")
    return json.loads(Path(path).read_text())


def validate(release, source_sha, namespace):
    if not SHA.fullmatch(source_sha) or not NAMESPACE.fullmatch(namespace):
        raise ValueError("Некорректный source SHA или registry namespace")
    if not isinstance(release, dict) or set(release) != {"schema_version", "source_sha", "images"}:
        raise ValueError("Некорректная release schema")
    if type(release["schema_version"]) is not int or release["schema_version"] != 1 or release["source_sha"] != source_sha:
        raise ValueError("Release не соответствует выбранному source SHA")
    images = release["images"]
    if not isinstance(images, dict) or set(images) != set(SERVICES):
        raise ValueError("Release должен содержать ровно пять application services")
    for service in SERVICES:
        prefix = f"{namespace}/aerochat-{service}@"
        ref = images[service]
        if not isinstance(ref, str) or not ref.startswith(prefix) or not DIGEST.fullmatch(ref[len(prefix):]):
            raise ValueError(f"Некорректный immutable image для {service}")
    return release


def validate_artifact(manifest, source_sha):
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 2 or manifest.get("mediaType") != "application/vnd.oci.image.manifest.v1+json":
        raise ValueError("Некорректная OCI manifest schema")
    if not SHA.fullmatch(source_sha) or manifest.get("artifactType") != ARTIFACT_TYPE:
        raise ValueError("Некорректный OCI artifact type/source SHA")
    if manifest.get("annotations", {}).get("org.opencontainers.image.revision") != source_sha:
        raise ValueError("OCI artifact не соответствует выбранному source SHA")
    layers = manifest.get("layers", [])
    if not isinstance(layers, list) or len(layers) != 1 or not isinstance(layers[0], dict):
        raise ValueError("Release artifact должен содержать один JSON layer")
    layer = layers[0]
    if layer.get("mediaType") != ARTIFACT_TYPE or not DIGEST.fullmatch(layer.get("digest", "")):
        raise ValueError("Некорректный release JSON layer")
    size = layer.get("size", -1)
    if not isinstance(size, int) or not 0 <= size <= 65536:
        raise ValueError("Некорректный размер release JSON layer")
    return layer["digest"]


def verify_runtime(release, compose_command, run_command=subprocess.check_output):
    for service in SERVICES:
        container = run_command(compose_command + ["ps", "-q", service], text=True).strip()
        if not container or "\n" in container:
            raise ValueError(f"Ожидался один runtime container для {service}")
        inspected = json.loads(run_command(["docker", "inspect", container], text=True))
        config = inspected[0]["Config"]
        if config["Image"] != release["images"][service] or config.get("Labels", {}).get("org.opencontainers.image.revision") != release["source_sha"]:
            raise ValueError(f"Runtime {service} не соответствует выбранному digest/source SHA")
        if not inspected[0]["State"]["Running"]:
            raise ValueError(f"Runtime {service} не запущен")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("assemble", "validate", "artifact", "runtime"))
    parser.add_argument("path")
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--namespace", default="")
    parser.add_argument("--overlay")
    parser.add_argument("--compose-file")
    parser.add_argument("--env-file", action="append", default=[])
    args = parser.parse_args()
    if args.mode == "artifact":
        print(validate_artifact(read_json(args.path), args.source_sha))
        return
    if args.mode == "assemble":
        release = {"schema_version": 1, "source_sha": args.source_sha, "images": {}}
        for service in SERVICES:
            release["images"][service] = (Path(args.path) / f"{service}.txt").read_text().strip()
    else:
        release = read_json(args.path)
    validate(release, args.source_sha, args.namespace)
    if args.mode == "runtime":
        if not args.compose_file or not args.overlay:
            raise ValueError("Runtime verification требует compose file и immutable overlay")
        command = ["docker", "compose"]
        for env_file in args.env_file:
            command.extend(["--env-file", env_file])
        command.extend(["-f", args.compose_file, "-f", args.overlay])
        verify_runtime(release, command)
        print("Пять application runtime digests и source SHA подтверждены")
        return
    if args.overlay:
        overlay = {"services": {service: {"image": release["images"][service]} for service in SERVICES}}
        Path(args.overlay).write_text(json.dumps(overlay, indent=2) + "\n")
    else:
        print(json.dumps(release, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError) as exc:
        print(f"Release отклонён: {exc}", file=sys.stderr)
        sys.exit(1)
