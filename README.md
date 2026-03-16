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
- Nginx
- Docker / Docker Compose

### Frontend

- React
- TypeScript
- Vite
- CSS Modules
- PostCSS
- PWA

### Infrastructure / DX

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
  - TLS-сертификаты и приватный ключ существуют только на VPS в отдельной директории и не коммитятся;
  - `infra/compose/docker-compose.server.yml` даёт production-oriented single-server topology на предсобранных образах;
  - ручной bootstrap описан в `docs/deploy/single-server-bootstrap.md`.

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

4. Открой приложение через `http://127.0.0.1:${NGINX_PORT}` из `.env`.

5. Если нужен source-mode запуск вне compose, используй:

- `services/*/.env.example` для backend-сервисов;
- `apps/web/.env.example` для web-клиента.

### Single-server foundation

Для server/prod-like bootstrap на одном VPS:

```bash
cp .env.server.example .env.server
cp .env.server.secrets.example .env.server.secrets
# Подготовь на VPS каталог с `fullchain.pem` и `privkey.pem` для домена из `.env.server`.
docker compose --env-file .env.server --env-file .env.server.secrets -f infra/compose/docker-compose.server.yml config
docker compose --env-file .env.server --env-file .env.server.secrets -f infra/compose/docker-compose.server.yml pull
docker compose --env-file .env.server --env-file .env.server.secrets -f infra/compose/docker-compose.server.yml up -d
```

Server runtime использует один внешний `nginx` на `80/443`, делает канонический redirect на HTTPS и держит `aero-gateway`
единственной backend edge-точкой за reverse proxy.

Подробности, TLS/domain contract и ограничения этапа описаны в `docs/deploy/single-server-bootstrap.md`.

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

- [ ] Регистрация и вход
- [ ] Immutable login / mutable nickname
- [ ] Device sessions
- [ ] Privacy flags
- [ ] Block list
- [ ] Key backup status

### Chat

- [ ] Друзья по логину
- [ ] Личные чаты
- [ ] Группы и роли
- [ ] Markdown messages
- [ ] Pins
- [ ] Draft recovery
- [ ] Tombstone deletion model

## Media

- [ ] Voice messages
- [ ] Video messages
- [ ] Attachments
- [ ] Encrypted relay
- [ ] Preview для изображений / аудио / видео

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
