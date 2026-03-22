# Roadmap AeroChat

## Статус проекта

Проект находится на стадии формирования фундамента.

Главная задача ближайшего этапа:
зафиксировать архитектуру, разложить монорепозиторий, настроить tooling и сделать безопасную основу для дальнейшей
разработки.

Последний завершённый platform slice:

- [x] web encrypted direct-message v2 local projection foundation

---

## Этап 0. Foundation

Цель:
создать воспроизводимый инженерный фундамент проекта.

Задачи:

- [ ] README
- [ ] AGENTS
- [ ] ADR
- [ ] Monorepo structure
- [ ] Go modules / go.work
- [ ] Proto foundation
- [ ] ConnectRPC setup
- [ ] sqlc config
- [ ] golangci-lint config
- [ ] Taskfile
- [ ] Frontend shell scaffold
- [ ] Dev Docker Compose
- [x] Single-server deploy foundation
- [x] Image delivery и release bootstrap
- [x] Server secret model и operator update flow
- [x] Single-server TLS / domain / edge bootstrap
- [x] Production rollout automation и first external launch foundation
- [ ] GitHub Actions CI

---

## Этап 1. Identity foundation

Цель:
сформировать безопасную и расширяемую базу аккаунтов и устройств.

Задачи:

- [ ] User model
- [ ] Immutable login
- [ ] Mutable nickname
- [ ] Password auth foundation
- [ ] Sessions
- [x] Devices & sessions UI/data model
- [x] Privacy flags
- [x] Crypto device registry foundation
- [x] Public crypto bundles and prekey inventory foundation
- [x] Linked-device control-plane foundation
- [x] Web secure key storage and crypto worker foundation
- [x] Proof-bound linked-device approval hardening
- [x] Proof-bound crypto bundle update and rotation hardening
- [ ] Block list
- [ ] Key backup status

---

## Этап 2. Social graph

Цель:
добавить базовые связи между пользователями.

Задачи:

- [ ] Friend requests
- [ ] Add by login
- [ ] No public user directory
- [ ] Block interactions policy
- [ ] Search by exact login rules
- [x] Web people bootstrap через `aero-gateway`
- [x] People realtime bootstrap через `aero-gateway`

---

## Этап 3. 1:1 chat

Цель:
добавить личные чаты и базовые сообщения.

Задачи:

- [x] Chat creation
- [x] Message model
- [x] Encrypted direct-message v2 intake and opaque storage foundation
- [x] Device-aware gateway transport for encrypted direct-message v2
- [x] Web encrypted direct-message v2 local projection foundation
- [x] Safe markdown subset
- [x] Read receipts
- [x] Unread conversation state
- [x] Typing foundation
- [x] Presence foundation
- [x] Privacy toggles через web settings и `aero-gateway`
- [x] Tombstone deletion
- [x] Message edit foundation
- [x] Replies и quoted messages foundation
- [x] Message search foundation через `aero-gateway`
- [ ] Draft recovery
- [x] Pin / unpin
- [x] Web direct chat bootstrap через `aero-gateway`
- [x] Gateway realtime transport foundation
- [x] Direct chat realtime bootstrap через `aero-gateway`
- [x] Direct chat typing/presence realtime fan-out через `aero-gateway`

---

## Этап 4. Groups

Цель:
добавить группы и роли.

Задачи:

- [x] Group creation
- [x] Group roles
- [x] Invite links
- [x] Admin/member/reader
- [x] Canonical primary group thread
- [x] Group text messaging bootstrap
- [x] Web group chat bootstrap через `aero-gateway`
- [x] Promote/demote
- [x] Group permissions
- [x] Membership remove / leave / ownership transfer bootstrap
- [x] Group realtime bootstrap через `aero-gateway`
- [x] Group typing bootstrap через `aero-gateway` и `apps/web`
- [x] Group unread conversation state foundation
- [x] Message edit foundation
- [x] Replies и quoted messages foundation
- [x] Message search foundation через `aero-gateway`
- [x] Group moderation foundation и admin policy expansion
- [x] Max groups per user rules

---

## Этап 5. Media foundation

Цель:
добавить вложения и временный encrypted relay.

Задачи:

- [x] Attachment metadata model
- [x] Upload intent / presigned upload foundation
- [x] Media edge / upload runtime bootstrap
- [x] Web attachment composer bootstrap через `aero-gateway`
- [x] Attachment-only messages для direct chats и groups
- [x] Web media message rendering polish для direct chats и groups
- [x] Attachment lifecycle hardening
- [x] Quotas
- [x] Attachment retention and delete semantics
- [x] Voice notes
- [x] Video notes
- [x] Image/audio/video preview
- [ ] Encrypted relay
- [x] TTL cleanup
- [ ] Local media drafts

---

## Этап 6. RTC foundation

Цель:
добавить звонки.

Задачи:

- [ ] Signaling model
- [ ] 1:1 calls
- [ ] Group call control
- [ ] One-active-call-per-user policy
- [ ] Device controls
- [ ] Quality presets
- [ ] Future screen-share hooks

---

## Этап 7. Platform polish

Цель:
сделать продукт удобным и пригодным к повседневному использованию.

Задачи:

- [x] Web direct chat polish foundation в `apps/web`
- [x] Web message search bootstrap через `aero-gateway`
- [ ] Push notifications
- [ ] PWA
- [ ] Desktop shell polish
- [ ] Mobile shell polish
- [ ] Explorer
- [x] Settings and privacy bootstrap через `aero-gateway`
- [ ] Trash model

---

## Этап 8. Advanced media & productivity

Цель:
подготовить пространство для дальнейших расширений.

Задачи:

- [ ] Call recordings
- [ ] Transcript pipeline hooks
- [ ] Screen sharing
- [ ] Shared board hooks
- [ ] Export tools
- [ ] Media lifecycle improvements
