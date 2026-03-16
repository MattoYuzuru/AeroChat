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