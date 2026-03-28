# Single-server bootstrap, shared k3s / Traefik edge и operator fallback flow

Этот документ описывает базовую подготовку одного VPS для финальной deployment-модели AeroChat, где:

- публичный edge принадлежит shared `Traefik` в `k3s`;
- TLS выпускается и обновляется через существующий `cert-manager`;
- AeroChat runtime продолжает жить в `docker-compose`;
- приложение не мигрирует целиком в Kubernetes.

Цель текущего этапа:

- сохранить single-server self-host runtime;
- использовать `Traefik` как единственный публичный edge;
- дать минимальный и воспроизводимый cluster-side contract для `aero.keykomi.com`;
- сохранить ручной fallback flow для update и rollback;
- не превращать документ в provisioning кластера, полную Kubernetes-миграцию или zero-downtime orchestration.

Основной production rollout по GitHub Actions описан отдельно в
[production-rollout runbook](/home/mattoyudzuru/GolandProjects/AeroChat/docs/deploy/production-rollout.md).
Этот документ остаётся source of truth для server preparation, shared edge contract и ручного fallback flow.

## Модель окружений

В репозитории фиксированы два отдельных режима:

- `local/dev`
  - root `.env.example` управляет локальным compose-стеком;
  - `infra/compose/docker-compose.yml` подходит для локального full-stack smoke запуска;
  - локальный `nginx` контейнер по-прежнему используется только в dev-runtime;
  - `services/*/.env.example` и `apps/web/.env.example` остаются примерами для source-mode запуска вне compose.

- `server/prod-like`
  - `.env.server.example` содержит только versioned non-secret runtime config;
  - `.env.server.secrets.example` содержит только перечень обязательных secret keys с плейсхолдерами;
  - `infra/compose/docker-compose.server.yml` тянет предсобранные application images из registry;
  - publish-процесс для `aerochat-web` сохраняет conservative STUN fallback для direct calls;
  - canonical TURN/STUN policy теперь задаётся через `AERO_RTC_STUN_URLS`, `AERO_RTC_TURN_URLS`,
    `AERO_RTC_TURN_USERNAME_TTL` и server secret `AERO_RTC_TURN_AUTH_SECRET`, которые читает `aero-rtc-control`;
  - repo-managed `turn` runtime теперь поднимается тем же `docker-compose.server.yml` в `host` network mode;
  - для direct calls server env отдельно различает internal shared-edge host IP и public TURN relay IP через
    `AERO_RTC_TURN_EXTERNAL_IP` и опциональный `AERO_RTC_TURN_RELAY_IP`;
  - compose публикует `web`, `aero-gateway` и `minio` API на одном host IP, достижимом из pod'ов `Traefik`;
  - shared `Traefik` остаётся единственным публичным edge на `80/443`;
  - TLS обслуживается через cluster `cert-manager`, а не через host-level certificate path.

## Runtime topology

На одном VPS одновременно живут два слоя:

1. Host runtime
   - `web` как контейнер со статически собранным frontend;
   - `aero-gateway` как единственная backend edge-точка;
   - `aero-identity` и `aero-chat` как внутренние сервисы;
   - `postgres`, `redis`, `minio` как внутренние зависимости;
   - `turn` как отдельный host-network service для browser media relay.

2. Cluster edge
   - shared `Traefik` как единственный публичный HTTP/TLS ingress;
   - `Service` без selector и `EndpointSlice`, указывающие на host upstream'ы AeroChat;
   - `Ingress` и `Middleware`, которые маршрутизируют `aero.keykomi.com` и `media.keykomi.com`;
   - `cert-manager`, который выпускает TLS secret для ingress.

Поток traffic выглядит так:

- browser → `Traefik`
- `Traefik` → Kubernetes `Ingress`
- `Ingress` → `Service` / `EndpointSlice`
- `EndpointSlice` → `${AERO_SHARED_EDGE_HOST_IP}:${AERO_WEB_HOST_PORT}`, `${AERO_SHARED_EDGE_HOST_IP}:${AERO_GATEWAY_HOST_PORT}` или `${AERO_SHARED_EDGE_HOST_IP}:${AERO_MEDIA_HOST_PORT}`
- `aero-gateway` → `aero-identity`, `aero-chat` по compose DNS
- `aero-identity` → `postgres`
- `aero-chat` → `postgres`, `redis`, `minio`

Через host upstream не публикуются:

- `aero-identity`
- `aero-chat`
- `postgres`
- `redis`

Отдельно публикуется только MinIO API upstream для media edge:

- `${AERO_SHARED_EDGE_HOST_IP}:${AERO_MEDIA_HOST_PORT}` → `minio:9000`

При этом `MinIO Console` и public bucket discovery наружу не публикуются.

Для RTC отдельно публикуется не-HTTP runtime:

- TURN listener на `3478` по умолчанию;
- relay range `49160-49200` по умолчанию.

Эти ports не проходят через `Traefik` и должны быть разрешены отдельно на host/firewall уровне.

## Server env-модель

Для одного VPS фиксируется двухфайловая модель:

- `.env.server.example`
  - versioned шаблон для несекретных runtime-настроек;
  - сюда входят image namespace/tag, primary domain, node-reachable host IP и high ports;
  - этот файл можно безопасно хранить в репозитории как пример.

- `.env.server.secrets.example`
  - versioned шаблон только для имён обязательных секретных переменных;
  - реальных значений в репозитории быть не должно.

- `.env.server` на VPS
  - реальная рабочая копия non-secret runtime config;
  - оператор обычно меняет здесь `AERO_IMAGE_TAG`;
  - здесь же фиксируются `AERO_SHARED_EDGE_HOST_IP`, `AERO_WEB_HOST_PORT`, `AERO_GATEWAY_HOST_PORT`, `AERO_MEDIA_HOST_PORT`,
    `AERO_MEDIA_EDGE_DOMAIN`, `MEDIA_S3_PUBLIC_ENDPOINT`, `MEDIA_S3_CORS_ALLOWED_ORIGINS`,
    `AERO_RTC_TURN_EXTERNAL_IP`, `AERO_RTC_TURN_RELAY_IP` и relay port range для coturn.
  - `AERO_MEDIA_EDGE_DOMAIN` должен быть отдельным zone-level sibling-host, а не nested host под `AERO_EDGE_DOMAIN`.

- `.env.server.secrets` на VPS
  - реальная рабочая копия секретов;
  - этот файл не коммитится;
  - значения из него существуют только на сервере.

На текущем этапе к server-only секретам относятся:

- `POSTGRES_PASSWORD`
- `MINIO_ROOT_PASSWORD`
- `AERO_RTC_TURN_AUTH_SECRET`

## Что версионируется и что создаётся только в runtime

В репозитории версионируются:

- `infra/compose/docker-compose.server.yml`;
- `.env.server.example`;
- `.env.server.secrets.example`;
- `infra/k8s/shared-edge/aero.keykomi.com.example.yaml`;
- этот runbook и ADR.

Только на VPS создаются:

- `.env.server`;
- `.env.server.secrets`;
- реальные volumes Docker Compose;
- host firewall rules и иные network restrictions для high ports.
- прямой TURN listener и relay port range на самом VPS.

Только в кластере существуют:

- namespace для AeroChat ingress resources;
- `Service`, `EndpointSlice`, `Middleware`, `Ingress`;
- TLS secret, выпущенный `cert-manager`.

## Shared edge contract

`Traefik` должен обслуживать:

- `/` и SPA routes через `web`;
- `/api` через `aero-gateway` со strip-prefix `/api`;
- `/api/realtime` через `aero-gateway`;
- `/healthz` через `aero-gateway`;
- `/readyz` через `aero-gateway`;
- весь host `media.<zone-domain>` через `minio`.

Минимальный пример ресурсов лежит в:

- [aero.keykomi.com.example.yaml](/home/mattoyudzuru/GolandProjects/AeroChat/infra/k8s/shared-edge/aero.keykomi.com.example.yaml)

Перед применением оператор обязан заменить:

- `192.0.2.10` на фактическое значение `AERO_SHARED_EDGE_HOST_IP` из `.env.server`;
- `letsencrypt-prod` на реальный `ClusterIssuer`, если в кластере используется другое имя;
- `ingressClassName`, если shared `Traefik` использует нестандартный ingress class;
- `aero.keykomi.com` и `media.keykomi.com`, если используются другие домены;
- namespace, если выбран не `aerochat-edge`.

## Что готово сейчас

- production-oriented compose topology без собственного публичного `nginx`;
- `aero-gateway` остаётся единственной backend edge-точкой;
- explicit host upstream contract через `AERO_SHARED_EDGE_HOST_IP` и high ports;
- отдельный media edge для browser-visible object storage traffic;
- repo-managed TURN runtime для direct-call relay path;
- автоматический bootstrap bucket privacy и CORS через `mc`;
- минимальные Kubernetes resources для shared `Traefik`;
- TLS path через existing `cert-manager`;
- manual bootstrap/update/rollback flow как fallback;
- manual GitHub Actions rollout через environment `production`.

## Что намеренно отложено

- установка и bootstrap самого `k3s`;
- установка и bootstrap `Traefik` или `cert-manager`;
- полная Kubernetes-миграция AeroChat;
- host firewall automation;
- zero-downtime rollout;
- backup/restore automation;
- multi-host и blue-green topology.

## Подготовка VPS и кластера

Минимально нужны:

- Linux VPS;
- Docker Engine;
- Docker Compose plugin;
- single-node или shared `k3s`, внутри которого уже работает `Traefik`;
- уже установленный `cert-manager`;
- `kubectl` с доступом к целевому кластеру;
- домен `aero.keykomi.com`, указывающий на текущий edge;
- отдельный media host внутри той же зоны, например `media.keykomi.com`, указывающий на тот же edge;
- host IP VPS, достижимый из pod'ов `Traefik`;
- публичный IP VPS, который соответствует host из `AERO_RTC_TURN_URLS`;
- возможность ограничить high ports так, чтобы они не стали вторым публичным edge.

Для current launch-target за Cloudflare это важно отдельно:

- application host может оставаться `aero.<zone-domain>`;
- media host не должен становиться `media.aero.<zone-domain>`;
- канонический production contract использует sibling-host вида `media.<zone-domain>`;
- это соответствует hostname-модели из `ADR-037` и не требует отдельного second-level certificate slice.

## Первый bootstrap на VPS

1. Клонируй репозиторий на VPS или обнови уже существующую рабочую директорию.

2. Скопируй оба server env-шаблона в реальные server-only файлы:

```bash
cp .env.server.example .env.server
cp .env.server.secrets.example .env.server.secrets
```

3. Заполни `.env.server` и `.env.server.secrets`.

Минимально важные non-secret переменные в `.env.server`:

- `AERO_IMAGE_NAMESPACE`
- `AERO_IMAGE_TAG`
- `AERO_EDGE_DOMAIN`
- `AERO_MEDIA_EDGE_DOMAIN`
- `AERO_SHARED_EDGE_HOST_IP`
- `AERO_WEB_HOST_PORT`
- `AERO_GATEWAY_HOST_PORT`
- `AERO_MEDIA_HOST_PORT`
- `MEDIA_S3_PUBLIC_ENDPOINT`
- `MEDIA_S3_CORS_ALLOWED_ORIGINS`
- `AERO_WEB_PUSH_SUBSCRIBER`
- `AERO_WEB_PUSH_VAPID_PUBLIC_KEY`
- `AERO_RTC_TURN_EXTERNAL_IP`
- `AERO_RTC_TURN_RELAY_IP`
- `AERO_RTC_TURN_LISTEN_PORT`
- `AERO_RTC_TURN_MIN_RELAY_PORT`
- `AERO_RTC_TURN_MAX_RELAY_PORT`

Ожидаемая семантика:

- `AERO_SHARED_EDGE_HOST_IP` должен быть достижим из pod'ов `Traefik`;
- этот же адрес должен использоваться в Kubernetes `EndpointSlice`;
- `AERO_WEB_HOST_PORT` обслуживает frontend upstream;
- `AERO_GATEWAY_HOST_PORT` обслуживает backend upstream для `/api`, `/healthz` и `/readyz`;
- тот же `AERO_GATEWAY_HOST_PORT` обслуживает и websocket endpoint `/api/realtime`;
- `AERO_MEDIA_EDGE_DOMAIN` должен быть zone-level sibling-host относительно application host;
- пример для current topology: `AERO_EDGE_DOMAIN=aero.keykomi.com` и `AERO_MEDIA_EDGE_DOMAIN=media.keykomi.com`;
- `AERO_MEDIA_HOST_PORT` обслуживает MinIO API upstream для `https://${AERO_MEDIA_EDGE_DOMAIN}`;
- `MEDIA_S3_PUBLIC_ENDPOINT` должен совпадать с browser-visible media origin, а не с `minio:9000`;
- `MEDIA_S3_CORS_ALLOWED_ORIGINS` должен перечислять только доверенные application origins;
- `AERO_WEB_PUSH_SUBSCRIBER` должен содержать корректный VAPID subject, обычно `mailto:` URL;
- `AERO_WEB_PUSH_VAPID_PUBLIC_KEY` должен совпадать с private key из `.env.server.secrets`;
- `AERO_RTC_TURN_EXTERNAL_IP` должен соответствовать browser-visible TURN host из `AERO_RTC_TURN_URLS`;
- `AERO_RTC_TURN_RELAY_IP` должен указывать на локальный bind IP хоста, если public TURN IP не принадлежит интерфейсу VPS;
- при NAT-сценарии coturn будет рекламировать mapping `AERO_RTC_TURN_EXTERNAL_IP/AERO_RTC_TURN_RELAY_IP`;
- `AERO_RTC_TURN_LISTEN_PORT` и relay range должны совпадать с реально открытыми host/firewall ports.
- high ports не должны оставаться бесконтрольно доступными извне.

Минимально важные secret-переменные в `.env.server.secrets` дополнительно включают:

- `AERO_WEB_PUSH_VAPID_PRIVATE_KEY`

4. Проверь итоговую compose-конфигурацию:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  config
```

5. Загрузи выбранный release tag и подними runtime:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  pull

docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  up -d
```

На штатном first launch ручной `psql` не нужен:

- `aero-identity` автоматически применяет свои schema migrations до HTTP startup;
- `aero-chat` ждёт завершённый identity bootstrap и затем применяет свои migrations;
- `minio-bootstrap` один раз создаёт bucket, фиксирует private policy и валидирует media CORS env;
- `minio` применяет allowed origins из `MEDIA_S3_CORS_ALLOWED_ORIGINS`;
- при проблеме bootstrap сервис завершается с явной ошибкой в логах контейнера.

6. Проверь состояние контейнеров и прямые host upstream'ы:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  ps

curl -fsS "http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_WEB_HOST_PORT}/"
curl -fsS "http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_GATEWAY_HOST_PORT}/readyz"
curl -fsS "http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_MEDIA_HOST_PORT}/minio/health/live"
```

Для direct calls отдельно проверь TURN runtime:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  logs --tail=100 turn

ss -lntup | rg ':3478|:49160|:49200'
```

Если в логах `turn` видны `Cannot assign requested address` или `no available ports`,
значит `AERO_RTC_TURN_EXTERNAL_IP` / `AERO_RTC_TURN_RELAY_IP` не совпадают с реальным NAT/network contract VPS.

Для `minio-bootstrap` статус `Exited (0)` после успешного первого запуска является нормой:
это одноразовый helper, а не long-running сервис.

Если один из сервисов не выходит в `ready`, смотри в первую очередь:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  logs --tail=100 aero-identity aero-chat
```

7. Сгенерируй cluster-side manifest из `.env.server`.

Для реального apply не редактируй versioned example вручную.
Гораздо безопаснее отрендерить manifest прямо из `.env.server`, чтобы host IP и upstream ports
всегда совпадали с compose runtime:

```bash
infra/scripts/render-shared-edge-manifest.sh .env.server > /tmp/aerochat-shared-edge.yaml
```

Если нужно переопределить cluster-side defaults, задай перед рендером:

- `AERO_K8S_EDGE_NAMESPACE`
- `AERO_K8S_INGRESS_CLASS`
- `AERO_K8S_CLUSTER_ISSUER`

Versioned файл `infra/k8s/shared-edge/aero.keykomi.com.example.yaml` остаётся только иллюстративным примером.

8. Примени ресурсы в кластер:

```bash
kubectl apply -f /tmp/aerochat-shared-edge.yaml
```

9. Проверь, что shared edge увидел все ресурсы:

```bash
kubectl -n aerochat-edge get svc
kubectl -n aerochat-edge get endpointslices
kubectl -n aerochat-edge get middleware
kubectl -n aerochat-edge get ingress
kubectl -n aerochat-edge get certificate
```

Если namespace изменён, в командах выше подставь своё значение.

10. Дождись выпуска TLS-сертификата `cert-manager` и проверь публичный путь:

```bash
curl -fsS https://aero.keykomi.com/
curl -fsS https://aero.keykomi.com/healthz
curl -fsS https://aero.keykomi.com/readyz
curl -fsS https://media.keykomi.com/minio/health/live
```

Если используются другие домены, замени `aero.keykomi.com` и `media.keykomi.com`
на значения `AERO_EDGE_DOMAIN` и `AERO_MEDIA_EDGE_DOMAIN`.

## Что означают проверки

- `http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_WEB_HOST_PORT}/`
  - показывает, что frontend upstream жив на host runtime.

- `http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_GATEWAY_HOST_PORT}/readyz`
  - показывает, что backend readiness chain доступна напрямую.

- `http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_MEDIA_HOST_PORT}/minio/health/live`
  - показывает, что host upstream object storage жив и готов к media edge.

- `https://<domain>/`
  - показывает, что `Traefik` действительно отдаёт frontend домена.

- `https://<domain>/healthz`
  - показывает процесс-level health через публичный edge path.

- `https://<domain>/readyz`
  - подтверждает, что `Traefik` и backend readiness chain работают вместе.

- `https://<media-domain>/minio/health/live`
  - подтверждает, что shared `Traefik` корректно маршрутизирует отдельный media origin.

## Manual update и rollback flow

Если GitHub Actions недоступен, fallback остаётся таким:

1. Измени `AERO_IMAGE_TAG` в `.env.server`.
2. Выполни `docker compose ... config`.
3. Выполни `docker compose ... pull`.
4. Выполни `docker compose ... up -d`.
5. Проверь `docker compose ... ps`.
6. Снова проверь:
   - `http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_GATEWAY_HOST_PORT}/readyz`
   - `https://<domain>/readyz`
   - `https://<media-domain>/minio/health/live`

Rollback делается тем же flow после возврата `AERO_IMAGE_TAG` на предыдущий known-good tag.

## Если меняются host IP или upstream ports

Это отдельный операторский случай.

Нужно синхронно обновить:

- `AERO_SHARED_EDGE_HOST_IP` в `.env.server`;
- `AERO_WEB_HOST_PORT`, `AERO_GATEWAY_HOST_PORT` и `AERO_MEDIA_HOST_PORT` в `.env.server`, если менялись порты;
- `AERO_EDGE_DOMAIN`, `AERO_MEDIA_EDGE_DOMAIN`, `MEDIA_S3_PUBLIC_ENDPOINT` и `MEDIA_S3_CORS_ALLOWED_ORIGINS`, если меняются домены/origin;
- заново сгенерированный Kubernetes manifest и все `EndpointSlice` внутри него;
- при необходимости ограничения firewall.

Только после этого можно выполнять следующий rollout.

## Типовые границы ответственности

Репозиторий и workflow отвечают за:

- compose runtime contract;
- Kubernetes example manifests;
- tag-driven update flow;
- документацию operator steps.

Оператор отвечает за:

- фактическое значение `AERO_SHARED_EDGE_HOST_IP`;
- сетевую доступность этого адреса из `Traefik`;
- недопущение второго публичного edge через high ports;
- `kubectl apply` ingress-ресурсов;
- состояние `cert-manager`, `Traefik`, DNS и firewall;
- выбор release tag и внешний smoke после deploy.
