#!/bin/sh

set -eu

verify_script="$(pwd)/infra/scripts/verify-generated.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT HUP INT TERM
cd "$fixture"
git init -q
mkdir -p gen/go services/aero-identity/internal/storage/sqlc
printf 'baseline\n' > gen/go/fixture.go
printf 'baseline\n' > services/aero-identity/internal/storage/sqlc/fixture.go
git add .
git -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm fixture
sh "$verify_script"
printf 'stale\n' > gen/go/fixture.go
if sh "$verify_script" >/dev/null 2>&1; then
  echo "Stale protobuf output должен отклоняться" >&2
  exit 1
fi
printf 'baseline\n' > gen/go/fixture.go
printf 'stale\n' > services/aero-identity/internal/storage/sqlc/fixture.go
git add services/aero-identity/internal/storage/sqlc/fixture.go
if sh "$verify_script" >/dev/null 2>&1; then
  echo "Staged stale SQL output должен отклоняться" >&2
  exit 1
fi
printf 'baseline\n' > services/aero-identity/internal/storage/sqlc/fixture.go
git add services/aero-identity/internal/storage/sqlc/fixture.go
printf 'new\n' > gen/go/new.go
if sh "$verify_script" >/dev/null 2>&1; then
  echo "Untracked generated output должен отклоняться" >&2
  exit 1
fi
echo "Generated drift negative fixtures passed"
