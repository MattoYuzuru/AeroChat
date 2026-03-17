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
  - compose публикует только `web` и `aero-gateway` на одном host IP, достижимом из pod'ов `Traefik`;
  - shared `Traefik` остаётся единственным публичным edge на `80/443`;
  - TLS обслуживается через cluster `cert-manager`, а не через host-level certificate path.

## Runtime topology

На одном VPS одновременно живут два слоя:

1. Host runtime
   - `web` как контейнер со статически собранным frontend;
   - `aero-gateway` как единственная backend edge-точка;
   - `aero-identity` и `aero-chat` как внутренние сервисы;
   - `postgres`, `redis`, `minio` как внутренние зависимости.

2. Cluster edge
   - shared `Traefik` как единственный публичный HTTP/TLS ingress;
   - `Service` без selector и `EndpointSlice`, указывающие на host upstream'ы AeroChat;
   - `Ingress` и `Middleware`, которые маршрутизируют `aero.keykomi.com`;
   - `cert-manager`, который выпускает TLS secret для ingress.

Поток traffic выглядит так:

- browser → `Traefik`
- `Traefik` → Kubernetes `Ingress`
- `Ingress` → `Service` / `EndpointSlice`
- `EndpointSlice` → `${AERO_SHARED_EDGE_HOST_IP}:${AERO_WEB_HOST_PORT}` или `${AERO_SHARED_EDGE_HOST_IP}:${AERO_GATEWAY_HOST_PORT}`
- `aero-gateway` → `aero-identity`, `aero-chat` по compose DNS
- `aero-identity` → `postgres`
- `aero-chat` → `postgres`, `redis`

Наружу не публикуются:

- `aero-identity`
- `aero-chat`
- `postgres`
- `redis`
- `minio`

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
  - здесь же фиксируются `AERO_SHARED_EDGE_HOST_IP`, `AERO_WEB_HOST_PORT` и `AERO_GATEWAY_HOST_PORT`.

- `.env.server.secrets` на VPS
  - реальная рабочая копия секретов;
  - этот файл не коммитится;
  - значения из него существуют только на сервере.

На текущем этапе к server-only секретам относятся:

- `POSTGRES_PASSWORD`
- `MINIO_ROOT_PASSWORD`

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
- `/readyz` через `aero-gateway`.

Минимальный пример ресурсов лежит в:

- [aero.keykomi.com.example.yaml](/home/mattoyudzuru/GolandProjects/AeroChat/infra/k8s/shared-edge/aero.keykomi.com.example.yaml)

Перед применением оператор обязан заменить:

- `192.0.2.10` на фактическое значение `AERO_SHARED_EDGE_HOST_IP` из `.env.server`;
- `letsencrypt-prod` на реальный `ClusterIssuer`, если в кластере используется другое имя;
- `ingressClassName`, если shared `Traefik` использует нестандартный ingress class;
- namespace, если выбран не `aerochat-edge`.

## Что готово сейчас

- production-oriented compose topology без собственного публичного `nginx`;
- `aero-gateway` остаётся единственной backend edge-точкой;
- explicit host upstream contract через `AERO_SHARED_EDGE_HOST_IP` и high ports;
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
- host IP VPS, достижимый из pod'ов `Traefik`;
- возможность ограничить high ports так, чтобы они не стали вторым публичным edge.

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
- `AERO_SHARED_EDGE_HOST_IP`
- `AERO_WEB_HOST_PORT`
- `AERO_GATEWAY_HOST_PORT`

Ожидаемая семантика:

- `AERO_SHARED_EDGE_HOST_IP` должен быть достижим из pod'ов `Traefik`;
- этот же адрес должен использоваться в Kubernetes `EndpointSlice`;
- `AERO_WEB_HOST_PORT` обслуживает frontend upstream;
- `AERO_GATEWAY_HOST_PORT` обслуживает backend upstream для `/api`, `/healthz` и `/readyz`;
- тот же `AERO_GATEWAY_HOST_PORT` обслуживает и websocket endpoint `/api/realtime`;
- high ports не должны оставаться бесконтрольно доступными извне.

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
```

Если один из сервисов не выходит в `ready`, смотри в первую очередь:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  logs --tail=100 aero-identity aero-chat
```

7. Подготовь cluster-side manifest example.

Открой `infra/k8s/shared-edge/aero.keykomi.com.example.yaml` и синхронно замени:

- `192.0.2.10` на `AERO_SHARED_EDGE_HOST_IP`;
- `18080` и `18081`, если в `.env.server` выбраны другие порты;
- `letsencrypt-prod`, если `ClusterIssuer` называется иначе;
- namespace, если нужен другой.

8. Примени ресурсы в кластер:

```bash
kubectl apply -f infra/k8s/shared-edge/aero.keykomi.com.example.yaml
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
```

Если используется другой домен, замени `aero.keykomi.com` на значение `AERO_EDGE_DOMAIN`.

## Что означают проверки

- `http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_WEB_HOST_PORT}/`
  - показывает, что frontend upstream жив на host runtime.

- `http://${AERO_SHARED_EDGE_HOST_IP}:${AERO_GATEWAY_HOST_PORT}/readyz`
  - показывает, что backend readiness chain доступна напрямую.

- `https://<domain>/`
  - показывает, что `Traefik` действительно отдаёт frontend домена.

- `https://<domain>/healthz`
  - показывает процесс-level health через публичный edge path.

- `https://<domain>/readyz`
  - подтверждает, что `Traefik` и backend readiness chain работают вместе.

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

Rollback делается тем же flow после возврата `AERO_IMAGE_TAG` на предыдущий known-good tag.

## Если меняются host IP или upstream ports

Это отдельный операторский случай.

Нужно синхронно обновить:

- `AERO_SHARED_EDGE_HOST_IP` в `.env.server`;
- `AERO_WEB_HOST_PORT` и `AERO_GATEWAY_HOST_PORT` в `.env.server`, если менялись порты;
- оба `EndpointSlice` в Kubernetes manifest;
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
