#!/usr/bin/env python3
"""Проверяет complete maintenance manifest и module overlays до source build."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys


COMPILER = "golang:1.27.2-alpine3.24@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d"
UPSTREAM = {
    "minio": {
        "commit": "7ced9663e6a791fef9dc6be798ff24cda9c730ac",
        "archiveSha256": "f31b6997fdb098479ddddfca1267f02518ee0b59cc1d3f9682c3a48e6309f4d0",
        "go.mod": "1092c21cbe753941b16da2943be699d1517e70ebdd4da6d5c994ca27a85ba430",
        "go.sum": "bd2c712debe48fa4406c87180609266fb92130fd0120797a29bda477a242f252",
    },
    "mc": {
        "commit": "7394ce0dd2a80935aded936b09fa12cbb3cb8096",
        "archiveSha256": "95cd293c7119f16921a6dc515a1fb74a2227f19fd994b9c8b770a154e802ac44",
        "go.mod": "76dbbad8795627d32a7d1a271d0b6a16a6bd4c0956262467a3b54d36ae67d622",
        "go.sum": "1592c97fca12c8ccb99f3bf1a3dc3627f4449e3b29ae78c3ff84e33e2acc8bf9",
    },
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(manifest, directory):
    if not isinstance(manifest, dict) or type(manifest.get("schemaVersion")) is not int or manifest["schemaVersion"] != 1:
        raise ValueError("Unsupported maintenance manifest schema")
    if manifest.get("compilerImage") != COMPILER or manifest.get("goVersion") != "1.27.2" or manifest.get("govulncheckVersion") != "1.7.0":
        raise ValueError("Maintenance compiler/scanner pins mismatch")
    components = manifest.get("components")
    if not isinstance(components, dict) or set(components) != set(UPSTREAM):
        raise ValueError("Both supported storage components are required")
    for name, expected in UPSTREAM.items():
        item = components[name]
        if not isinstance(item, dict) or item.get("upstream") != expected:
            raise ValueError("Original source provenance mismatch")
        effective = item.get("effectiveModuleHashes")
        if not isinstance(effective, dict) or set(effective) != {"go.mod", "go.sum"}:
            raise ValueError("Complete effective module hashes are required")
        for filename, checksum in effective.items():
            if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
                raise ValueError("Malformed effective module hash")
            path = directory / "deps" / name / filename
            if not path.is_file() or path.is_symlink() or digest(path) != checksum:
                raise ValueError("Effective module file mismatch")
        checksum_file = directory / "deps" / name / "effective.sha256"
        expected_lines = "".join(effective[filename] + "  " + filename + "\n" for filename in ("go.mod", "go.sum"))
        if not checksum_file.is_file() or checksum_file.is_symlink() or checksum_file.read_text() != expected_lines:
            raise ValueError("Docker overlay checksum recipe mismatch")
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def verify_original(manifest, name, source, archive):
    expected = manifest["components"][name]["upstream"]
    if digest(archive) != expected["archiveSha256"]:
        raise ValueError("Original archive mismatch")
    for filename in ("go.mod", "go.sum"):
        if digest(source / filename) != expected[filename]:
            raise ValueError("Original source module mismatch")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).with_name("maintenance.json"))
    parser.add_argument("--component", choices=tuple(UPSTREAM))
    parser.add_argument("--original-source", type=Path)
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    original = (args.component, args.original_source, args.archive)
    if any(original) and not all(original):
        raise ValueError("Original verification requires component/source/archive together")
    manifest = json.loads(args.manifest.read_text())
    manifest_digest = validate(manifest, args.manifest.parent)
    if args.component:
        verify_original(manifest, args.component, args.original_source, args.archive)
        print(args.component + ": original archive/module files and maintenance overlays verified: " + manifest_digest)
    else:
        print("Maintenance manifest/effective module overlays verified: " + manifest_digest)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, TypeError, KeyError) as error:
        print("Storage maintenance provenance failed: " + str(error), file=sys.stderr)
        sys.exit(1)
