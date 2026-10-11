# ADR-090: Exact-SHA gates и immutable release manifest

- Статус: Proposed
- Дата: 2026-10-11
- Задача: [#164](https://github.com/MattoYuzuru/AeroChat/issues/164)
- Частично заменяет delivery/selection contract ADR-020 и ADR-021.

## Контекст

Отдельный Publish Images workflow запускался по main и version tags независимо от CI. Matrix failure могла частично обновить application `edge` tags. Одинаковый tag не гарантировал полный набор images одного source SHA, а runtime диагностировал `version=dev`.

## Решение

CI становится reusable workflow с обязательным `source_sha`. Main/tag publication вызывает его на том же commit через локальную ссылку workflow: не ищет чужой успешный run и не доверяет статусу другого SHA. Все checkouts выбирают переданный SHA; workflow сверяет Git HEAD. Proto/SQLC generation/drift, Go tests/lint, web tests/lint/build, Compose и workflow validation выполняются до application image builds.

Image matrix строит ровно пять linux/amd64 application images **без registry writes** и сохраняет Docker archives в run-scoped Actions artifacts. Single publish job зависит от успеха всего reusable gate, получает эти archives без повторной сборки и проверяет все пять revision labels до первой публикации. Write permission `packages: write` получает только этот job; PR CI и quality gate имеют read-only permission.

Application images публикуются с `sha-<source SHA>` reference; deployment использует полученные digests. После успешного push всех пяти images publisher создаёт один OCI artifact `aerochat-release` типа `application/vnd.aerochat.release.v1+json`. JSON содержит schema version, полный source SHA и ровно пять image references `ghcr.io/<owner>/aerochat-<service>@sha256:...`. ORAS 1.3.0 закреплён action commit и checksum официального binary archive. Итоговый release digest и source SHA попадают в workflow summary.

Publication failure после некоторых immutable image pushes может оставить отдельные images, но не полный новый release manifest. Старые release digests сохраняются; moving application `edge`/major/semver tags больше не продвигаются. Повторный запуск не обещает прежний digest новой сборки: deployment выбирает конкретный manifest digest, а не tag.

Deploy Production принимает `release_digest` + `source_sha`. Перед SSH он проверяет OCI artifact type/revision/единственный bounded JSON layer и release schema. Arbitrary registry namespaces, чужие repository names, tags, неполный набор services и несовпадающий SHA отклоняются. Layer скачивается по digest без распаковки архивов. На сервер передаётся только JSON metadata; секреты остаются в прежних server env files.

Server checkout обязан уже соответствовать выбранному source SHA. Helper повторно валидирует JSON и создаёт Compose overlay для пяти application image digests. Go Dockerfiles получают `main.version` через build revision; gateway readiness должен подтвердить выбранный source SHA до сохранения release selection в `.env.server`. Rollback выбирает предыдущую пару release digest/source SHA и сохранённый overlay; volumes не удаляются. Storage acquisition/provenance описаны отдельно в ADR-087.

## Последствия

Релиз становится полной проверенной группой digests одного source SHA. CI image archives требуют дополнительного artifact storage (retention 7 дней); production серверу нужны актуальный checkout и Python 3 для schema validation. ORAS нужен только Actions runner. Полный runtime bootstrap зависит от принятия #163; legacy storage images не используются как доказательство clean host.

Это policy/configuration change, не выполненная production publication/deployment. Local negative fixtures и workflow lint не доказывают hosted branch protection или отказ публикации реального failing main/tag candidate. Hosted negative publication, GHCR artifact write/read и production health/rollback требуют отдельно разрешённой проверки. CI не получает секреты production и не выполняет deployment.

## Источники

- [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
- [ORAS push/pull](https://oras.land/docs/how_to_guides/pushing_and_pulling/)
- [ORAS blob fetch by digest](https://oras.land/docs/commands/oras_blob_fetch/)
- [ORAS setup action](https://github.com/oras-project/setup-oras/tree/22ce207df3b08e061f537244349aac6ae1d214f6)
