#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export GOBIN="${ROOT_DIR}/bin"

mkdir -p "${GOBIN}"

go install github.com/bufbuild/buf/cmd/buf@v1.59.0
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.11.3
go install github.com/go-task/task/v3/cmd/task@v3.44.1
go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0

printf 'Инструменты установлены в %s\n' "${GOBIN}"
