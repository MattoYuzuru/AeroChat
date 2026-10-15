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
- codeload archives и исходные `go.mod`/`go.sum` проверяются SHA-256; dependency maintenance overlay создаётся штатными Go tooling из отдельной копии и закрепляется checksum manifest. Сборка использует штатный checksum database и `-mod=readonly`;
- maintained compiler Go 1.27.2 / Alpine 3.24 закрепляется OCI manifest-list digest; runtime Alpine 3.23.4 сохраняет отдельный pin. `GOTOOLCHAIN=local` исключает неявную замену compiler;
- source archive с лицензией, effective module overlay, manifest и рецепт сборки включаются в каждый image. OCI labels различают upstream source/commit/license и AeroChat maintenance variant; фактические Go/buildinfo и binary SHA-256 являются отдельным evidence;
- оба Compose-файла используют эти build targets. Storage sources не зависят от workspace Go toolchain;
- CI `Storage Bootstrap` выполняет source build без восстановления cache, bootstrap PostgreSQL/private bucket, authenticated S3 write/read/delete, anonymous denial и browser CORS preflight. Image IDs и исходный Dockerfile сохраняются как provenance artifact для точного SHA.

В текущем slice registry mirror не публикуется. Server строит storage из pinned sources до запуска; application images остаются GHCR-based. При будущей публикации storage mirrors требуется сохранить provenance и использовать **полученный после публикации** digest, а не придумывать registry digest для локального image ID.

## Последствия

Storage bootstrap больше не зависит от удалённых legacy binary images, но требует доступности Docker Hub base images, GitHub codeload и Go module proxy/checksum database. Первый запуск дороже по времени и ресурсам. Неизменный image ID между разными builder versions не обещается: reproducibility здесь означает проверенные source/base pins и повторяемую функциональную сборку, а receipt фиксирует конкретный результат.

Это восстановление acquisition lifecycle, не обещание upstream security maintenance: выбранный archived release не получает исправлений. В проверенных неизменённых sources на Go 1.27.2 для Linux/arm64 остаются 38 called advisory IDs MinIO и 11 mc. Это source callgraph findings, не доказанная эксплуатация runtime. Compiler-only upgrade не устраняет third-party closure.

Maintenance ограничивается reviewed fixed dependency floors и необходимыми resolver constraints без изменения upstream service/provider/auth/crypto поведения. Перед сборкой проверяются обе effective source closure; called findings и инфраструктурные ошибки отклоняют gate. No-fixed module-only OpenPGP inventory сохраняется явно, исключений по ID или package exclusion нет. Несовместимый API, новый called/no-fixed finding или необходимое изменение provider source требуют отдельного review.

Original archives и historical image tags/IDs сохраняются. Новые tags обозначают maintenance variant с effective manifest digest; они не подменяют старое recovery evidence. Cold build и tiny private S3/readiness fixture выполняются отдельно на frozen source. До их успешных receipts подготовка overlay не считается maintenance pass. Переход на поддерживаемый provider и более широкий security assessment остаются отдельной задачей. Existing volumes не удаляются; bucket privacy, CORS env и S3 namespace сохраняются.

## Источники

- [MinIO source-only distribution](https://github.com/minio/minio#source-only-distribution)
- [Server go.mod](https://github.com/minio/minio/blob/7ced9663e6a791fef9dc6be798ff24cda9c730ac/go.mod)
- [Client go.mod](https://github.com/minio/mc/blob/7394ce0dd2a80935aded936b09fa12cbb3cb8096/go.mod)
- [Docker ADD checksum](https://docs.docker.com/reference/dockerfile/#add---checksum)
- [Isolated BuildKit state](https://docs.docker.com/build/builders/drivers/docker-container/)
