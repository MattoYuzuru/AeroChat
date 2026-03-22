<a id="readme-top"></a>

<div align="center">
  <h1>AeroChat</h1>
  <p>
    Самостоятельно разворачиваемый приватный чат с веб-клиентом, PWA, E2EE-архитектурой, группами и звонками.
  </p>
  <p>
    Эстетика Frutiger Aero / Windows Aero / old desktop shell.  
    Go-first backend. Monorepo. Self-hosted.
  </p>
</div>

---

## О проекте

**AeroChat** — это self-hosted чат-приложение с акцентом на:

- **безопасность**: сервер не должен иметь доступа к открытому содержимому сообщений;
- **скорость**: стабильная работа даже на старых мобильных устройствах;
- **удобство**: быстрый вход, живой real-time UX, desktop-like интерфейс на ПК и удобный fullscreen UX на телефонах;
- **воспроизводимость**: проект должен быть легко разворачиваемым на одном сервере.

Проект строится как **монорепозиторий** с Go-бэкендом и современным веб-фронтендом.

### Ключевые принципы

- Сервер хранит только то, что необходимо для работы системы.
- Контент сообщений проектируется с расчётом на **end-to-end encryption**.
- Медиа-контент может храниться **временно** и **только в зашифрованном виде**.
- Архитектурные решения фиксируются через ADR.
- Кодовая база должна быть понятной как человеку, так и LLM-агентам.

### Функциональная цель проекта

AeroChat должен поддерживать:

- личные чаты;
- группы и роли;
- друзей по неизменяемому логину;
- markdown в сообщениях;
- голосовые сообщения;
- видеосообщения;
- вложения;
- звонки 1:1 и групповые звонки;
- уведомления;
- desktop shell на ПК;
- PWA на мобильных устройствах.

### Текущий alpha snapshot

На текущем этапе web-клиент уже поддерживает:

- личные чаты и группы через `aero-gateway`;
- bootstrap поиска сообщений через отдельную защищённую страницу `/app/search`:
  - поиск по всем direct chats или по одному direct chat;
  - поиск по всем группам или по одной группе;
  - компактные jump-oriented результаты с переходом в нужный direct chat или group;
  - временную подсветку target message, если он уже попал в текущую загруженную историю;
- bounded realtime для chat/group foundation;
- backend-first foundation для encrypted direct-message v2:
  - explicit opaque intake RPC в `aero-chat` и thin proxy через `aero-gateway`;
  - parallel storage path для logical encrypted envelopes и per-device deliveries;
  - explicit device-aware realtime binding по active local `crypto_device_id` в `aero-gateway`;
  - отдельный realtime family для device-scoped opaque encrypted envelope delivery без plaintext snapshot payload;
  - raw list/get fetch path, worker-side decrypt foundation и bounded local web projection для текущего direct chat;
  - первый web outbound bootstrap send path для text-only encrypted DM v2:
    - target roster собирается по active crypto devices собеседника и всех active devices отправителя, включая originating sender device;
    - per-device opaque envelopes собираются внутри crypto worker/runtime boundary;
    - originating sender device теперь получает server-backed self-delivery через тот же opaque storage/realtime path, а bounded local optimistic projection остаётся только временным reconciliation layer без plaintext fallback;
  - encrypted media relay v1 для direct encrypted lane:
    - presigned direct-to-object-storage flow сохраняется, но encrypted media upload/download идёт только как ciphertext blob;
    - relay metadata отделена от encrypted attachment descriptor;
    - browser шифрует файл до upload, descriptor уходит внутри encrypted DM v2 payload, а ciphertext blob расшифровывается локально после download;
    - текущий direct encrypted lane умеет bounded text + encrypted attachment и attachment-only send/use path;
    - storage/lifecycle/quota/retention foundation остаётся общей и future-ready для group E2EE;
  - первый backend-first MLS-compatible foundation для encrypted groups:
    - отдельный encrypted group control-plane lane в `aero-chat` c явным `mls_group_id` и `roster_version`;
    - materialized readable roster по active trusted crypto devices current group members, включая `reader` и write-restricted участников;
    - отдельный opaque storage path для group-scoped encrypted envelopes и explicit per-device deliveries без reuse `group_messages`;
    - device-aware fetch/bootstrap surface и отдельный realtime family `encrypted_group_message_v1.delivery` без plaintext-style `group.message.updated` snapshots;
    - coexistence остаётся bounded и честной:
      - legacy plaintext group history не переписывается и не re-encrypt'ится;
      - encrypted lane forward-only и не dual-write'ит те же сообщения в plaintext path;
    - текущий slice не объявляет full MLS implementation, encrypted group decrypt/render UX, media send UX, reply/edit/search/unread parity или backup/recovery.
  - encrypted DM v2 пока показывается отдельно от legacy plaintext history;
  - без claims о full encrypted DM parity, encrypted search, MLS/group encrypted messaging или backup/recovery.
- explicit group moderation/admin policy foundation:
  - явная policy matrix для `owner` / `admin` / `member` / `reader`;
  - durable write restriction для участников группы без потери membership;
  - realtime convergence composer/typing state после restrict/unrestrict;
- message edit foundation для direct chats и groups с explicit edited marker;
- reply и compact quoted preview для direct chats и groups;
- первый attachment upload flow в direct chats и groups:
  - file picker;
  - presigned upload;
  - send text + attachment;
  - send attachment-only message;
  - polished file rendering для всех attachment kinds;
  - lazy inline preview для image/audio/video attachments;
  - bounded web voice-notes recording через существующий attachment upload/send flow;
  - безопасное explicit open/download через presigned access.
- attachment lifecycle hardening:
  - real expiration для stale upload sessions;
  - bounded cleanup path для orphaned unattached attachments;
  - conservative object deletion только по backend state и explicit message linkage.
- media quota foundation:
  - deterministic per-user byte quota на `CreateAttachmentUploadIntent`;
  - quota usage считается только по backend-owned attachment state;
  - `expired` и `deleted` lifecycle states больше не удерживают active quota budget.
- attachment retention/delete semantics foundation:
  - direct message tombstone переводит linked attachment из `attached` в `detached`;
  - `detached` больше не удерживает active quota budget;
  - object cleanup для `detached` остаётся staged и выполняется отдельно после retention grace period.
- encrypted media relay v1:
  - `attachment` теперь может явно работать как relay entity с `legacy_plaintext` или `encrypted_blob_v1` schema;
  - для encrypted relay quota и cleanup считают ciphertext-visible bytes;
  - user-facing filename/MIME/decrypt metadata для encrypted media больше не считаются server-visible source of truth.
- max groups per user rules foundation:
  - configurable per-user limit по active group memberships;
  - limit применяется на `CreateGroup` и `JoinGroupByInviteLink`;
  - `leave` и `remove` естественно освобождают capacity, потому что учитываются только текущие membership.
- bounded web video-notes recording через существующий attachment upload/send flow.

<p align="right">(<a href="#readme-top">наверх</a>)</p>

---

## Почему этот проект

AeroChat создаётся как проект с сильным фундаментом:

- современный стек;
- чистая архитектура;
- воспроизводимый self-host;
- строгие правила разработки;
- постепенный итерационный roadmap;
- публичный монорепозиторий;
- ориентация на качество, тестируемость и долгую поддержку.

<p align="right">(<a href="#readme-top">наверх</a>)</p>

---

## Стек

### Backend

- Go
- ConnectRPC
- Protocol Buffers
- PostgreSQL
- Redis
- MinIO
- Nginx (local/dev edge)
- Docker / Docker Compose

### Frontend

- React
- TypeScript
- Vite
- CSS Modules
- PostCSS
- PWA

### Infrastructure / DX

- k3s
- Traefik
- cert-manager
- GitHub Actions
- GHCR
- golangci-lint
- sqlc
- buf
- Taskfile

<p align="right">(<a href="#readme-top">наверх</a>)</p>

---

## Архитектурные ориентиры

На текущем этапе проект ориентируется на следующие решения:

- **monorepo**;
- **Go-first backend**;
- разделение на bounded contexts;
- proto-first контракты;
- PWA-first web client;
- future-ready E2EE;
- future-ready RTC signaling и SFU media plane;
- self-host сценарий для одного сервера;
- строгая документация архитектурных решений.

Подробности находятся в каталоге `docs/adr`.

<p align="right">(<a href="#readme-top">наверх</a>)</p>

---

## Структура репозитория

```text
/apps
  /web

/services
  /aero-gateway
  /aero-identity
  /aero-chat
  /aero-rtc-control
  /aero-jobs

/libs
  /go
    /auth
    /crypto
    /observability
    /events
    /testkit

/proto
  /aerochat
    /common
    /identity
    /chat
    /rtc

/docs
  /adr

/infra
  /compose
  /k8s
  /nginx
  /scripts

/.github
  /workflows
```

<p align="right">(<a href="#readme-top">наверх</a>)</p>

## Getting Started

### Требования

Перед началом убедись, что у тебя установлены:

* Git
* Go
* Node.js
* pnpm
* Docker
* Docker Compose

### Локальный запуск

В репозитории теперь есть два явных режима:

- `local/dev`:
  - root `.env.example` управляет локальным compose-стеком;
  - `infra/compose/docker-compose.yml` поднимает локальный full-stack smoke runtime;
  - `services/*/.env.example` и `apps/web/.env.example` остаются source-mode примерами для запуска сервисов вне compose.

- `server/prod-like`:
  - `.env.server.example` содержит только versioned non-secret runtime config;
  - `.env.server.secrets.example` описывает обязательные server-only secret keys без реальных значений;
  - публичный edge принадлежит существующему `k3s + Traefik`;
  - TLS выпускается и обновляется через существующий `cert-manager`;
  - `infra/compose/docker-compose.server.yml` даёт production-oriented single-server topology на предсобранных образах;
  - `infra/k8s/shared-edge/aero.keykomi.com.example.yaml` показывает минимальные cluster-side ресурсы для маршрутизации в compose runtime;
  - подготовка сервера описана в `docs/deploy/single-server-bootstrap.md`;
  - production rollout и first external launch описаны в `docs/deploy/production-rollout.md`.

1. Клонируй репозиторий:

```
git clone https://github.com/MattoYuzuru/AeroChat.git
cd AeroChat
```

2. Скопируй пример переменных окружения:

```
cp .env.example .env
```

3. Подними локальный stack:

```
docker compose -f infra/compose/docker-compose.yml up --build -d
```

При первом запуске `aero-identity` и `aero-chat` автоматически применяют свою PostgreSQL-схему.
Штатный `local/dev` flow не требует отдельного ручного `psql`.

Media/file foundation использует тот же локальный `minio`, но для `aero-chat` теперь настраиваются два разных адреса:

- внутренний endpoint для service-to-storage доступа;
- browser-visible endpoint для presigned upload URL.

Для admission control upload intent у `aero-chat` также есть отдельный operator-facing лимит:

- `AERO_MEDIA_USER_QUOTA_BYTES` задаёт общий per-user media budget в байтах;
- quota проверяется на `CreateAttachmentUploadIntent`;
- usage считается по attachment metadata в состояниях `pending`, `uploaded`, `attached` и `failed`;
- `detached`, `expired` и `deleted` больше не считаются частью активного quota budget;
- `AERO_MEDIA_DETACHED_ATTACHMENT_RETENTION` задаёт grace period перед cleanup для attachment, оставшихся только у tombstoned direct messages.

Для групп у `aero-chat` есть отдельный operator-facing лимит:

- `AERO_MAX_ACTIVE_GROUP_MEMBERSHIPS_PER_USER` задаёт максимум активных group membership на пользователя;
- лимит проверяется на `CreateGroup` и `JoinGroupByInviteLink`;
- source of truth остаётся в `group_memberships`, без отдельного counter/caching слоя;
- удалённые и вышедшие membership не удерживают лимит, потому что больше не существуют в активной SQL-модели.

В `local/dev` шаблоне это уже сведено к `minio:9000` и `MEDIA_S3_PUBLIC_ENDPOINT`.
Для browser upload compose runtime автоматически bootstrap'ит bucket privacy через `mc`,
а `minio` применяет allowed origins из `MEDIA_S3_CORS_ALLOWED_ORIGINS`.

4. Открой приложение через `http://127.0.0.1:${NGINX_PORT}` из `.env`.

5. Если нужен source-mode запуск вне compose, используй:

- `services/*/.env.example` для backend-сервисов;
- `apps/web/.env.example` для web-клиента.

### Single-server foundation

Для server/prod-like bootstrap на одном VPS:

```bash
cp .env.server.example .env.server
cp .env.server.secrets.example .env.server.secrets
docker compose --env-file .env.server --env-file .env.server.secrets -f infra/compose/docker-compose.server.yml config
docker compose --env-file .env.server --env-file .env.server.secrets -f infra/compose/docker-compose.server.yml pull
docker compose --env-file .env.server --env-file .env.server.secrets -f infra/compose/docker-compose.server.yml up -d
```

При первом старте на пустой PostgreSQL БД `aero-identity` и `aero-chat` автоматически bootstrap'ят схему до выхода в
`ready`.
Нормальный server bootstrap не требует ручного выполнения SQL через `psql`.

Server runtime больше не поднимает отдельный `nginx` контейнер для production VPS.
Public edge для target VPS принадлежит shared `Traefik` в `k3s`.
Compose runtime публикует три host upstream'а на `${AERO_SHARED_EDGE_HOST_IP}`:

- `/` → `web` на `${AERO_SHARED_EDGE_HOST_IP}:${AERO_WEB_HOST_PORT}`;
- `/api`, `/api/realtime`, `/healthz`, `/readyz` → `aero-gateway` на `${AERO_SHARED_EDGE_HOST_IP}:${AERO_GATEWAY_HOST_PORT}`.
- `https://${AERO_MEDIA_EDGE_DOMAIN}` → `minio` на `${AERO_SHARED_EDGE_HOST_IP}:${AERO_MEDIA_HOST_PORT}`.

`Traefik` получает доступ к ним через Kubernetes `Service` без selector и `EndpointSlice`,
а TLS выпускается через existing `cert-manager`.
Для `/api` и `/api/realtime` используется тот же gateway base contract:
ingress-side strip-prefix остаётся у `/api`, а realtime endpoint публикуется как `/api/realtime`,
чтобы web bundle продолжал работать с `VITE_GATEWAY_BASE_URL=/api` без второго публичного backend URL.

Для media/file foundation server runtime также требует:

- отдельный browser-visible media host в `AERO_MEDIA_EDGE_DOMAIN`;
- browser-visible S3 endpoint в `MEDIA_S3_PUBLIC_ENDPOINT`;
- отдельный host upstream `AERO_MEDIA_HOST_PORT`;
- явный MinIO CORS contract в `MEDIA_S3_CORS_ALLOWED_ORIGINS`.

Presigned upload URL не может безопасно указывать на внутренний compose-host `minio:9000`,
поэтому production-credible contract фиксируется как отдельный media origin.
Для текущей shared `Traefik` + Cloudflare topology этот host должен быть sibling-host внутри той же DNS-зоны:
например `aero.keykomi.com` для приложения и `media.keykomi.com` для object storage edge, а не
`media.aero.keykomi.com`.

Подробности, TLS/domain contract и ограничения этапа описаны в `docs/deploy/single-server-bootstrap.md`.
Коррекция hostname-модели описана в `docs/adr/037-media-edge-hostname-normalization.md`.
Для финального live rollout используется manual workflow `Deploy Production` c GitHub Environment `production`.
Полный production runbook описан в `docs/deploy/production-rollout.md`.
Database bootstrap policy описана в `docs/adr/028-first-launch-database-schema-bootstrap.md`.

### Image release model

Для текущего externally usable stack публикуются отдельные GHCR-образы:

- `ghcr.io/<owner>/aerochat-web`
- `ghcr.io/<owner>/aerochat-aero-gateway`
- `ghcr.io/<owner>/aerochat-aero-identity`
- `ghcr.io/<owner>/aerochat-aero-chat`

Теги выбираются так:

- `edge` — moving tag для default branch;
- `vX.Y.Z`, `vX.Y`, `vX` — release tags для git tags вида `vX.Y.Z`;
- `sha-<commit>` — точная привязка к конкретной сборке.

Для server compose оператор обычно меняет только `AERO_IMAGE_TAG` в `.env.server`,
а секретные значения хранит только в `.env.server.secrets`.
Production rollout и rollback выполняются повторным запуском workflow `Deploy Production` с выбранным tag.
`latest` намеренно не используется.
На текущем этапе опубликованные application images собираются только для `linux/amd64`.

> На раннем этапе точные команды могут меняться. Актуальный набор команд должен поддерживаться через Taskfile.yml.

### Первый приоритет репозитория

До реализации продуктовых фич проект должен:

* воспроизводимо собираться;
* запускаться локально;
* проходить CI;
* иметь чистую архитектурную структуру;
* быть безопасным для дальнейшей итерационной разработки.

<p align="right">(<a href="#readme-top">наверх</a>)</p>

## Roadmap

### Foundation

- [ ] Bootstrap monorepo
- [ ] Документация архитектуры
- [ ] Proto/tooling foundation
- [ ] Базовый frontend shell
- [ ] Dev infrastructure
- [ ] CI

### Identity

- [x] Регистрация и вход
- [x] Immutable login / mutable nickname
- [x] Device sessions
- [x] Privacy flags
- [x] Block list
- [ ] Key backup status

### Chat

- [x] Друзья по логину
- [x] Личные чаты
- [x] Группы и роли
- [x] Markdown messages
- [x] Pins
- [ ] Draft recovery
- [x] Tombstone deletion model

## Media

- [ ] Voice messages
- [ ] Video messages
- [ ] Attachments
- [ ] Encrypted relay
- [x] Inline preview для изображений
- [ ] Preview для аудио / видео

### RTC

- [ ] Signaling
- [ ] 1:1 calls
- [ ] Group calls
- [ ] Screen sharing foundation
- [ ] Recording metadata

### Platform

- [ ] Push notifications
- [ ] PWA
- [ ] Desktop shell UX
- [ ] Mobile fullscreen UX
- [ ] Self-host install flow

<p align="right">(<a href="#readme-top">наверх</a>)</p>

## Руководство по разработке

В проекте используется строгий инженерный процесс:

* архитектурные решения фиксируются в ADR;
* изменения вносятся через отдельные ветки;
* коммиты оформляются осмысленно и единообразно;
* обязательны тесты на изменяемый код;
* изменения не должны ломать сборку, CI и локальный запуск;
* документация обновляется вместе с кодом.

Подробные правила находятся в `AGENTS.md`.

<p align="right">(<a href="#readme-top">наверх</a>)</p>

## Contributing

На текущем этапе основной способ работы — через контролируемые feature-ветки и small PR.

Общий процесс:

1. Создать ветку от `main`
2. Реализовать одно изолированное изменение
3. Добавить или обновить тесты
4. Обновить документацию
5. Убедиться, что CI проходит
6. Открыть PR

Принцип проекта:

**один PR = одна завершённая инженерная задача**

<p align="right">(<a href="#readme-top">наверх</a>)</p>

## Лицензия

Лицензия будет определена отдельно.

<p align="right">(<a href="#readme-top">наверх</a>)</p>

## Контакты

Автор проекта: **MattoYuzuru**

Репозиторий проекта: [AeroChat](https://github.com/MattoYuzuru/AeroChat)

<p align="right">(<a href="#readme-top">наверх</a>)</p>

## Источники вдохновения

* Эстетика Frutiger Aero / Windows Aero

* Desktop-like интерфейсы старых ОС

* Local-first и privacy-first подходы

* Современные self-hosted communication systems

* Best README Template как структурный референс для оформления README

<p align="right">(<a href="#readme-top">наверх</a>)</p>
