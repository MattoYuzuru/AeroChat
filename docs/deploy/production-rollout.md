# Production rollout automation и first external launch

Этот документ описывает operational slice для production rollout AeroChat на VPS, где:

- публичный edge принадлежит shared `Traefik` в `k3s`;
- TLS обслуживается existing `cert-manager`;
- AeroChat runtime живёт в `docker-compose`;
- production deploy остаётся ручным и tag-driven.

Цель текущего этапа:

- выполнять production rollout только вручную и явно;
- использовать GitHub Environment `production` как deploy gate;
- менять на сервере только выбранный `AERO_IMAGE_TAG`;
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
- deploy directory на VPS уже существует и содержит актуальный checkout репозитория;
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

1. принимает входной `image_tag`;
2. проверяет обязательные environment secrets и variables;
3. подключается к VPS по SSH;
4. подтверждает наличие `.env.server`, `.env.server.secrets` и compose file;
5. обновляет `AERO_IMAGE_TAG` в `.env.server`;
6. выполняет `docker compose ... config`;
7. выполняет `docker compose ... pull`;
8. выполняет `docker compose ... up -d`;
9. показывает `docker compose ... ps`;
10. читает `AERO_SHARED_EDGE_HOST_IP`, `AERO_WEB_HOST_PORT`, `AERO_GATEWAY_HOST_PORT` и `AERO_MEDIA_HOST_PORT` из `.env.server`;
11. ждёт успешных проверок:
    - `http://<shared-edge-host-ip>:<web-port>/`
    - `http://<shared-edge-host-ip>:<gateway-port>/readyz`
    - `http://<shared-edge-host-ip>:<media-port>/minio/health/live`
    - `https://<domain>/`
    - `https://<domain>/healthz`
    - `https://<domain>/readyz`
    - `https://<media-domain>/minio/health/live`

Workflow намеренно не трогает:

- `.env.server.secrets`;
- Kubernetes manifests;
- `cert-manager` и TLS secrets;
- git checkout на VPS;
- release selection для отдельных сервисов по разным тегам.

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
6. Выбрать первый стабильный `image_tag`.
   Для первого live run рекомендуется `vX.Y.Z`, а не `edge`.
7. Открыть GitHub Actions и вручную запустить workflow `Deploy Production`.
8. Передать выбранный `image_tag` в `workflow_dispatch`.
9. Дождаться успешного завершения job и встроенных upstream/HTTPS проверок.
10. С внешней машины выполнить базовую проверку домена:

```bash
curl -fsS https://aero.keykomi.com/
curl -fsS https://aero.keykomi.com/healthz
curl -fsS https://aero.keykomi.com/readyz
curl -fsS https://media.aero.keykomi.com/minio/health/live
```

11. Открыть `https://aero.keykomi.com/` в браузере и проверить:
    - загрузку web shell;
    - успешный login или register;
    - работу `/api` через обычный пользовательский flow;
    - успешный websocket upgrade на `/api/realtime` после login.
12. При ручном API smoke для `CreateAttachmentUploadIntent` проверить, что presigned URL указывает на media subdomain,
    а не на внутренний `minio:9000` или основной application domain.
13. Зафиксировать предыдущий known-good tag и текущий deployed tag в операторском журнале или release notes.

Если register/login падают после успешного `upstream`- и `HTTPS`-smoke, отдельно проверь логи bootstrap:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  logs --tail=100 aero-identity aero-chat
```

В командах выше `aero.keykomi.com` и `media.aero.keykomi.com` нужно заменить
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
- `docker compose logs --tail=100 web aero-gateway aero-identity aero-chat postgres redis minio`;
- `kubectl -n aerochat-edge get ingress,endpointslices,certificate`;
- открытие главной страницы и auth flow через реальный браузер;
- отсутствие TLS warning при внешнем заходе на application и media домены.

## Rollback

Rollback делается тем же workflow и тем же operator contract:

1. Определи предыдущий известный рабочий tag.
2. Запусти workflow `Deploy Production` ещё раз.
3. Передай предыдущий tag как `image_tag`.
4. Дождись тех же upstream и HTTPS checks.

Это сознательно тот же tag-driven flow, а не отдельная rollback automation.

### Manual fallback

Если GitHub Actions недоступен, fallback остаётся таким же, как в bootstrap runbook:

1. Зайди на VPS по SSH.
2. Верни `AERO_IMAGE_TAG` в `.env.server` на предыдущий known-good tag.
3. Выполни `docker compose ... pull`.
4. Выполни `docker compose ... up -d`.
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
