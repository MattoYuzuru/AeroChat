#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

copy_if_missing() {
  local source_file="$1"
  local target_file="$2"

  if [[ -f "${target_file}" ]]; then
    return
  fi

  cp "${source_file}" "${target_file}"
}

copy_if_missing "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
copy_if_missing "${ROOT_DIR}/apps/web/.env.example" "${ROOT_DIR}/apps/web/.env"

for service_dir in "${ROOT_DIR}"/services/*; do
  if [[ -f "${service_dir}/.env.example" ]]; then
    copy_if_missing "${service_dir}/.env.example" "${service_dir}/.env"
  fi
done

npx pnpm@10.19.0 install

printf 'Локальный bootstrap завершён.\n'
