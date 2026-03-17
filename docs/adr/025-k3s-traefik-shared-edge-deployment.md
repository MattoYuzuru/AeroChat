# ADR-025: Shared k3s / Traefik edge deployment для single-server self-host

- Статус: Accepted
- Дата: 2026-04-03

## Контекст

После подготовки shared-host edge через host-level `nginx` подтвердилось реальное ограничение целевого VPS:

- публичный вход для уже работающих production-приложений идёт через `k3s + Traefik`;
- в кластере уже присутствует `cert-manager`;
- host `nginx` существует на машине, но не является основным публичным ingress-слоем для target deployment;
- останавливать существующие `Traefik` и связанные ingress-ресурсы нельзя;
- полностью переносить AeroChat runtime в Kubernetes в этом corrective slice нельзя.

Это означает, что `ADR-024` остаётся историческим документом, но больше не является source of truth для launch-target.

Нужно зафиксировать минимальную и безопасную модель:

- `docker-compose.server` остаётся app-runtime;
- публичный edge принадлежит только shared `Traefik` в `k3s`;
- TLS выпускается и обновляется через уже существующий `cert-manager`;
- `aero-gateway` остаётся единственной backend edge-точкой;
- изменение не превращается в redesign topology, продукта или deploy automation.

## Решение

### 1. Публичный edge принадлежит только `Traefik` в `k3s`

Для target VPS принимается следующая модель:

- внешние `80/tcp` и `443/tcp` обслуживаются shared `Traefik`;
- AeroChat не поднимает собственный публичный `nginx` и не требует отдельного host-level edge;
- host `nginx` не считается частью primary launch path для AeroChat;
- весь пользовательский HTTP/TLS traffic входит в систему только через `Traefik`.

Это закрепляет фактическую production topology без остановки уже работающих сервисов на VPS.

### 2. `docker-compose.server` остаётся runtime для приложения

AeroChat не мигрирует в Kubernetes в этом PR.

`docker-compose.server` продолжает поднимать:

- `web`;
- `aero-gateway`;
- `aero-identity`;
- `aero-chat`;
- `postgres`;
- `redis`;
- `minio`.

`aero-identity`, `aero-chat`, `postgres`, `redis` и `minio` по-прежнему остаются только во внутренней compose-сети.

### 3. Upstream binding меняется с loopback-only на явный node-reachable host IP

Текущая loopback-only модель недостаточна для `Traefik`, запущенного в Kubernetes:

- pod’ы `Traefik` не должны зависеть от `127.0.0.1` хоста;
- `EndpointSlice` не может указывать на loopback address;
- `Traefik` должен ходить в upstream по реальному host IP, доступному из кластера.

Для `server/prod-like` runtime вводится явный non-secret параметр:

- `AERO_SHARED_EDGE_HOST_IP`

Этот адрес:

- принадлежит самому VPS;
- достижим из `Traefik` pod’ов;
- используется compose-публикацией `web` и `aero-gateway`;
- должен совпадать с адресом в Kubernetes `EndpointSlice`.

Публикуются только два high-port upstream’а:

- `${AERO_SHARED_EDGE_HOST_IP}:${AERO_WEB_HOST_PORT}` для `web`;
- `${AERO_SHARED_EDGE_HOST_IP}:${AERO_GATEWAY_HOST_PORT}` для `aero-gateway`.

Оператор обязан не оставлять эти high ports бесконтрольно доступными извне.
Требуемый уровень защиты обеспечивается host firewall / сетевой политикой окружения, а не вторым edge-слоем внутри AeroChat.

### 4. Интеграция с Kubernetes выполняется через `Service` без selector и `EndpointSlice`

Минимальная cluster-side интеграция строится так:

- для `web` создаётся `Service` без selector;
- для `aero-gateway` создаётся `Service` без selector;
- для обоих сервисов создаются ручные `EndpointSlice`, указывающие на `${AERO_SHARED_EDGE_HOST_IP}` и нужные host ports.

Причины:

- стандартный `Ingress` маршрутизирует traffic в Kubernetes `Service`, а не напрямую в произвольный host upstream;
- `Service` без selector и ручной `EndpointSlice` являются минимальной Kubernetes-моделью для внешнего backend без миграции приложения в кластер;
- эта схема не требует отдельного sidecar, tunnel или полной Kubernetes-переупаковки AeroChat.

### 5. Доменная маршрутизация остаётся разделённой на frontend и backend edge-пути

Для домена `aero.keykomi.com` фиксируется следующий routing contract:

- `/` и SPA routes идут в `web`;
- `/api` идёт только в `aero-gateway`;
- `/healthz` идёт в `aero-gateway`;
- `/readyz` идёт в `aero-gateway`.

`aero-gateway` остаётся единственной backend edge-точкой.
`web` остаётся отдельным frontend upstream, как и в предыдущих deploy slices.

Поскольку frontend image продолжает собираться с `VITE_GATEWAY_BASE_URL=/api`, `Traefik` должен срезать префикс `/api`
перед проксированием в `aero-gateway`.
Для этого используется минимальный `Traefik Middleware`, а не новый backend contract.

### 6. TLS и сертификаты принадлежат `cert-manager` + `Traefik`

TLS больше не относится к host runtime AeroChat.

Принята следующая модель:

- `cert-manager` выпускает сертификат в namespace ingress-ресурсов AeroChat;
- секрет TLS используется `Traefik` для домена `aero.keykomi.com`;
- `docker-compose.server` не монтирует сертификаты и не владеет `443`;
- `certbot`, ACME webroot и host-level TLS path не входят в primary operator flow.

Если в кластере уже используется иной `ClusterIssuer`, оператор заменяет его имя в manifest example.

### 7. Operator flow остаётся явным и разделённым

Операторский контракт состоит из двух независимых слоёв:

1. Host runtime
   - поддерживать checkout репозитория;
   - заполнять `.env.server` и `.env.server.secrets`;
   - выбирать `AERO_IMAGE_TAG`;
   - поднимать compose runtime;
   - поддерживать согласованные `AERO_SHARED_EDGE_HOST_IP`, `AERO_WEB_HOST_PORT` и `AERO_GATEWAY_HOST_PORT`.

2. Cluster edge
   - применить Kubernetes resources для `Service`, `EndpointSlice`, `Middleware` и `Ingress`;
   - указать правильный `ClusterIssuer`;
   - убедиться, что `aero.keykomi.com` указывает на существующий cluster edge;
   - проверить выпуск сертификата и готовность ingress path.

Production rollout workflow продолжает обновлять только compose runtime через `AERO_IMAGE_TAG`.
Workflow не управляет `kubectl apply`, `cert-manager` и не меняет cluster ingress resources.

### 8. Scope boundaries

В этот corrective slice не входят:

- полный перенос AeroChat в Kubernetes;
- установка или обновление `Traefik`;
- установка или обновление `cert-manager`;
- host `nginx` automation;
- новый edge stack;
- multi-node / multi-host topology;
- service mesh, tunnels и иная дополнительная infra-сложность.

## Последствия

### Положительные

- Deployment model теперь соответствует реальному production edge целевого VPS.
- `docker-compose.server` сохраняется как app-runtime без полной Kubernetes-миграции.
- `Traefik` и `cert-manager` используются как уже существующий общий edge-слой.
- Gateway-only backend edge contract сохраняется.
- TLS material полностью уходит из compose runtime и не размазывается между host и cluster.

### Отрицательные

- Появляется новый обязательный contract между `.env.server` и Kubernetes `EndpointSlice`.
- Host high ports больше нельзя держать на loopback-only binding.
- Rollout разделяется на compose runtime и cluster edge resources, что требует аккуратной operator discipline.

### Ограничения

- Нельзя считать host `nginx` основным edge для launch-target.
- Нельзя публиковать `aero-identity` и `aero-chat` наружу в обход `Traefik` и `aero-gateway`.
- Нельзя возвращаться к loopback-only binding для `web` и `aero-gateway`, если traffic идёт через `Traefik`.
- Нельзя смешивать этот slice с полной Kubernetes-миграцией приложения.

## Альтернативы

### 1. Продолжать использовать host-level `nginx` как основной edge AeroChat

Не выбрано, потому что это противоречит фактической production topology целевого VPS.

### 2. Полностью перенести AeroChat runtime в Kubernetes

Не выбрано, потому что это слишком большой scope для финального corrective slice перед launch.

### 3. Оставить compose runtime на `127.0.0.1` и искать ad-hoc обход для доступа из `Traefik`

Не выбрано, потому что это создаёт хрупкую и плохо документируемую topology вместо явного node-reachable upstream contract.
