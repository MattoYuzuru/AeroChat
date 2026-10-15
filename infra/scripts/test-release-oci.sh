#!/bin/sh

set -eu

oras_bin="${1:-oras}"
root="$(git rev-parse --show-toplevel)"
source_sha="$(git rev-parse HEAD)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT HUP INT TERM

# Synthetic refs проверяют metadata transport; этот fixture не публикует registry images.
python3 -B -c 'import json,sys; from pathlib import Path; sys.path.insert(0, str(Path(sys.argv[1]) / "infra/scripts")); from release_manifest import SERVICES; release={"schema_version":1,"source_sha":sys.argv[3],"images":{service:f"ghcr.io/mattoyuzuru/aerochat-{service}@sha256:{chr(98)*64}" for service in SERVICES}}; Path(sys.argv[2],"release.json").write_text(json.dumps(release))' "$root" "$fixture" "$source_sha"

cd "$fixture"
"$oras_bin" push --oci-layout layout:release --artifact-type application/vnd.aerochat.release.v1+json --annotation "org.opencontainers.image.revision=$source_sha" release.json:application/vnd.aerochat.release.v1+json
digest="$("$oras_bin" resolve --oci-layout layout:release)"
"$oras_bin" manifest fetch --oci-layout "layout@$digest" --output oci.json
layer="$(python3 -B "$root/infra/scripts/release_manifest.py" artifact oci.json --source-sha "$source_sha")"
"$oras_bin" blob fetch --oci-layout "layout@$layer" --output fetched.json
python3 -B "$root/infra/scripts/release_manifest.py" blob oci.json --source-sha "$source_sha" --blob fetched.json
python3 -B "$root/infra/scripts/release_manifest.py" validate fetched.json --source-sha "$source_sha" --namespace ghcr.io/mattoyuzuru --overlay overlay.json
docker compose --env-file "$root/.env.server.example" --env-file "$root/.env.server.secrets.example" -f "$root/infra/compose/docker-compose.server.yml" -f overlay.json config --quiet
echo "Local OCI layout digest/blob/schema/Compose selection passed"
