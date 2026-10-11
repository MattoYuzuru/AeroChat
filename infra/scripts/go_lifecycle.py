#!/usr/bin/env python3
"""Проверяет согласованность source pins Go/CI/Docker до consumer gates."""

import argparse
import json
from pathlib import Path
import re
import subprocess


MODULES = ("libs/go", "gen/go", "services/aero-gateway", "services/aero-identity", "services/aero-chat", "services/aero-rtc-control", "services/aero-jobs")


def pins(root):
    value = json.loads((root / "infra/go-toolchain.json").read_text())
    keys = {"go_version", "golangci_lint_version", "govulncheck_version", "go_builder_image"}
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError("Некорректная toolchain schema")
    for key in keys - {"go_builder_image"}:
        if not isinstance(value[key], str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", value[key]):
            raise ValueError("Некорректная tool version")
    if not isinstance(value["go_builder_image"], str) or not re.fullmatch(r"golang:" + re.escape(value["go_version"]) + r"-alpine[0-9]+\.[0-9]+@sha256:[0-9a-f]{64}", value["go_builder_image"]):
        raise ValueError("Builder version/digest не согласован с toolchain")
    return value


def check(root):
    value = pins(root)
    work = (root / "go.work").read_text()
    use = re.search(r"^use \(\n(.*?)\n\)", work, flags=re.MULTILINE | re.DOTALL)
    if not use or {line.strip().removeprefix("./") for line in use.group(1).splitlines() if line.strip()} != set(MODULES):
        raise ValueError("Workspace module inventory изменился: обновите scanner scope")
    for file in ("go.work", *(module + "/go.mod" for module in MODULES)):
        match = re.search(r"^go (\S+)$", (root / file).read_text(), flags=re.MULTILINE)
        if not match or match.group(1) != value["go_version"]:
            raise ValueError(f"Go version drift: {file}")
    for module in MODULES:
        dockerfile = root / module / "Dockerfile"
        if dockerfile.exists() and dockerfile.read_text().splitlines()[0] != "FROM " + value["go_builder_image"] + " AS builder":
            raise ValueError(f"Go builder drift: {module}")
    print("Go workspace/module/application Docker pins согласованы")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("get", "check"))
    parser.add_argument("key", nargs="?")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--runtime", action="store_true")
    args = parser.parse_args()
    value = pins(args.root)
    if args.mode == "get":
        if args.key not in value:
            raise ValueError("Неизвестный tool pin")
        print(value[args.key])
    else:
        check(args.root)
        if args.runtime:
            version = subprocess.check_output(["go", "env", "GOVERSION"], text=True).strip()
            if version != "go" + value["go_version"]:
                raise ValueError("Actual Go не соответствует pin; задайте GOTOOLCHAIN")


if __name__ == "__main__":
    main()
