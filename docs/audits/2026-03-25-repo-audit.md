# Repo Audit — AeroChat

## 1. Executive summary

Практически AeroChat уже является self-hosted веб-чатом с работающими identity/social graph, legacy direct/group chats, media relay, realtime, desktop shell, mobile launcher adaptation и bounded encrypted lanes для direct/group messaging.

Что реально работает:

- `aero-gateway` уже является единым browser-facing BFF и realtime edge.
- `aero-identity` покрывает регистрацию, вход, сессии, профиль, privacy flags, block list, friend requests и crypto-device registry.
- `aero-chat` покрывает direct chats, groups, moderation, invite links, legacy plaintext history, attachment relay, quotas/cleanup, encrypted direct-message v2 и encrypted group lane.
- web-клиент уже даёт route-backed shell, direct/group chat windows, people/search/profile/friend-request flows, attachment UI, encrypted direct/group projections и bounded 1:1 audio call bootstrap.

Что остаётся foundation/partial:

- encrypted lanes не заменили legacy plaintext path и не дают full parity по search/preview/history.
- group calls пока существуют как control-plane + lobby surface без multiparty browser media transport.
- direct 1:1 calls есть, но остаются bounded audio-only slice без repo-level STUN/TURN orchestration и без device controls.
- `Self Chat` существует как shell/account target, но backend self-direct thread отсутствует.
- `aero-jobs` остаётся health-only skeleton без реальной job-оркестрации.

Крупнейшие несовпадения reality vs docs:

- roadmap переоценивал RTC: group calls выглядели завершёнными, хотя в коде это lobby/control only.
- roadmap формулировал `Self Chat` как завершённую платформенную цель без оговорки, хотя backend conversation для self chat отсутствует.
- README содержал сильно устаревший высокий roadmap-список, не отражавший уже существующие encrypted lanes, shell и media.

## 2. Architecture map

### Верхнеуровневая карта репозитория

- `apps/web` — основной веб-клиент, route-backed shell и product UI.
- `services/aero-gateway` — browser-facing BFF, Connect handlers и websocket realtime hub.
- `services/aero-identity` — identity/auth/social/crypto-device service.
- `services/aero-chat` — chat/groups/media/encrypted lanes/presence/typing.
- `services/aero-rtc-control` — signaling и call control-plane.
- `services/aero-jobs` — пока только health/runtime scaffold.
- `libs/go` — общие Go-библиотеки: auth, observability, crypto helpers, events, testkit.
- `proto/aerochat/*` и `gen/go` — proto-first контракты и generated code.
- `infra/compose`, `infra/k8s`, `infra/nginx` — local/server runtime и deploy topology.

### Ответственности сервисов

- `aero-gateway`
  - Роль: единая браузерная точка входа.
  - Upstream: `aero-identity`, `aero-chat`, `aero-rtc-control`.
  - Transport: HTTP ConnectRPC + `/realtime`.
  - Storage: собственного durable storage нет; realtime hub process-local.
  - Статус: `Implemented`.

- `aero-identity`
  - Роль: auth, sessions, profile, privacy, devices, social graph, crypto-device registry.
  - Upstream/downstream: опирается на Postgres; вызывается gateway и другие сервисы по HTTP.
  - Transport: ConnectRPC.
  - Storage: Postgres.
  - Статус: `Implemented but partial` из-за отсутствия настоящего key-backup flow.

- `aero-chat`
  - Роль: direct chats, groups, moderation, invite links, plaintext messages, encrypted direct/group lanes, attachments, unread/read, typing, presence.
  - Upstream/downstream: проверяет friendship/auth через `aero-identity`, отдаёт scope для RTC, работает с object storage.
  - Transport: ConnectRPC.
  - Storage: Postgres + Redis + MinIO.
  - Статус: `Implemented but partial` из-за coexistence с legacy plaintext и неполной encrypted parity.

- `aero-rtc-control`
  - Роль: start/join/leave/end call, participant state, signaling relay, one-active-call-per-user policy.
  - Upstream/downstream: auth через `aero-identity`, conversation scope через `aero-chat`, realtime publication через gateway.
  - Transport: ConnectRPC.
  - Storage: Postgres.
  - Статус: `Implemented but partial`, потому что это control-plane без media backend.

- `aero-jobs`
  - Роль: отдельный сервис под jobs пока не реализован.
  - Upstream/downstream: только observability/HTTP health surface.
  - Transport: health endpoints.
  - Storage: нет.
  - Статус: `Foundation only`.

### Data / control / realtime / media relationships

- Browser ходит только в `aero-gateway`.
- `aero-gateway` проксирует identity/chat/rtc RPC и публикует realtime envelopes.
- `aero-chat` владеет chat/group/media domain и attachment lifecycle cleanup loop.
- `aero-rtc-control` хранит call state и сигналинг, но не медиа-потоки.
- Browser upload/download для media идёт через presigned object-storage URLs; для encrypted media ciphertext живёт в relay object storage.

### Web shell / runtime map

- Desktop shell активируется на viewport от `1180px`.
- На desktop route остаётся source of truth для foreground target, а window runtime живёт в `DesktopShell`.
- `self_chat`, `profile`, `people`, `friend_requests`, `search`, `settings`, `chats`, `groups`, `explorer` — singleton shell apps.
- `direct_chat`, `group_chat`, `person_profile` — singleton-per-target windows.
- На mobile desktop runtime не используется; `/app` открывает launcher home, а route-backed pages рендерятся в обычной app shell.

### Storage map

- Postgres:
  - identity users/sessions/social graph/crypto devices;
  - direct/group legacy messages;
  - encrypted direct/group envelopes и delivery rows;
  - attachments metadata;
  - rtc calls/participants.
- Redis:
  - presence и typing TTL state.
- MinIO:
  - attachment objects и ciphertext relay blobs.
- Browser local storage / IndexedDB:
  - shell preferences, start menu recents, desktop registry persistence;
  - crypto keystore.
- Browser runtime/session memory:
  - decrypted local encrypted-search index и bounded encrypted projections.

### Deployment / runtime map

- `infra/compose/docker-compose.yml` поднимает full local stack: Postgres, Redis, MinIO, services, web и local edge.
- `infra/compose/docker-compose.server.yml` описывает single-server prod-like topology на image-based runtime.
- Server runtime публикует `web`, `aero-gateway` и `minio`; внутренние сервисы остаются приватными.
- CI проверяет workflow files, compose config, image build, Go tests/lint, web lint/build и proto lint/generate.

## 3. Feature status matrix

| Область | Статус | Почему | Evidence |
| --- | --- | --- | --- |
| Identity | `Implemented but partial` | Регистрация, вход, сессии, профиль, privacy, devices и crypto-device registry есть; key backup пока только status field. | `services/aero-identity/cmd/aero-identity/main.go`, `proto/aerochat/identity/v1/identity_service.proto`, `docs/adr/056-*.md`, `docs/adr/057-*.md` |
| People / social graph | `Implemented` | Friend requests, exact-login search, known people list, person profile flows и block policy реально wired через gateway/web. | `services/aero-identity/internal/domain/identity`, `apps/web/src/pages/PeoplePage.tsx`, `docs/adr/007-social-graph-foundation.md`, `docs/adr/014-web-social-graph-bootstrap.md` |
| Direct chats | `Implemented` | Legacy direct chats, sending/edit/reply/pin/tombstone, unread/read, typing, presence и web UI wired end-to-end. | `services/aero-chat/internal/domain/chat/service.go`, `apps/web/src/pages/ChatsPage.tsx`, `docs/adr/008-*.md`, `docs/adr/016-*.md` |
| Groups | `Implemented` | Group creation, roles, moderation, invite links, replies, pins, unread, search и group UI wired. | `services/aero-chat/internal/domain/chat/service.go`, `apps/web/src/pages/GroupsPage.tsx`, `docs/adr/030-*.md` ... `docs/adr/047-*.md` |
| Encrypted direct lane | `Implemented but partial` | Real opaque storage, per-device delivery, realtime, local decrypt/projection, reply/edit/tombstone/pin/read flows есть; lane отдельна от legacy history, encrypted search только local/session. | `services/aero-chat/db/schema/000014_*.sql`, `services/aero-gateway/internal/realtime/encrypted_direct_message_v2_events.go`, `apps/web/src/chats/useEncryptedDirectMessageV2Lane.ts`, `docs/adr/060-*.md` ... `docs/adr/071-*.md` |
| Encrypted group lane | `Implemented but partial` | MLS-oriented control plane, opaque storage, web projection, outbound text/media, mutations и encrypted read state есть; full MLS client completeness и unified parity отсутствуют. | `services/aero-chat/db/schema/000016_*.sql` ... `000019_*.sql`, `apps/web/src/groups/useEncryptedGroupLane.ts`, `docs/adr/066-*.md` ... `docs/adr/072-*.md` |
| Media | `Implemented but partial` | Upload intent, presigned upload, attachment rendering, voice/video notes, cleanup/quota wired; encrypted relay есть, но legacy plaintext attachment path остаётся. | `services/aero-chat/cmd/aero-chat/main.go`, `services/aero-chat/db/schema/000005_*.sql`, `000015_*.sql`, `apps/web/src/attachments/*`, `docs/adr/035-*.md` ... `docs/adr/073-*.md` |
| RTC / calls | `Implemented but partial` | Signaling и call control-plane есть, web 1:1 audio bootstrap есть, group call только control/lobby; production-grade call stack не собран. | `services/aero-rtc-control/internal/domain/rtc/service.go`, `apps/web/src/rtc/useDirectCallSession.ts`, `apps/web/src/pages/GroupsPage.tsx`, `docs/adr/074-*.md` ... `docs/adr/078-*.md` |
| Desktop shell | `Implemented` | XP-style desktop runtime, singleton/singleton-per-target windows, explorer/folders/start menu и placement persistence реально wired. | `apps/web/src/shell/DesktopShell.tsx`, `apps/web/src/shell/runtime.ts`, `apps/web/src/app/app-routes.tsx`, `docs/adr/079-*.md` ... `docs/adr/082-*.md` |
| Mobile UX | `Implemented but partial` | Practical adaptation есть: launcher home и route-backed pages на mobile; PWA/push/mobile-specific product polish нет. | `apps/web/src/app/AppRouter.tsx`, `apps/web/src/shell/MobileLauncherHome.tsx`, `apps/web/src/shell/viewport.ts`, `docs/adr/083-mobile-practical-shell-adaptation.md` |
| Platform / deploy / self-host | `Implemented` | Local full-stack compose, server compose, GHCR images, shared edge topology и CI реально описаны и проверяются. | `infra/compose/docker-compose.yml`, `infra/compose/docker-compose.server.yml`, `.github/workflows/ci.yml`, `docs/adr/019-*.md` ... `docs/adr/025-*.md` |

## 4. Plaintext exposure audit

### Confirmed plaintext paths

- Message storage:
  - legacy direct messages хранят `text_content` в `direct_chat_messages`.
  - legacy group messages хранят `text_content` в `group_messages`.
- Message transport:
  - legacy direct/group message RPC и gateway realtime продолжают отдавать readable plaintext payload для старых lanes;
  - direct active runtime больше не использует readable legacy direct realtime payload и legacy plaintext
    direct compatibility RPC как активный content-bearing product path.
- Previews:
  - legacy direct reply preview больше не строит `text_preview` из `text_content` и теперь возвращает только honest metadata-only/deleted/unavailable state;
  - legacy group reply preview тоже больше не строит `text_preview` из `text_content` и теперь возвращает только honest metadata-only/unavailable state.
- Search:
  - server-side search по содержимому legacy direct messages больше не используется:
    backend path честно de-scoped и не опирается на `direct_chat_messages.text_content` или direct `search_vector`.
  - server-side search по содержимому legacy group messages тоже больше не используется:
    backend path честно de-scoped и не опирается на `group_messages.text_content` или group `search_vector`.
- Direct history/bootstrap:
  - legacy direct readable history/list/get transport больше не должен считаться активным product path:
    `ListDirectChatMessages` теперь честно de-scoped для content-bearing timeline поведения, а web direct bootstrap не рендерит legacy plaintext timeline как активную direct surface;
  - encrypted direct fetch/projection остаётся отдельным активным path для direct content.
- Direct realtime/runtime:
  - readable legacy direct realtime payload теперь тоже честно de-scoped как активный direct content path:
    web direct thread, desktop shell и Explorer больше не обновляют активные direct surfaces из
    `direct_chat.message.updated`, а live activity для direct lane продвигается только через encrypted
    direct realtime metadata или отдельные non-content control-plane события;
  - active web/runtime usage legacy plaintext direct compatibility RPC surfaces для composer/edit/delete/pin/reply
    теперь тоже de-scoped и не должен трактоваться как продуктовый path для readable direct content.
- Group history/bootstrap:
  - legacy group readable history/list/get transport теперь тоже больше не должен считаться активным product path:
    `ListGroupMessages` честно de-scoped для content-bearing timeline поведения, а web group bootstrap не рендерит legacy plaintext timeline как активную group surface;
  - encrypted group fetch/projection остаётся отдельным активным path для group content.
- Group runtime compatibility RPC:
  - active web/runtime usage legacy plaintext group compatibility RPC surfaces для composer и related content send flow
    теперь тоже de-scoped;
  - browser-facing group thread больше не держит plaintext-compatible `SendGroupTextMessage` как active content operation,
    а group encrypted lane остаётся единственным честным runtime path для visible content authoring/update;
  - allowed coexistence по-прежнему ограничивается metadata/control-plane и bounded internal compatibility reads,
    а не возвратом readable plaintext group bodies в active UX.
- Media:
  - attachment relay поддерживает `relay_schema = 'legacy_plaintext'`;
  - legacy attachment metadata остаётся server-visible: `file_name`, `mime_type`, `size_bytes`, `object_key`.
- Compatibility / coexistence:
  - encrypted lanes живут рядом с legacy plaintext history и не переписывают её.

### Likely plaintext / coexistence paths

- Message list surfaces:
  - пока legacy thread остаётся source of truth для старых direct/group histories, часть user-visible previews и unread UX всё ещё завязана на coexistence двух моделей.
- Search UX:
  - `/app/search` честно разделяет legacy plaintext search и local encrypted search; при этом глобальный search опыт для продукта всё ещё partly anchored в plaintext server-side path.
- Media metadata:
  - даже в encrypted relay server продолжает видеть relay-level bytes/quota/object lifecycle metadata; user-facing descriptor вынесен из server-readable payload, но relay control plane остаётся visible.
- RTC / call-related paths:
  - call metadata, participant roster и signaling envelopes проходят через backend services и gateway realtime;
  - для direct calls media plane идёт браузер-браузер, но SDP/ICE payload не скрыт приложенческим E2EE-слоем.

### Plaintext dependency guardrails

- Server-side search:
  - backend `SearchMessages` для direct scope больше не ищет по legacy plaintext body:
    direct server-side content search честно de-scoped и не использует `direct_chat_messages.text_content` / direct `search_vector`;
  - backend `SearchMessages` для group scope тоже больше не ищет по legacy plaintext body:
    group server-side content search честно de-scoped и не использует `group_messages.text_content` / group `search_vector`;
  - encrypted direct/group lanes в backend search не участвуют и не должны описываться как parity-ready.
- Reply preview:
  - legacy direct reply preview на list/get/send flow больше не зависит от plaintext body target message:
    сохраняется stable `reply_to_message_id`, author/attachment metadata при наличии target и explicit `is_deleted` / `is_unavailable` degradation;
  - legacy group reply preview теперь тоже не зависит от plaintext body target message:
    сохраняется stable `reply_to_message_id`, author/attachment metadata при наличии target и explicit `is_unavailable` degradation;
  - direct preview честно деградирует в `is_deleted`, если target tombstoned;
  - direct/group preview честно деградирует в `is_unavailable`, если target больше нельзя материализовать из legacy history.
- History/bootstrap:
  - direct legacy readable history/list/bootstrap path теперь честно de-scoped на product surface:
    `ListDirectChatMessages` больше не должен обслуживать active readable direct timeline, а web direct thread не притворяется fallback на этот plaintext path;
  - `GetDirectChatMessage` остаётся только internal compatibility path и не должен трактоваться как активный product fetch для readable direct content;
  - legacy group readable history/list/bootstrap path теперь тоже честно de-scoped на product surface:
    `ListGroupMessages` больше не должен обслуживать active readable group timeline, а web group thread не притворяется fallback на этот plaintext path;
  - `GetGroupMessage` остаётся internal compatibility path для bounded domain flows вроде read/edit/reply target resolution и не должен трактоваться как активный product fetch для readable group content;
  - legacy plaintext group compatibility RPC content operations тоже больше не должны трактоваться как browser-facing runtime path:
    web не должен оживлять `SendGroupTextMessage` и похожие legacy content mutations как active product surface для group thread;
  - encrypted direct/group history читается только через отдельные opaque list/get/bootstrap методы и не merge'ится server-side в те же message payloads.
- Search UX boundary:
  - `/app/search` сохраняет coexistence-модель: legacy direct/group content search на сервере честно de-scoped, а encrypted results строятся только из local/session-local decrypted index в браузере;
  - удаление plaintext без replacement search/reply/history strategy сломает текущий product surface, а не просто storage detail.
- Следующий минимальный slice после этого guardrail PR:
  - отдельно убрать одну legacy plaintext dependency за раз;
  - direct legacy reply preview degradation/removal slice уже выполнен;
  - group legacy reply preview degradation/removal slice теперь тоже выполнен;
  - direct legacy server-side search plaintext dependency теперь тоже удалена через честный de-scope backend path;
  - direct legacy readable history/list/get transport теперь тоже удалён как активный product path для direct content;
  - readable direct realtime compatibility payload теперь тоже удалён как активный product path для direct runtime;
  - active web/runtime usage legacy plaintext direct compatibility RPC surfaces теперь тоже de-scoped;
  - legacy group server-side search plaintext dependency теперь тоже удалена через честный de-scope backend path;
  - legacy group readable history/list/get transport теперь тоже удалён как активный product path для group content;
  - legacy group readable realtime plaintext content path теперь тоже удалён как активный product path для group thread;
  - active web/runtime usage legacy plaintext group compatibility RPC surfaces теперь тоже de-scoped;
  - legacy plaintext attachment path и bounded internal compatibility reads всё ещё остаются pending;
  - этот slice не убирает RTC issues и не меняет bounded local encrypted search model.

### Areas that need manual runtime verification

- Logs:
  - в статическом осмотре не найдено явного логирования message text, attachment descriptor или ключевого материала;
  - нужно отдельно проверить container logs и error paths на живом runtime, чтобы подтвердить отсутствие plaintext leakage через proxy/transport errors.
- MinIO / browser access path:
  - надо вручную проверить, не появляются ли user-facing plaintext filenames или MIME hints в presigned flows там, где ожидается encrypted relay UX.
- Realtime payload capture:
  - полезно снять реальный websocket traffic для legacy и encrypted lanes и подтвердить точные границы plaintext/coexistence.

## 5. RTC/call reality check

### Что существует

- `aero-rtc-control` уже держит call lifecycle, participants и signaling RPC.
- `aero-gateway` публикует RTC realtime families.
- Web direct call flow умеет start/join/leave/end, поднимает `getUserMedia({ audio: true })`, создаёт `RTCPeerConnection` и гоняет offer/answer/ICE через control-plane.
- Web group flow умеет видеть active call, стартовать/войти/выйти/завершить его по policy и показывать roster/lobby state.

### Что, вероятно, реально wired

- one-active-call-per-user policy подтверждена domain tests и кодом.
- incoming/ongoing direct call continuity частично держится через awareness + periodic refresh, пока пользователь остаётся в открытом web-сеансе.
- role-aware group-call control уже учитывает `reader` как observe-only.

### Что, вероятно, сломано или неполно

- В репозитории не видно STUN/TURN/ICE server configuration.
- `RTCPeerConnection` создаётся без `iceServers`, значит NAT traversal и internet-grade connectivity выглядят ненадёжно.
- Device controls, output routing, richer audio UX и quality presets отсутствуют.
- Group media transport в браузере отсутствует; group call остаётся только control/lobby model.
- Нет evidence для missed call, background ringing, push wake-up или устойчивого reconnect flow вне активной вкладки.

### Что стоит аудитить первым перед отдельной call-fix задачей

1. Точный direct-call happy path в local/dev и за NAT.
2. Реальные websocket/reconnect сценарии для RTC events.
3. Наличие/отсутствие server config contract под STUN/TURN.
4. Поведение при refresh/rejoin и конфликте `one-active-call-per-user`.
5. Фактические browser/device permissions и fallback UX.

## 6. Self chat reality check

### Что уже есть в shell/UI

- Отдельный route-backed singleton target `/app/self`.
- Иконка и entrypoint в desktop shell, start menu, mobile launcher и route registry.
- `SelfChatPage` честно позиционирует surface как account workspace, а не как fake thread.

### Что backend/data model уже поддерживает и не поддерживает

- Backend поддерживает профиль, настройки, friend requests, devices/sessions и другие account surfaces текущего пользователя.
- Backend не поддерживает self-direct conversation:
  - `CreateDirectChat` запрещает чат с самим собой;
  - direct chat model завязан на friendship semantics между разными пользователями.

### Как это следует трактовать сейчас

- Текущий `Self Chat` надо считать `Implemented` только как shell target.
- Как chat feature это `Missing`.
- Для будущей feature-задачи его не стоит делать purely synthetic frontend lane: так потеряются sync, unread, search, attachment и encrypted-lane reuse.

### Рекомендуемая минимальная стратегия на будущую изолированную задачу

- Рассматривать self chat как специальную server-backed сущность chat domain, а не как обычный friendship-based direct chat.
- Поверх неё reuse'ить существующий direct chat UI и transport там, где это не ломает инварианты.
- Не расширять текущий `CreateDirectChat` молча; лучше ввести явный self-thread path с отдельными правилами и тестами.

## 7. Docs drift

### README mismatches

- Старый high-level roadmap отставал от кода и недооценивал shell, media, encrypted lanes и RTC control-plane.
- README не проговаривал достаточно явно, что `Self Chat` уже есть только как shell target, а не как backend thread.
- README почти не отражал частичный RTC status.

### Roadmap mismatches

- RTC выглядел завершённее, чем есть по коду.
- `Self Chat` был отмечен без важной оговорки про отсутствие backend conversation.
- Checkbox-формулировки скрывали coexistence: encrypted lanes есть, но plaintext всё ещё не удалён из product-critical paths.

### ADR coverage gaps

- Архитектурно-критичного пробела, который требовал бы нового ADR именно в этой задаче, не обнаружено.
- Основная проблема сейчас в drift между docs и code, а не в полном отсутствии архитектурного решения.
- `aero-jobs` как health-only skeleton и attachment cleanup внутри `aero-chat` стоит держать явно в документации, но нового ADR это пока не требует.

### Terminology mismatches

- `calls` в общих документах легко читать как production-usable calling, хотя реально есть control-plane + bounded web slice.
- `Self Chat` можно ошибочно понять как self-conversation.
- `encrypted search` нужно трактовать как local/session search, а не как server-backed parity с legacy search.

## 8. Recommended next feature slicing

### Рекомендуемый порядок

1. Убрать документированные ambiguities вокруг plaintext и добавить runtime verification tests/notes для legacy vs encrypted paths.
2. Изолированно довести plaintext-removal prerequisites в current UX.
3. После этого брать self chat как отдельный backend+frontend slice.
4. Затем делать отдельный call-fix tranche.
5. UI polish делать только после стабилизации data/control paths.

### PR-sized breakdown

- Удаление plaintext из product-critical paths
  - PR 1: инвентаризация и тесты для legacy plaintext search/preview dependencies.
  - PR 2: явное capability/label separation в API и web для legacy vs encrypted lanes.
  - PR 3: убрать product-critical reliance на server-side plaintext previews там, где уже есть encrypted local projection.
  - PR 4: ограничить/вывести из основных user flows legacy plaintext send path для crypto-ready direct chats.
  - PR 5: отдельно пройти media relay metadata, cleanup и logs с runtime verification.

- Backend + frontend self chat
  - PR 1: зафиксировать minimal self-thread model и service invariants.
  - PR 2: добавить backend storage/service/gateway path для self-thread без затрагивания обычных direct chats.
  - PR 3: переиспользовать direct-chat window/UI для self-thread и только затем решать unread/search/encrypted parity.

- Fixing calls
  - PR 1: audit-only direct-call runtime verification и config contract для ICE/STUN/TURN.
  - PR 2: добавить configurable ICE server wiring и retry-safe direct-call bootstrap.
  - PR 3: device controls и clearer call error states.
  - PR 4: только после стабилизации direct calls возвращаться к group media transport design.

- Chat window / UI polish
  - PR 1: direct/group window message density, pinned state и reply affordances.
  - PR 2: mobile parity polish для active chat/group surfaces.
  - PR 3: shell polish вокруг recent windows, launcher/search handoff и transient notices.

## 9. Risks

### Архитектурные

- coexistence legacy plaintext и encrypted lanes усложняет truth model, search и preview semantics.
- `aero-gateway` остаётся central BFF/realtime chokepoint без отдельного distributed event backbone.
- `aero-jobs` пока не взял на себя background responsibilities, часть lifecycle work сидит в `aero-chat`.

### Security

- legacy plaintext message/search paths продолжают существовать.
- call signaling payloads и call metadata server-visible.
- encrypted media relay убирает body plaintext, но не делает весь media lifecycle невидимым для сервера.

### DX / testing

- часть claims легко переоценить по roadmap/README, если не читать code paths.
- static inspection не заменяет runtime capture для realtime, media и browser permissions.
- calls требуют manual verification beyond unit tests.

### Rollout / migration

- future plaintext-removal затронет search, previews, unread UX и migration expectations.
- self chat может случайно сломать direct-chat invariants, если пойти через implicit relaxation текущих правил.
- call fixes без явного ICE config contract могут дать ложное ощущение готовности.

## 10. Appendix

### Key files inspected

- `README.md`
- `AGENTS.md`
- `docs/roadmap.md`
- `docs/adr/*.md`
- `.github/workflows/ci.yml`
- `Taskfile.yml`
- `infra/compose/docker-compose.yml`
- `infra/compose/docker-compose.server.yml`
- `services/aero-gateway/cmd/aero-gateway/main.go`
- `services/aero-identity/cmd/aero-identity/main.go`
- `services/aero-chat/cmd/aero-chat/main.go`
- `services/aero-chat/internal/domain/chat/service.go`
- `services/aero-chat/db/schema/*.sql`
- `services/aero-chat/db/queries/queries.sql`
- `services/aero-rtc-control/internal/domain/rtc/service.go`
- `services/aero-jobs/cmd/aero-jobs/main.go`
- `apps/web/src/app/AppRouter.tsx`
- `apps/web/src/app/app-routes.tsx`
- `apps/web/src/pages/ChatsPage.tsx`
- `apps/web/src/pages/GroupsPage.tsx`
- `apps/web/src/pages/SelfChatPage.tsx`
- `apps/web/src/rtc/useDirectCallSession.ts`
- `apps/web/src/search/encrypted-local-search.ts`
- `apps/web/src/shell/DesktopShell.tsx`
- `apps/web/src/shell/runtime.ts`
- `apps/web/src/shell/viewport.ts`

### Commands run

- `git fetch origin main`
- `git switch -c docs/repo-audit-roadmap-sync origin/main`
- `find . -maxdepth 2 -type d | sort`
- `git log --merges --oneline -n 15`
- `sed -n ...` / `rg -n ...` по README, roadmap, ADR, CI, Taskfile и ключевым code paths
- Отдельные verification-команды из CI перечислены и запущены после подготовки docs sync

### Open questions after static inspection

- Насколько стабилен direct-call flow вне локальной сети и без ручного ICE config.
- Есть ли runtime leakage в websocket/error logs, которого не видно из статического кода.
- Какой минимальный migration strategy нужен для future removal of legacy plaintext without breaking current search/history expectations.
