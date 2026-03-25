# Roadmap AeroChat

## Статус проекта

Проект уже вышел за пределы чистой foundation phase.

Сейчас в репозитории есть рабочий базовый продуктовый slice:
identity, social graph, legacy direct/group chats, media relay, realtime, bounded encrypted lanes,
desktop shell, mobile launcher adaptation и частичный RTC web slice.

Главная задача ближайших этапов:
доводить encrypted coexistence, убирать plaintext из product-critical paths, завершать platform polish
и не делать ложных claims о завершённости PWA, calls или full E2EE parity.

Последний завершённый platform slice:

- [x] Контекстное меню фона рабочего стола с bounded-действиями создания папки и открытия Explorer
- [x] Финальный desktop usability pass для shell: восстановленный hit-testing desktop entrypoints, viewport-safe Start и bounded resize окон

---

## Этап 0. Foundation

Цель:
создать воспроизводимый инженерный фундамент проекта.

Задачи:

- [x] README
- [x] AGENTS
- [x] ADR
- [x] Monorepo structure
- [x] Go modules / go.work
- [x] Proto foundation
- [x] ConnectRPC setup
- [x] sqlc config
- [x] golangci-lint config
- [x] Taskfile
- [x] Frontend shell scaffold
- [x] Dev Docker Compose
- [x] Single-server deploy foundation
- [x] Image delivery и release bootstrap
- [x] Server secret model и operator update flow
- [x] Single-server TLS / domain / edge bootstrap
- [x] Production rollout automation и first external launch foundation
- [x] GitHub Actions CI

---

## Этап 1. Identity foundation

Цель:
сформировать безопасную и расширяемую базу аккаунтов и устройств.

Задачи:

- [x] User model
- [x] Immutable login
- [x] Mutable nickname
- [x] Password auth foundation
- [x] Sessions
- [x] Devices & sessions UI/data model
- [x] Privacy flags
- [x] Crypto device registry foundation
- [x] Public crypto bundles and prekey inventory foundation
- [x] Linked-device control-plane foundation
- [x] Web secure key storage and crypto worker foundation
- [x] Proof-bound linked-device approval hardening
- [x] Proof-bound crypto bundle update and rotation hardening
- [x] Block list
- [ ] Key backup status

---

## Этап 2. Social graph

Цель:
добавить базовые связи между пользователями.

Задачи:

- [x] Friend requests
- [x] Add by login
- [x] No public user directory
- [x] Block interactions policy
- [x] Search by exact login rules
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
- [x] Web encrypted direct-message v2 outbound bootstrap send foundation
- [x] Encrypted direct-message v2 sender self-delivery and convergence hardening
- [x] Encrypted direct-message v2 reply/edit/tombstone/pin recovery foundation
- [x] Encrypted direct-message v2 unread/read recovery foundation
- [x] Encrypted search recovery foundation
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

Примечание:
encrypted direct-message v2 уже существует как отдельная bounded lane, но не заменяет legacy plaintext
history и не даёт full parity с server-side search/preview. Encrypted search остаётся локальным и
session-scoped. Legacy direct reply preview уже деградирован до honest metadata-only/deleted/unavailable
state без server-side plaintext body preview, а server-side search по содержимому legacy direct history
теперь честно de-scoped вместо зависимости от plaintext body/search_vector.

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
- [x] MLS control-plane and opaque encrypted group envelope foundation
- [x] Web encrypted group runtime и local projection bootstrap
- [x] Web encrypted group outbound text bootstrap
- [x] Encrypted group reply/edit/tombstone/pin recovery foundation
- [x] Encrypted group unread/read recovery foundation
- [x] Encrypted search recovery foundation
- [x] Encrypted media relay integration for MLS group lane

Примечание:
encrypted group lane остаётся forward-only coexistence slice поверх legacy plaintext group history.
Это foundation под MLS-ориентированный поток, а не claim о full encrypted group parity или завершённом
MLS client.
Legacy group reply preview уже деградирован до honest metadata-only/unavailable state без server-side
plaintext body preview, но server-side search по legacy group history всё ещё остаётся
plaintext-dependent.

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
- [x] Encrypted relay
- [x] Encrypted media retention and tombstone parity for encrypted lanes
- [x] TTL cleanup
- [ ] Local media drafts

Примечание:
encrypted media relay уже работает для encrypted lanes, но legacy plaintext attachment path в
репозитории всё ещё существует и остаётся частью coexistence-модели.

---

## Этап 6. RTC foundation

Цель:
добавить звонки.

Задачи:

- [x] Signaling model
- [x] Active call and participant control-plane foundation через `aero-rtc-control`
- [x] Web audio-only 1:1 direct-call bootstrap
- [ ] 1:1 call polish, continuity и richer call UX
- [x] One-active-call-per-user policy
- [x] Group call control-plane и web lobby bootstrap
- [ ] Device controls
- [ ] Quality presets
- [ ] Future screen-share hooks

Примечание:
текущий direct-call web slice остаётся bounded audio-only bootstrap без repo-level STUN/TURN
orchestration и без device controls. Group call flow сейчас покрывает control-plane и lobby UI,
но не multiparty browser media transport.

---

## Этап 7. Platform polish

Цель:
сделать продукт удобным и пригодным к повседневному использованию.

Задачи:

- [x] Web direct chat polish foundation в `apps/web`
- [x] Web message search bootstrap через `aero-gateway`
- [ ] Push notifications
- [ ] PWA
- [x] Desktop shell XP runtime scaffold
- [x] Boot/login application model внутри нового shell
- [x] Canonical self chat shell target без backend self-direct thread
- [x] Canonical direct/group shell windows
- [x] Canonical person profile shell target для people/search/request flows
- [x] Canonical friend requests shell target
- [x] Explorer organizer bootstrap over shell-local desktop registry
- [x] Shell-local custom folders V1 over desktop registry and Explorer
- [x] Контекстное меню фона рабочего стола с bounded shell-local действиями
- [x] Shell-local persistence для window placement и bounded cascade opening
- [x] Финальный desktop usability pass: hit-testing, bounded Start и real window resize
- [x] Desktop interaction correction: dynamic grid, drag-to-folder и Explorer cleanup
- [ ] XP-first theme engine
- [x] Explorer, folder organization и shell launcher
- [x] Mobile practical shell adaptation
- [x] Settings and privacy bootstrap через `aero-gateway`
- [ ] Trash model

Примечание:
`Self Chat` сейчас является честным shell/account target и не симулирует backend conversation.
Mobile adaptation уже реальна, но не означает завершённый PWA/mobile product slice.

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
