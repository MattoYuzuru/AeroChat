#!/bin/sh

set -eu

require_env() {
  name="$1"
  eval "value=\${$name:-}"

  if [ -z "$value" ]; then
    echo "Переменная $name обязательна для bootstrap media storage" >&2
    exit 1
  fi
}

require_env MINIO_ENDPOINT
require_env MINIO_ROOT_USER
require_env MINIO_ROOT_PASSWORD
require_env MEDIA_S3_BUCKET
require_env MEDIA_S3_CORS_ALLOWED_ORIGINS

normalized_origins="$(printf '%s' "$MEDIA_S3_CORS_ALLOWED_ORIGINS" | tr -d '[:space:],')"

if [ -z "$normalized_origins" ]; then
  echo "MEDIA_S3_CORS_ALLOWED_ORIGINS должен содержать хотя бы один origin" >&2
  exit 1
fi

mc_alias="aero"

mc alias set "$mc_alias" "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing "$mc_alias/$MEDIA_S3_BUCKET" >/dev/null
mc anonymous set none "$mc_alias/$MEDIA_S3_BUCKET" >/dev/null

echo "Media storage bootstrap завершён для bucket $MEDIA_S3_BUCKET"
