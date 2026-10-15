#!/bin/sh

set -eu

mc alias set aero "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
object="$MEDIA_S3_BUCKET/bootstrap-smoke.txt"
printf 'aerochat-storage-bootstrap\n' | mc pipe "aero/$object" >/dev/null
[ "$(mc cat "aero/$object")" = "aerochat-storage-bootstrap" ]
mc rm "aero/$object" >/dev/null
echo "Authenticated S3 write/read/delete smoke passed"
