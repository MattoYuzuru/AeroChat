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

if ! printf '%s' "$MEDIA_S3_CORS_ALLOWED_ORIGINS" | grep -Eq '[^[:space:],]'; then
  echo "MEDIA_S3_CORS_ALLOWED_ORIGINS должен содержать хотя бы один origin" >&2
  exit 1
fi

mc_alias="aero"

mc alias set "$mc_alias" "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing "$mc_alias/$MEDIA_S3_BUCKET" >/dev/null
mc anonymous set none "$mc_alias/$MEDIA_S3_BUCKET" >/dev/null

cors_file="$(mktemp)"
trap 'rm -f "$cors_file"' EXIT

{
  printf '<CORSConfiguration>\n'
  printf '  <CORSRule>\n'
  printf '    <AllowedMethod>PUT</AllowedMethod>\n'
  printf '    <AllowedMethod>GET</AllowedMethod>\n'
  printf '    <AllowedMethod>HEAD</AllowedMethod>\n'

  printf '%s' "$MEDIA_S3_CORS_ALLOWED_ORIGINS" | tr ',' '\n' | while IFS= read -r origin; do
    trimmed_origin="$(printf '%s' "$origin" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    if [ -n "$trimmed_origin" ]; then
      printf '    <AllowedOrigin>%s</AllowedOrigin>\n' "$trimmed_origin"
    fi
  done

  printf '    <AllowedHeader>*</AllowedHeader>\n'
  printf '    <ExposeHeader>ETag</ExposeHeader>\n'
  printf '    <MaxAgeSeconds>600</MaxAgeSeconds>\n'
  printf '  </CORSRule>\n'
  printf '</CORSConfiguration>\n'
} >"$cors_file"

mc cors set "$mc_alias/$MEDIA_S3_BUCKET" "$cors_file" >/dev/null

echo "Media storage bootstrap завершён для bucket $MEDIA_S3_BUCKET"
