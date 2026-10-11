#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export GOBIN="${ROOT_DIR}/bin"

mkdir -p "${GOBIN}"

GO_VERSION="$(python3 -B "${ROOT_DIR}/infra/scripts/go_lifecycle.py" get go_version)"
LINT_VERSION="$(python3 -B "${ROOT_DIR}/infra/scripts/go_lifecycle.py" get golangci_lint_version)"
VULN_VERSION="$(python3 -B "${ROOT_DIR}/infra/scripts/go_lifecycle.py" get govulncheck_version)"
export GOTOOLCHAIN="go${GO_VERSION}"

go install github.com/bufbuild/buf/cmd/buf@v1.59.0
go install "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v${LINT_VERSION}"
go install github.com/go-task/task/v3/cmd/task@v3.44.1
go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0
go install "golang.org/x/vuln/cmd/govulncheck@v${VULN_VERSION}"

printf 'Инструменты установлены в %s\n' "${GOBIN}"
