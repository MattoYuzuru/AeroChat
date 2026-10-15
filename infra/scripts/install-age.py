#!/usr/bin/env python3
"""Устанавливает только pinned official age binaries в явно выбранный private prefix."""

import argparse
import hashlib
from pathlib import Path
import platform
import subprocess
import tarfile


PINS = {
    ("Darwin", "arm64"): ("darwin-arm64", "e2020b073c44f692685a24d6abc378817eb81ffaaf49fd0531ef8565f767f2f5"),
    ("Linux", "x86_64"): ("linux-amd64", "cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10"),
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--prefix", required=True)
args = parser.parse_args()
target = Path(args.prefix)
if not target.is_absolute():
    raise SystemExit("Нужен absolute owned prefix; global PATH автоматически не меняется")
system = (platform.system(), platform.machine())
if system not in PINS:
    raise SystemExit("Для этой платформы official archive ещё не закреплён")
suffix, expected = PINS[system]
target.mkdir(mode=0o700, parents=True, exist_ok=True)
archive = target / f"age-v1.3.2-{suffix}.tar.gz"
if not archive.exists():
    subprocess.run(["curl", "--fail", "--location", "--max-time", "60", "--output", str(archive), f"https://github.com/FiloSottile/age/releases/download/v1.3.2/{archive.name}"], check=True)
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit("Official age archive checksum mismatch; binaries не установлены")
with tarfile.open(archive) as source:
    for name in ("age", "age-keygen"):
        data = source.extractfile(f"age/{name}").read()
        destination = target / name
        destination.write_bytes(data)
        destination.chmod(0o700)
subprocess.run([str(target / "age"), "--version"], check=True)
print("Official age 1.3.2 archive checksum verified; owned prefix only")
