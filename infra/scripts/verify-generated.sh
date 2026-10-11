#!/bin/sh

set -eu

cd "$(git rev-parse --show-toplevel)"
set -- gen/go services/aero-identity/internal/storage/sqlc services/aero-chat/internal/storage/sqlc services/aero-rtc-control/internal/storage/sqlc
git diff --exit-code HEAD -- "$@"
untracked="$(git ls-files --others --exclude-standard -- "$@")"
if [ -n "$untracked" ]; then
  printf 'Новые generated-файлы не закоммичены:\n%s\n' "$untracked" >&2
  exit 1
fi
