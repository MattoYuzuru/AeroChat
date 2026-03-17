# ADR-024: Shared-host nginx edge deployment для single-server self-host

- Статус: Accepted
- Дата: 2026-04-02

## Контекст

После подготовки production rollout и первого внешнего запуска выяснилось реальное ограничение целевого VPS:

- на хосте уже есть постоянный `nginx`, который обслуживает другой проект;
- `80/tcp` и `443/tcp` уже заняты host-level edge;
- текущая server/prod-like модель с отдельным контейнером `nginx`, владеющим публичными `80/443`, больше не подходит;
- при этом нельзя останавливать существующий host `nginx` как основной операторский сценарий;
- topology проекта и роль `aero-gateway` как единственной backend edge-точки менять нельзя.

Нужно исправить deployment-модель минимальным изолированным slice:

- сохранить single-server self-host подход;
- сохранить `aero-gateway` единственной backend edge-точкой за reverse proxy;
- не публиковать наружу `aero-identity` и `aero-chat`;
- не превращать изменение в redesign runtime topology, CI/CD или edge stack.

## Решение

### 1. Host-level nginx становится единственным публичным edge

Для shared-host VPS фиксируется следующая модель:

- публичные `80/tcp` и `443/tcp` принадлежат только host-level `nginx`;
- `docker-compose.server` больше не поднимает отдельный `nginx` контейнер;
- AeroChat runtime живёт behind existing host `nginx`, а не рядом с ним на тех же портах.

Это решение не меняет базовую single-server topology и не вводит второй внешний edge.

### 2. Server compose публикует только loopback high ports

Для `server/prod-like` runtime compose публикует наружу только два loopback upstream endpoint:

- `web` на `127.0.0.1:<AERO_WEB_HOST_PORT>`;
- `aero-gateway` на `127.0.0.1:<AERO_GATEWAY_HOST_PORT>`.

Следствия:

- `aero-identity`, `aero-chat`, `postgres`, `redis` и `minio` остаются только во внутренней compose-сети;
- внешний доступ к приложению идёт только через host `nginx`;
- доступ к loopback upstream ports возможен только с самого VPS.

### 3. Host nginx routing contract

Host-level `nginx` должен проксировать:

- `/` и SPA routes в `web`;
- `/api/` только в `aero-gateway`;
- `/readyz` только в `aero-gateway`;
- `/healthz` может отвечать сам host `nginx`.

Таким образом `aero-gateway` остаётся единственной backend edge-точкой за `nginx`, а web shell остаётся отдельным
frontend upstream без прямой публикации backend-доменов.

### 4. TLS и certificate issuance

Основной documented path для сертификатов переводится на existing host `nginx` model:

- ACME challenge обслуживается host-level `nginx`;
- primary operator flow использует `certbot certonly --webroot`;
- `certbot --standalone` больше не считается основным документированным сценарием;
- сертификаты и приватный ключ остаются host-level файлами вне compose runtime.

Репозиторий хранит:

- пример HTTP bootstrap server block для первой выдачи сертификата;
- пример итогового HTTPS server block для домена;
- runbook с последовательностью: bootstrap HTTP config → webroot issuance → switch на full TLS config.

### 5. Production rollout contract

Production deploy workflow не управляет host `nginx` и не выпускает сертификаты.

Workflow продолжает:

- менять только `AERO_IMAGE_TAG` в `.env.server`;
- выполнять `docker compose ... config`, `pull`, `up -d` и `ps`;
- проверять `/healthz` и `/readyz` через уже настроенный host edge.

Host `nginx` server block, сертификаты и reload host `nginx` остаются отдельной обязанностью оператора при bootstrap и
при редких изменениях edge-конфига.

## Последствия

### Положительные

- Shared-host VPS становится совместимым с AeroChat без topology redesign.
- Existing host `nginx` можно использовать как единый публичный edge для нескольких проектов.
- Compose runtime перестаёт конфликтовать за `80/443`.
- Gateway-only backend edge contract сохраняется.
- Сертификаты выпускаются без остановки host `nginx` и без второго ACME path.

### Отрицательные

- Появляется дополнительная host-level операционная зависимость: корректный `nginx` server block должен существовать
  вне compose.
- Изменение loopback ports или домена требует синхронно обновлять `.env.server` и host `nginx` config.
- Production workflow по-прежнему не автоматизирует host `nginx` reload и certificate renewal.

### Ограничения

- Нельзя возвращаться к отдельному публичному `nginx` контейнеру на shared-host VPS без нового решения.
- Нельзя публиковать `aero-gateway`, `aero-identity` или `aero-chat` на внешних интерфейсах в обход host `nginx`.
- Нельзя считать `certbot --standalone` основным operator path для этого deployment-моделя.
- Нельзя смешивать этот slice с новым edge stack, multi-host deployment и topology redesign.

## Альтернативы

### 1. Оставить отдельный AeroChat `nginx` контейнер на `80/443`

Не выбрано, потому что это конфликтует с уже работающим host-level `nginx` и делает deployment на shared-host VPS
непригодным.

### 2. Публиковать наружу только `aero-gateway`, а web раздавать host `nginx` из файловой системы

Не выбрано, потому что это меняет runtime contract, усложняет release consumption и не нужно для текущего исправления.

### 3. Использовать `certbot --standalone` с временной остановкой host `nginx`

Не выбрано, потому что это ломает основной shared-host сценарий и противоречит требованию не останавливать существующий
host edge как primary path.
