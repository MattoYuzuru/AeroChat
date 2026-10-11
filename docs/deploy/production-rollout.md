# Production rollout automation и first external launch

Этот документ описывает operational slice для production rollout AeroChat на VPS, где:

- публичный edge принадлежит shared `Traefik` в `k3s`;
- TLS обслуживается existing `cert-manager`;
- AeroChat runtime живёт в `docker-compose`;
- production deploy остаётся ручным и выбирает immutable release manifest.

Цель текущего этапа:

- выполнять production rollout только вручную и явно;
- использовать GitHub Environment `production` как deploy gate;
- выбирать все пять application image digests одного проверенного source SHA через release overlay;
- проверять и host upstream'ы, и HTTPS path через shared edge;
- не смешивать rollout с `kubectl apply`, cert-manager management и remote provisioning.

Workflow не занимается:

- подготовкой VPS или кластера с нуля;
- `git pull` или sync checkout на сервере;
- выпуском или renewal сертификатов;
- применением Kubernetes manifests;
- auto-rollback;
- zero-downtime orchestration.

## Что уже должно быть готово до workflow

Перед автоматизированным rollout должны быть завершены предыдущие platform slices:

- сервер подготовлен по
  [single-server bootstrap runbook](/home/mattoyudzuru/GolandProjects/AeroChat/docs/deploy/single-server-bootstrap.md);
- deploy directory на VPS уже существует и содержит checkout выбранного release source SHA;
- на VPS уже есть `.env.server` и `.env.server.secrets`;
- compose stack AeroChat уже умеет подниматься на
  `${AERO_SHARED_EDGE_HOST_IP}:${AERO_WEB_HOST_PORT}`,
  `${AERO_SHARED_EDGE_HOST_IP}:${AERO_GATEWAY_HOST_PORT}` и
  `${AERO_SHARED_EDGE_HOST_IP}:${AERO_MEDIA_HOST_PORT}`;
- Kubernetes resources из `infra/k8s/shared-edge/aero.keykomi.com.example.yaml` уже применены;
- `EndpointSlice` уже указывают на те же host IP и ports, что и `.env.server`;
- `cert-manager` уже выпустил сертификаты для `AERO_PROD_EDGE_DOMAIN` и `AERO_PROD_MEDIA_EDGE_DOMAIN`;
- `Traefik` уже обслуживает домены и маршруты `/`, `/api`, `/api/realtime`, `/healthz`, `/readyz`
  и отдельный media host.

Если compose topology, env contract или shared edge manifests менялись в репозитории, оператор обязан отдельно обновить
checkout на VPS и при необходимости повторно применить `kubectl apply` до первого запуска workflow.
Для этого рекомендуется рендерить manifest через `infra/scripts/render-shared-edge-manifest.sh .env.server`,
а не править versioned example вручную.

Для direct 1:1 calls это важно отдельно:

- текущий published `aerochat-web` image уже содержит default STUN fallback;
- canonical TURN/STUN policy теперь задаётся не через `VITE_*`, а через server env `AERO_RTC_STUN_URLS`,
  `AERO_RTC_TURN_URLS`, `AERO_RTC_TURN_USERNAME_TTL` и secret `AERO_RTC_TURN_AUTH_SECRET`;
- repo-managed `turn` runtime теперь входит в `docker-compose.server.yml`, поэтому при изменении TURN env
  оператор должен обновить не только `aero-rtc-control`, но и сам `turn` runtime;
- новый frontend build для смены ICE policy по-прежнему не требуется.

## GitHub Environment `production`

Workflow использует только GitHub Environment `production`.

Рекомендуемая настройка:

1. Создать environment с именем `production`.
2. Включить `Required reviewers`, если для репозитория нужен явный deploy approval.
3. При необходимости ограничить допустимые branch rules для deploy.
4. Заполнять production secrets и variables только внутри этого environment.

### Secrets

В `production` secrets должны быть заданы:

- `AERO_PROD_SSH_HOST`
- `AERO_PROD_SSH_PORT`
- `AERO_PROD_SSH_USER`
- `AERO_PROD_SSH_PRIVATE_KEY`
- `AERO_PROD_SSH_KNOWN_HOSTS`

### Variables

В `production` variables должны быть заданы:

- `AERO_PROD_DEPLOY_DIR`
  - абсолютный путь к checkout AeroChat на VPS;
  - пример: `/opt/aerochat/app`.

- `AERO_PROD_COMPOSE_FILE`
  - путь к server compose file относительно deploy directory;
  - для текущего репозитория ожидается `infra/compose/docker-compose.server.yml`.

- `AERO_PROD_EDGE_DOMAIN`
  - основной внешний домен shared deployment;
  - используется в HTTPS health/readiness проверках workflow.

- `AERO_PROD_MEDIA_EDGE_DOMAIN`
  - отдельный browser-visible media домен shared deployment;
  - для current Cloudflare-compatible contract ожидается sibling-host внутри той же зоны,
    например `media.keykomi.com` при `AERO_PROD_EDGE_DOMAIN=aero.keykomi.com`;
  - используется в HTTPS media health проверке workflow.

## Server-side prerequisites

На VPS должны быть доступны:

- `docker`
- `docker compose`
- `bash`
- `curl`
- `grep`
- `sed`

Также до первого rollout workflow обязаны существовать:

- deploy directory из `AERO_PROD_DEPLOY_DIR`;
- checkout репозитория с файлом `infra/compose/docker-compose.server.yml`;
- `.env.server`;
- `.env.server.secrets`;
- корректно заполненные `AERO_SHARED_EDGE_HOST_IP`, `AERO_WEB_HOST_PORT`, `AERO_GATEWAY_HOST_PORT`, `AERO_MEDIA_HOST_PORT`;
- уже поднятый shared edge path в Kubernetes;
- действующие сертификаты для `AERO_PROD_EDGE_DOMAIN` и `AERO_PROD_MEDIA_EDGE_DOMAIN`.

Workflow гарантирует существование deploy directory через `mkdir -p`, но не подготавливает checkout, env-файлы, cluster
resources и сертификаты за оператора.

## Что делает workflow

Manual workflow `Deploy Production` выполняет один последовательный цикл:

1. принимает `release_digest` и `source_sha` из успешного Publish Images summary;
2. валидирует OCI artifact и полный JSON manifest до SSH по [verified release contract](verified-release.md);
3. подключается к VPS, сверяет checkout SHA и повторно валидирует metadata;
4. подтверждает `.env.server`, `.env.server.secrets`, Compose и Python 3;
5. валидирует `AERO_WEB_PUSH_*`: полный absence даёт warning, partial-набор прерывает rollout;
6. создаёт immutable release overlay, сохраняет recovery record/previous overlay и сверяет applied schema/compatibility, затем выполняет Compose config/pull/up/ps с этим overlay;
7. проверяет пять runtime image digests/revision labels и ждёт успешных URL gates:
    - `http://<shared-edge-host-ip>:<web-port>/`
    - `http://<shared-edge-host-ip>:<gateway-port>/readyz`
    - `http://<shared-edge-host-ip>:<media-port>/minio/health/live`
    - `https://<domain>/`
    - `https://<domain>/healthz`
    - `https://<domain>/readyz`
    - `https://<media-domain>/minio/health/live`
8. требует выбранный SHA в gateway readiness и только после успеха сохраняет `AERO_RELEASE_DIGEST` / `AERO_RELEASE_SOURCE_SHA` в `.env.server`.

Workflow намеренно не трогает:

- `.env.server.secrets`;
- Kubernetes manifests;
- `cert-manager` и TLS secrets;
- git checkout на VPS;
- release selection отдельных сервисов вне полного manifest.

Важно:

- workflow по-прежнему не выполняет отдельный migration job;
- schema bootstrap происходит внутри `aero-identity` и `aero-chat` при их старте;
- `minio-bootstrap` в `docker compose ps` может находиться в состоянии `Exited (0)`, и это штатно;
- normal first launch и обычный rollout не требуют ручного `psql`, если SQL-файлы в образах актуальны.

## Первый внешний запуск

Рекомендуемый first launch checklist:

1. Подготовить VPS и cluster edge по
   [single-server bootstrap runbook](/home/mattoyudzuru/GolandProjects/AeroChat/docs/deploy/single-server-bootstrap.md).
2. Проверить, что deploy directory на VPS содержит актуальный checkout этого operational slice.
3. Проверить прямые upstream'ы:

```bash
curl -fsS "http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_WEB_HOST_PORT}/"
curl -fsS "http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_GATEWAY_HOST_PORT}/readyz"
curl -fsS "http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_MEDIA_HOST_PORT}/minio/health/live"
```

4. Проверить cluster resources:

```bash
kubectl -n aerochat-edge get svc
kubectl -n aerochat-edge get endpointslices
kubectl -n aerochat-edge get middleware
kubectl -n aerochat-edge get ingress
kubectl -n aerochat-edge get certificate
```

5. Создать и заполнить GitHub Environment `production`.
6. Выбрать manifest digest/source SHA из успешного Publish Images summary и заранее подготовить checkout этого SHA.
7. Для первого пустого runtime выполнить manual verified release flow, revision/readiness и пользовательский smoke, затем сохранить explicit known-good baseline по [recovery runbook](data-recovery.md). Workflow отвергает unknown previous selection; последующие rollout запускаются вручную через GitHub Actions `Deploy Production`.
8. Передать выбранные `release_digest` и `source_sha` в `workflow_dispatch`.
9. Дождаться успешного завершения job и встроенных upstream/HTTPS проверок.
10. С внешней машины выполнить базовую проверку домена:

```bash
curl -fsS https://aero.keykomi.com/
curl -fsS https://aero.keykomi.com/healthz
curl -fsS https://aero.keykomi.com/readyz
curl -fsS https://media.keykomi.com/minio/health/live
```

11. Открыть `https://aero.keykomi.com/` в браузере и проверить:
    - загрузку web shell;
    - успешный login или register;
    - работу `/api` через обычный пользовательский flow;
    - успешный websocket upgrade на `/api/realtime` после login.
12. Для direct calls отдельно проверить TURN runtime на VPS:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  logs --tail=100 turn

ss -lntup | rg ':3478|:49160|:49200'
```

Если VPS использует private host IP внутри cloud-сети, а browser видит отдельный public IP,
убедись, что `AERO_RTC_TURN_EXTERNAL_IP` и `AERO_RTC_TURN_RELAY_IP` не совпадают механически
и описывают корректный `public/private` mapping для coturn.

13. При ручном API smoke для `CreateAttachmentUploadIntent` проверить, что presigned URL указывает на
    `https://media.<zone-domain>`,
    а не на внутренний `minio:9000`, основной application domain или nested host вида `media.<application-host>`.
14. Зафиксировать предыдущий known-good tag и текущий deployed tag в операторском журнале или release notes.

Если register/login падают после успешного `upstream`- и `HTTPS`-smoke, отдельно проверь логи bootstrap:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  logs --tail=100 aero-identity aero-chat
```

В командах выше `aero.keykomi.com` и `media.keykomi.com` нужно заменить
на значения `AERO_PROD_EDGE_DOMAIN` и `AERO_PROD_MEDIA_EDGE_DOMAIN`, если домены отличаются.

## Verification после rollout

### Что проверяет сам workflow

Workflow на сервере дожидается успешного ответа для:

- `http://<shared-edge-host-ip>:<web-port>/`
- `http://<shared-edge-host-ip>:<gateway-port>/readyz`
- `http://<shared-edge-host-ip>:<media-port>/minio/health/live`
- `https://<domain>/`
- `https://<domain>/healthz`
- `https://<domain>/readyz`
- `https://<media-domain>/minio/health/live`

Этого достаточно, чтобы подтвердить:

- прямую доступность host runtime;
- живую readiness chain на gateway;
- готовность media upstream для object storage traffic;
- рабочий публичный path через shared `Traefik`;
- корректный TLS для application и media доменов.

### Что оператору стоит проверить дополнительно

- `docker compose ps` на VPS, если rollout выглядит подозрительно;
- `docker compose logs --tail=100 web aero-gateway aero-identity aero-chat postgres redis minio turn`;
- `kubectl -n aerochat-edge get ingress,endpointslices,certificate`;
- открытие главной страницы и auth flow через реальный браузер;
- `turn` логи без `Cannot assign requested address` и без `no available ports`;
- отсутствие TLS warning при внешнем заходе на application и media домены.

## Rollback

Перед любым image rollback применяется [DB-aware recovery contract](data-recovery.md): workflow сохраняет previous state до mutation и требует exact applied schema/compatibility preflight. Unknown previous selection блокирует automation; first empty bootstrap и explicit baseline выполняются оператором вручную. Возврат image digests сам по себе не откатывает данные или external configuration.

Rollback делается тем же workflow и тем же operator contract:

1. Определи предыдущие known-good manifest digest/source SHA и подготовь соответствующий checkout.
2. Запусти workflow `Deploy Production` ещё раз.
3. Передай предыдущие `release_digest` и `source_sha`.
4. Дождись тех же upstream и HTTPS checks.

Это тот же verified release flow, а не отдельная rollback automation.

### Manual fallback

Если GitHub Actions недоступен, fallback остаётся таким же, как в bootstrap runbook:

1. Зайди на VPS по SSH.
2. Выбери сохранённые metadata и checkout предыдущего known-good source SHA.
3. Повтори validation и Compose pull/up с immutable overlay по [manual verified release flow](verified-release.md).
4. Подтверди пять runtime digests/source SHA; сохраняй предыдущие volumes.
5. Снова проверь прямой gateway upstream, media upstream и публичные `https://<domain>/readyz`,
   `https://<media-domain>/minio/health/live`.

## Типовые границы ответственности

Workflow отвечает только за rollout already prepared AeroChat runtime.

Оператор отвечает за:

- актуальность checkout на VPS;
- секреты в `.env.server.secrets`;
- синхронность `.env.server` и Kubernetes `EndpointSlice`;
- состояние `Traefik`, `cert-manager`, DNS и firewall;
- `kubectl apply` при изменении edge manifests;
- выбор release tag;
- внешний пользовательский smoke после deploy.
