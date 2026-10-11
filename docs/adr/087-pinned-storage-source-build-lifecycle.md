# ADR-087: Воспроизводимые source images для object storage

- Статус: Proposed
- Дата: 2026-10-11
- Задача: [#163](https://github.com/MattoYuzuru/AeroChat/issues/163)

## Контекст

Штатные `minio/minio` и `minio/mc` images недоступны из registry на чистом runner. Оба upstream-репозитория архивированы; community MinIO теперь распространяется как исходники. Cached digest из аудита не является способом восстановления стенда. Смена S3-provider потребует отдельной проверки data migration и контрактов.

## Решение

Сохраняем текущий MinIO release и S3 semantics, но собираем собственные images в `infra/storage/Dockerfile`:

- server: upstream tag `RELEASE.2025-07-23T15-54-02Z`, commit `7ced9663e6a791fef9dc6be798ff24cda9c730ac`;
- client: tag `RELEASE.2025-08-13T08-35-41Z`, commit `7394ce0dd2a80935aded936b09fa12cbb3cb8096`;
- codeload archives проверяются SHA-256; Go modules — штатным checksum database и `-mod=readonly`;
- Go 1.25.8 и Alpine 3.23.4 закреплены OCI manifest-list digests; `GOTOOLCHAIN=local` исключает неявную замену compiler;
- source archive с лицензией включён в каждый image; OCI labels содержат upstream source/commit/license;
- оба Compose-файла используют эти build targets. Storage sources не зависят от workspace Go toolchain;
- CI `Storage Bootstrap` выполняет source build без восстановления cache, bootstrap PostgreSQL/private bucket, authenticated S3 write/read/delete, anonymous denial и browser CORS preflight. Image IDs и исходный Dockerfile сохраняются как provenance artifact для точного SHA.

В текущем slice registry mirror не публикуется. Server строит storage из pinned sources до запуска; application images остаются GHCR-based. При будущей публикации storage mirrors требуется сохранить provenance и использовать **полученный после публикации** digest, а не придумывать registry digest для локального image ID.

## Последствия

Storage bootstrap больше не зависит от удалённых legacy binary images, но требует доступности Docker Hub base images, GitHub codeload и Go module proxy/checksum database. Первый запуск дороже по времени и ресурсам. Неизменный image ID между разными builder versions не обещается: reproducibility здесь означает проверенные source/base pins и повторяемую функциональную сборку, а receipt фиксирует конкретный результат.

Это восстановление acquisition lifecycle, не обещание upstream security maintenance: выбранный archived release не получает исправлений. Переход на поддерживаемый provider и security assessment остаются отдельной задачей. Existing volumes не удаляются; bucket privacy, CORS env и S3 namespace сохраняются.

## Источники

- [MinIO source-only distribution](https://github.com/minio/minio#source-only-distribution)
- [Server go.mod](https://github.com/minio/minio/blob/7ced9663e6a791fef9dc6be798ff24cda9c730ac/go.mod)
- [Client go.mod](https://github.com/minio/mc/blob/7394ce0dd2a80935aded936b09fa12cbb3cb8096/go.mod)
- [Docker ADD checksum](https://docs.docker.com/reference/dockerfile/#add---checksum)
- [Isolated BuildKit state](https://docs.docker.com/build/builders/drivers/docker-container/)
