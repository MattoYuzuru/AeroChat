# ADR-085: Repo-managed TURN runtime и public relay IP contract для direct calls

- Статус: Accepted
- Дата: 2026-03-26

## Контекст

После `ADR-074` - `ADR-078` и production rollout foundation в репозитории уже существуют:

- server-backed RTC control plane в `aero-rtc-control`;
- web direct audio-call bootstrap с browser `RTCPeerConnection`;
- server env contract для STUN/TURN urls и time-based TURN credentials;
- single-server `docker-compose.server` runtime за shared `Traefik` edge.

На production VPS проявился реальный corrective bug:

- browser успешно проходит call control-plane и microphone capture;
- direct call зависает на `Соединяем` и затем уходит в `Сбой`;
- отдельный вручную поднятый `coturn` контейнер вне репозитория пытается bind'иться на публичный IP внутри docker bridge;
- relay socket creation падает с `Cannot assign requested address` и `create_relay_ioa_sockets: no available ports`.

Это означает, что текущий contract был неполным:

- репозиторий задавал TURN credentials и ICE urls, но не управлял самим TURN runtime;
- production recovery зависела от вне-репозитарного ad-hoc контейнера;
- для server stack не было явного различия между internal host IP для shared edge и public IP, который должен рекламироваться browser'ам для TURN relay.

Нужно исправить это минимально и воспроизводимо, не расширяя scope до media-plane redesign, нового signaling transport или Kubernetes-миграции RTC.

## Решение

### 1. `docker-compose.server` становится owner'ом TURN runtime

В server/prod-like topology добавляется repo-managed сервис `turn` на базе `coturn`.

Это решение выбрано потому, что:

- TURN для текущего direct-call slice является operationally required частью connectivity path;
- runtime должен быть описан versioned compose-контрактом, а не ad-hoc ручным контейнером на VPS;
- rollback и first-launch flow должны оставаться воспроизводимыми через репозиторий.

### 2. TURN запускается в `host` network mode

Для `turn` фиксируется `network_mode: host`.

Причина:

- coturn должен легально bind'ить relay sockets на адрес, который реально принадлежит VPS;
- docker bridge ломает bind на public relay IP и делает relay port allocation хрупким;
- host-network runtime минимально убирает этот класс ошибок без отдельного NAT helper слоя.

### 3. Вводится явный env contract для public/relay IP

В `server` env-модель добавляются:

- `AERO_RTC_TURN_EXTERNAL_IP`
- `AERO_RTC_TURN_RELAY_IP`
- `AERO_RTC_TURN_LISTEN_PORT`
- `AERO_RTC_TURN_MIN_RELAY_PORT`
- `AERO_RTC_TURN_MAX_RELAY_PORT`

Семантика:

- `AERO_RTC_TURN_EXTERNAL_IP` — browser-visible public IP, который соответствует host из `AERO_RTC_TURN_URLS`;
- `AERO_RTC_TURN_RELAY_IP` — опциональный bind IP для relay sockets;
- `AERO_SHARED_EDGE_HOST_IP` по-прежнему относится только к upstream contract для `web`, `aero-gateway` и `minio` за shared `Traefik`.

Это distinction обязательно, потому что shared edge может использовать внутренний node-reachable IP, а browser media connectivity должна рекламировать внешний публичный relay address.
Если VPS находится за NAT и публичный IP не принадлежит локальному интерфейсу, `turn` runtime обязан использовать mapping
`--external-ip public/private` и bind'ить relay sockets на `AERO_RTC_TURN_RELAY_IP`, а не на сам public address.

### 4. TURN не прячется за `Traefik`

TURN runtime публикуется как прямой host-level UDP/TCP service:

- listening port `3478` по умолчанию;
- relay port range `49160-49200` по умолчанию.

Shared `Traefik` остаётся owner'ом только HTTP/TLS edge для `/`, `/api`, `/api/realtime`, `/healthz`, `/readyz` и media host.
TURN не проксируется через `Traefik` и не становится частью HTTP ingress path.

### 5. Credential owner не меняется

`aero-rtc-control` по-прежнему остаётся owner'ом browser-facing TURN credentials:

- читает `AERO_RTC_TURN_AUTH_SECRET`;
- выдаёт time-based username/credential через `GetIceServers`;
- web по-прежнему не требует rebuild для изменения TURN/STUN policy.

Новый `turn` runtime использует тот же shared secret, но не меняет control-plane ownership.

## Последствия

### Положительные

- Production direct-call connectivity получает repo-managed и воспроизводимый TURN runtime.
- Устраняется конкретный bind failure class, когда coturn живёт в docker bridge и рекламирует недоступный relay IP.
- Server env contract становится честным: internal shared-edge IP и public TURN IP больше не смешиваются.
- Operator может проверять и rollout'ить TURN вместе с versioned compose topology.

### Отрицательные

- В deployment model появляется ещё один обязательный runtime-компонент для production-grade direct calls.
- Оператор должен открыть и контролировать прямые TURN ports и relay range на host/firewall уровне.
- TURN по-прежнему остаётся отдельным non-HTTP service и требует отдельной live-проверки, помимо обычных `/healthz` и `/readyz`.

## Что сознательно не делается

- новый signaling transport;
- media-plane backend внутри AeroChat;
- TURN через Kubernetes ingress;
- TLS/DTLS TURN bootstrap;
- auto-discovery public IP внутри compose без явного operator contract;
- full call observability platform.

## Альтернативы

### 1. Оставить TURN как ручной вне-репозитарный контейнер

Не выбрано, потому что это уже привело к production drift и невоспроизводимому broken runtime.

### 2. Попробовать исправить coturn внутри docker bridge без host-network

Не выбрано, потому что для текущего single-server VPS это сохраняет хрупкую связку между container networking, public relay IP и relay port allocation.

### 3. Убрать TURN и полагаться только на STUN

Не выбрано, потому что это возвращает direct calls в состояние network-luck bootstrap и не исправляет observed production failure.
