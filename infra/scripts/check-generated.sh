#!/bin/sh

set -eu

cd "$(git rev-parse --show-toplevel)"
# Рядом с generated outputs есть ручные regression tests; удаляем только файлы с generator header.
find gen/go services/aero-identity/internal/storage/sqlc services/aero-chat/internal/storage/sqlc services/aero-rtc-control/internal/storage/sqlc -type f -name '*.go' -exec sh -c '
  for file do
    if head -n 1 "$file" | grep -q "^// Code generated "; then
      rm "$file"
    fi
  done
' sh {} +
buf generate
sqlc generate
sh infra/scripts/verify-generated.sh
