# Выбор проверенного immutable release

Контракт принятия описан в [ADR-090](../adr/090-exact-sha-gates-and-immutable-release-manifest.md). Он заменяет выбор application images через `AERO_IMAGE_TAG`. Compose base остаётся topology template; rollout всегда добавляет validated release overlay. Storage lifecycle/provenance остаётся отдельным #163 / ADR-087.

## Publication

`Publish Images` для main и `vX.Y.Z` вызывает reusable CI на точном candidate SHA. Tests/lint/generation/config checks проходят до image builds. Все пять images передаются в publish job через run-scoped archives; отказ одного build блокирует job целиком. После push всех пяти images публикуется один OCI release manifest. Workflow summary содержит:

- `ghcr.io/<owner>/aerochat-release@sha256:<digest>`;
- полный 40-character source SHA.

Application tags `sha-*` служат acquisition reference, но production выбирает manifest digest. `edge` и application semver/major tags больше не продвигаются. Failure после части image pushes может оставить отдельные images без release manifest; предыдущий release digest сохраняется.

## Подготовка

Нужен [known-good record и schema/data recovery plan](data-recovery.md). Automation не принимает unknown/partial previous selection; добавленные migrations требуют reviewed exact-SHA compatibility declaration. Manual first launch допустим только на доказанно пустых durable targets с последующим явным known-good baseline.

Сохранить предыдущие release digest/source SHA и JSON metadata для rollback. Server checkout должен **заранее** соответствовать выбранному source SHA; workflow его не переключает. На сервере нужны Docker Compose, Git и Python 3; `.env.server.secrets` сохраняется без изменений. ORAS 1.3.0 нужен Actions runner либо trusted operator client для acquisition; устанавливать ORAS на VPS для workflow не требуется.

## Manual acquisition и bootstrap

На trusted operator client с checkout этого tooling и ORAS задать `AERO_RELEASE_DIGEST` и `AERO_RELEASE_SOURCE_SHA` из успешного publication summary, затем получить один JSON layer по digest. Для private GHCR использовать штатный registry credential helper / `oras login`, без токенов в командах или файлах репозитория.

```bash
namespace=ghcr.io/mattoyuzuru
oras manifest fetch "$namespace/aerochat-release@$AERO_RELEASE_DIGEST" --output release-oci.json
layer="$(python3 infra/scripts/release_manifest.py artifact release-oci.json --source-sha "$AERO_RELEASE_SOURCE_SHA")"
oras blob fetch "$namespace/aerochat-release@$layer" --output "release-$AERO_RELEASE_SOURCE_SHA.json"
python3 infra/scripts/release_manifest.py blob release-oci.json --source-sha "$AERO_RELEASE_SOURCE_SHA" --blob "release-$AERO_RELEASE_SOURCE_SHA.json"
python3 infra/scripts/release_manifest.py validate "release-$AERO_RELEASE_SOURCE_SHA.json" \
  --source-sha "$AERO_RELEASE_SOURCE_SHA" --namespace "$namespace" \
  --overlay "release-compose-$AERO_RELEASE_SOURCE_SHA.json"
```

Передать metadata на VPS. Повторно выполнить `validate` там из выбранного checkout, затем использовать overlay для **каждой** mutating Compose-команды:

```bash
docker compose --env-file .env.server --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml -f "release-compose-$AERO_RELEASE_SOURCE_SHA.json" config --quiet
docker compose --env-file .env.server --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml -f "release-compose-$AERO_RELEASE_SOURCE_SHA.json" pull --ignore-buildable
docker compose --env-file .env.server --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml -f "release-compose-$AERO_RELEASE_SOURCE_SHA.json" up -d
python3 infra/scripts/release_manifest.py runtime "release-$AERO_RELEASE_SOURCE_SHA.json" \
  --source-sha "$AERO_RELEASE_SOURCE_SHA" --namespace "$namespace" \
  --compose-file infra/compose/docker-compose.server.yml --overlay "release-compose-$AERO_RELEASE_SOURCE_SHA.json" \
  --env-file .env.server --env-file .env.server.secrets
```

Runtime verification требует ровно пять запущенных application containers с выбранными digest refs и revision labels. После неё проверить прямые upstream и HTTPS gates по [rollout runbook](production-rollout.md); gateway `/readyz` должен вернуть выбранный SHA в `service.version`. После успеха сохранить release selection в `.env.server`. Metadata/overlays — runtime artifacts, они исключены из Git; named volumes сохраняются.

## Workflow и rollback

В `Deploy Production` передать `release_digest` и `source_sha`. Workflow валидирует artifact до SSH, повторно проверяет JSON и checkout на VPS, генерирует overlay, применяет Compose и health/source gates. Только после успешных gates он сохраняет `AERO_RELEASE_DIGEST` и `AERO_RELEASE_SOURCE_SHA` в `.env.server`.

Rollback — тот же flow с предыдущим digest/source SHA и соответствующим checkout. Metadata сохранённого known-good release повторно валидируется. Автоматического rollback и удаления volumes этот flow не выполняет.

## Граница evidence

Local schema/runtime mocks и actionlint проверяют отказ при incomplete/foreign/tagged refs, неверном SHA и неподходящем runtime. Они не доказывают hosted publication, branch protection, registry permissions или production health/rollback. Эти проверки требуют отдельной разрешённой delivery/deploy сессии; текущие remediation PR этого не выполняют.
