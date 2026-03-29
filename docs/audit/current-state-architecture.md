# Текущий аудит состояния AeroChat

## Executive summary

На март 2026 года AeroChat уже является работающим self-hosted веб-чатом с одним внешним backend edge через `aero-gateway`, отдельными сервисными границами `aero-identity` и `aero-chat`, локальным/full-stack compose-окружением и prod-like single-server rollout через server compose + shared `Traefik`.

Пользовательский usable slice сегодня:

- регистрация, login, session bootstrap и logout;
- первый desktop shell runtime slice на wide screens:
  - boot/chooser/login handoff;
  - daily fast-entry bypass при валидной сессии;
  - desktop frame с wallpaper/taskbar/start/tray;
  - singleton-based window registry с bounded runtime guard на открытие лишних окон;
  - первые route-backed shell windows поверх существующих web screens;
  - shell-local window placement persistence с viewport-safe restore и bounded cascade opening для новых окон;
  - canonical `self_chat` window c `singleton`, route-backed deep-link handoff, stable taskbar identity и backend-supported self direct chat semantics без отдельного account-only conversation fork;
  - canonical `direct_chat` / `group_chat` windows c `singleton_per_target`, taskbar integration, deep-link handoff и same-window `thread/info` mode для direct/group info semantics;
  - canonical `person_profile` windows c `singleton_per_target` для people, known-user search и friend-request entrypoints, при сохранении direct-chat same-window info mode;
  - canonical `friend_requests` window c `singleton`, route-backed deep-link handoff и stable taskbar identity;
  - canonical `explorer` window c `singleton`, route-backed section/folder handoff, shell-local organizer sidebar, derived desktop/hidden/overflow views, cleaned user-facing copy и tightened XP-like chrome;
  - Start теперь является launcher-first shell surface, а не placeholder button:
    - открывает canonical system apps и launcher/list entrypoints без duplicate windows;
    - показывает bounded recent apps/direct chats/groups по реальным launch/focus событиям;
    - в bounded виде surfac'ит custom folders и ведёт в canonical Explorer folder route;
    - даёт консервативные system actions `Настройки`, `Перезапуск в boot` и `Выйти`;
  - на narrow/mobile viewport появился practical launcher/home surface:
    - `/app` теперь ведёт не в случайный profile fallback, а в dedicated home launcher;
    - home показывает touch-friendly entrypoints в `Я`, `Чаты`, `Группы`, `Поиск`, `Explorer`, `Заявки`, `Настройки`;
    - reuse'ит тот же shell-local recent model для recent apps/direct chats/groups;
    - даёт bounded entry path в custom folders через canonical Explorer folder route;
  - shell-local custom folders V1 поверх desktop registry:
    - folder object живёт только browser-local и переживает reload;
    - folder хранит shortcut references на canonical direct/group targets, а не backend storage semantics;
    - один и тот же chat/group target может находиться в нескольких folders;
    - folder unread badge считает количество member targets с unread, а не сумму unread сообщений;
    - direct/group desktop entry можно drag-and-drop добавить в папку без destructive move semantics;
  - desktop context menus и bounded shell-local management actions:
    - mandatory system apps дают только `Открыть`;
    - direct/group entrypoints умеют `Открыть`, `Скрыть с рабочего стола` и `Добавить в папку` без move/delete semantics;
    - custom folders умеют `Открыть`, `Переименовать`, `Удалить папку` и `Скрыть с рабочего стола`, при этом delete не трогает underlying chats/groups;
    - пустой desktop background теперь даёт отдельное shell-native menu с каноническими действиями `Создать папку` и `Открыть Explorer`, при этом create-folder reuse'ит тот же shell-local custom-folder model, привязывается к выбранной grid-cell и сразу переводит пользователя в bounded naming flow;
  - desktop grid теперь считается от фактической площади workspace, поддерживает drag reorder со snap-to-grid и больше не показывает intrusive overflow card на desktop surface;
- профиль, privacy flags, список device/session и revoke;
- social graph по точному login без публичного каталога;
- direct chats и groups с realtime, typing, presence, read/unread, replies, edit, delete, pin;
- attachments, voice notes, video notes, inline preview;
- web audio-only direct calls в direct chats поверх `aero-rtc-control` и `aero-gateway`;
- compact direct-call continuity surface в web: active direct call awareness переживает thread switching внутри открытой app session, есть bounded reconnect resync и explicit return/rejoin path;
- server-enforced one-active-call-per-user policy: один пользователь не может оставаться active participant более чем в одном active call одновременно;
- web group call control/lobby bootstrap: group chat показывает active call state, compact roster и start/join/leave/end actions поверх существующего RTC control plane, но без multiparty browser media transport;
- `/app/search` как People-first shell app:
  - exact-login-first lookup/add contact без public discovery;
  - invite-link preview для группы до явного join;
  - вторичный legacy plaintext search и bounded local encrypted search;
- bounded encrypted direct lane и bounded encrypted group lane как отдельные timeline рядом с legacy plaintext history.

По зрелости подсистем:

- `identity`, `social graph`, `legacy direct/group chats`, `media relay`, `deploy/local runtime` уже имеют рабочий user-facing slice;
- `desktop shell` теперь имеет первый runtime scaffold на desktop/wide screens, но ещё не завершён как full product shell;
- `desktop shell` теперь уже умеет canonical self-chat, direct/group chat, person-profile, friend-requests и explorer organizer windows с dedicated launch semantics, shell-local custom folders V1, dynamic desktop grid c drag/drop behavior, real Start launcher surface с bounded recents/folder access, desktop context menus с bounded shell-local actions, shell-local window placement persistence/cascade opening и narrow/mobile launcher home surface, но всё ещё не завершён как full product shell;
- encrypted lanes реализованы как usable, но bounded foundation без full parity и без unified history;
- `aero-rtc-control` теперь имеет usable direct-call continuity slice для web, но calls ещё не являются finished product subsystem;
- `aero-jobs` и finished PWA install/offline model пока не реализованы как продуктовые возможности, а desktop/mobile polish остаётся частично bootstrap-only.

## Monorepo architecture map

### `apps/web`

Единственный shipped-клиент. React/Vite SPA с auth bootstrap, route-backed product pages, новым desktop shell runtime на wide screens, practical launcher/home fullscreen flow на narrow screens, websocket realtime через `aero-gateway` и локальным crypto runtime.

Реальная ответственность:

- auth/session bootstrap и protected shell;
- boot/chooser/login handoff и responsive switch между desktop shell runtime и practical narrow/mobile launcher flow;
- desktop shell runtime scaffold: taskbar/start/tray, bounded window registry, launcher-first Start surface, desktop context menus и route-backed app hosting;
- web UI для identity, social graph, direct/group chats и settings;
- attachment composer, voice/video notes и inline preview;
- audio-only direct-call bootstrap через browser WebRTC + gateway/RTC control plane;
- shared direct-call awareness layer для compact incoming/active-call surface и reconnect convergence внутри открытой web session;
- group-call awareness внутри `GroupsPage`: compact badge в group list и встроенный lobby/card для server-backed active group call state;
- bounded local projection для encrypted direct/group lanes;
- bounded local encrypted search внутри browser/runtime boundary.

Не отвечает за:

- server-side orchestration;
- PWA/service worker;
- desktop wrapper;
- native mobile wrapper.

### `services/aero-gateway`

Единая внешняя backend edge-точка. Проксирует ConnectRPC в `aero-identity`, `aero-chat` и `aero-rtc-control`, публикует `/api/realtime`, держит in-memory websocket hub и собирает realtime fan-out для people/chat/group/encrypted delivery и rtc событий.

Реальная ответственность:

- внешний ConnectRPC entrypoint;
- auth/session header propagation;
- websocket upgrade и process-local realtime routing;
- thin orchestration для realtime fan-out после downstream RPC, включая RTC call/signal events.

Не отвечает за:

- storage и доменную модель;
- собственную бизнес-логику identity/chat;
- durable event bus;
- cluster-wide realtime.

### `services/aero-identity`

Владелец account/session/profile/social graph и crypto-device control-plane.

Реальная ответственность:

- register/login/logout;
- immutable `login`, mutable profile fields, privacy flags;
- device/session listing и revoke;
- block list;
- friend requests, friendships и remove friend;
- crypto-device registry, bundles, link intents, approve/revoke.

Не отвечает за:

- chat lifecycle;
- group lifecycle;
- realtime transport;
- key backup implementation.

### `services/aero-chat`

Владелец direct/group chat domain, message history, encrypted lane control-plane, attachment lifecycle, quotas и read/typing/presence state.

Реальная ответственность:

- direct chats и plaintext/group message history;
- group entity, membership, invite links, roles, moderation, ownership transfer;
- direct/group read state, typing, presence;
- message search по plaintext history;
- encrypted direct-message v2 storage/delivery/read state/pin semantics;
- encrypted group control-plane, opaque storage, roster bootstrap и read state;
- attachment upload intent, object linkage, retention, quota accounting и cleanup.

Не отвечает за:

- внешний edge;
- push/PWA;
- RTC/call control;
- media transcoding/proxy/CDN.

### `services/aero-rtc-control`

RTC control-plane service c server-backed active call lifecycle и bounded signal relay.

Реальная ответственность сегодня:

- active call state для direct/group scope;
- participant lifecycle;
- one-active-call-per-user policy и conflict semantics для start/join;
- bounded signaling relay contract;
- authorization поверх chat boundaries.

### `services/aero-jobs`

Пока это такой же health-only skeleton без доменной job orchestration.

### `libs/go/*`

Общие Go-библиотеки:

- `auth`: session token issue/verify;
- `observability`: logger, health/ready mux, HTTP wrapper;
- `dbbootstrap`: schema bootstrap runner;
- `crypto`, `events`, `testkit`: foundation/shared docs и helpers.

### `proto/*`

Proto-first источник контрактов:

- `identity/v1`: auth/profile/social/crypto-device control-plane;
- `chat/v1`: direct/group/media/search/encrypted lane API;
- `rtc/v1`: active call, participant lifecycle и bounded signal relay API;
- `common/v1`: service meta.

### `infra/*`

Реальная инфраструктурная база:

- `infra/compose/docker-compose.yml`: local/dev full stack с `nginx`, `web`, `aero-gateway`, `aero-identity`, `aero-chat`, `postgres`, `redis`, `minio`;
- `infra/compose/docker-compose.server.yml`: prod-like single-server stack без локального `nginx`, с published `web`, `aero-gateway` и `minio`;
- `infra/k8s/shared-edge/*`: shared `Traefik` ingress contract;
- `infra/scripts/*`: bootstrap media storage, render shared-edge manifest, local bootstrap.

## External/runtime topology

### Local/dev topology

Локальный full stack строится через `infra/compose/docker-compose.yml`:

- внешний вход для браузера идёт через `nginx` на `127.0.0.1:${NGINX_PORT}`;
- `nginx` маршрутизирует в `web` и `aero-gateway`;
- `aero-gateway` ходит в `aero-identity` и `aero-chat`;
- `aero-chat` использует `postgres`, `redis`, `minio`;
- `minio-bootstrap` подготавливает bucket и CORS.

### Single-server / prod-like topology

`infra/compose/docker-compose.server.yml` публикует:

- `web`;
- `aero-gateway`;
- `minio`.

`aero-identity`, `aero-chat`, `postgres`, `redis` наружу не публикуются. Публичный HTTPS edge в этой модели вынесен в shared `Traefik`, а не в compose `nginx`.

### Gateway/media edge model

- backend edge для браузера один: `aero-gateway`;
- realtime endpoint живёт там же на `/api/realtime`;
- media edge выделен отдельным host/domain и указывает на MinIO API;
- в dev есть локальный `nginx`, в prod-like compose его нет.

### Object storage role

Object storage используется как relay для attachment blob'ов через presigned upload/download:

- plaintext attachments идут как `legacy_plaintext`;
- encrypted media идёт как `encrypted_blob_v1`;
- сервер владеет lifecycle/quota/linkage metadata, но не расшифровывает ciphertext blob.

### Realtime transport role

Realtime сейчас:

- websocket-only;
- завязан на `aero-gateway`;
- process-local и in-memory;
- без отдельного durable broker или multi-node fan-out.

Это достаточно для текущего single-instance runtime, но не является cluster-ready realtime fabric.

## Product capability matrix

### Auth and sessions

- `implemented`: register, login, logout, bootstrap текущей сессии, device/session listing и revoke.
- `partial/bootstrap/bounded`: текущая сессия не помечается отдельно в settings UI; device model создаёт новый device record при новом login.
- `not implemented yet`: passkeys, MFA, external IdP.

### Desktop shell

- `implemented`: wide-screen desktop shell runtime scaffold, boot/chooser/login handoff, Start/taskbar/tray, singleton window registry, bounded runtime guard для лишних окон, route-backed shell windows для текущих page-level surfaces, canonical `self_chat` / `direct_chat` / `group_chat` / `person_profile` / `friend_requests` / `explorer` targets с taskbar/live-window semantics, deep-link handoff, backend-supported self chat `Я` поверх canonical direct-chat domain без отдельного transport fork и same-window `thread/info` switching внутри direct/group без нового window target, shell-local Explorer organizer surface с cleaned copy и tightened XP-like chrome для desktop/contacts/groups/hidden/overflow/system entrypoints, shell-local desktop entity registry с browser-local persistence для системных entrypoints и canonical direct/group targets, auto-population текущих direct chats/groups при исключении отдельного desktop дубликата для `Я`, dynamic desktop capacity от реальной workspace area без intrusive overflow panel, grid-based desktop drag/reorder со snap-to-grid, spatial folder creation из desktop background menu, drag direct/group entry в custom folder без destructive move, hide-from-desktop semantics без удаления underlying target, shell-local custom folders V1 с browser-local membership references и folder unread badges, desktop context menus с bounded actions для desktop entities/custom folders и пустого desktop background, launcher-first Start surface с bounded recent apps/direct chats/groups, folder shortcuts и консервативными system actions, viewport-safe bounded Start panel с внутренним scroll, shell-local persistence для per-target window placement/state с viewport-safe restore и bounded cascade opening для новых desktop windows, а также draggable title-bar movement, bounded real window resize и real maximize/restore в пределах desktop workspace без скрытия taskbar.
- `partial/bootstrap/bounded`: отдельные launcher/list surfaces `Chats` и `Groups` ещё coexist'ят с canonical chat/group windows, Explorer всё ещё не получил media manager, pinned/trash surfaces или richer folder management inside Start, а shell всё ещё не закрывает полный XP art pass и future desktop capability backlog.
- `not implemented yet`: server-backed folder sync, nested folders, theme switching, wallpaper manager, pinned/trash model, dedicated media viewers, global call manager.

### Identity/profile/privacy

- `implemented`: immutable login, mutable nickname/profile fields, privacy flags, key backup status field в profile.
- `partial/bootstrap/bounded`: `key_backup_status` существует как поле и enum, но полноценного backup flow нет.
- `not implemented yet`: полноценный key backup/recovery UX.

### Social graph

- `implemented`: friend requests, accept/decline/cancel, friendships, remove friend, add by exact login, отсутствие public directory.
- `partial/bootstrap/bounded`: block list есть в backend/gateway, но отдельного web UI для block management нет.
- `not implemented yet`: discovery beyond exact login.

### Direct chats

- `implemented`: explicit create chat между друзьями, message list/send/edit/delete/pin, read receipts, unread, typing, presence, realtime.
- `partial/bootstrap/bounded`: draft recovery отсутствует.
- `not implemented yet`: unified encrypted/plaintext timeline.

### Groups and roles

- `implemented`: create group, canonical primary thread, owner/admin/member/reader, invite links, join, leave, remove, promote/demote, transfer ownership, write restriction, realtime/typing/unread.
- `partial/bootstrap/bounded`: channels/subthreads beyond primary thread отсутствуют.
- `not implemented yet`: richer group IA beyond current single-thread group.

### Search

- `implemented`: People-first `/app/search` с exact-login-first known-user lookup, bounded invite-link preview и plaintext search через backend `SearchMessages`, при сохранении canonical `person_profile` / `group_chat` handoff.
- `partial/bootstrap/bounded`: encrypted search только local-only, session-local, bounded by fetched/decrypted windows.
- `not implemented yet`: server-side encrypted search parity или deep history encrypted indexing.

### Plaintext lane vs encrypted lanes

- `implemented`: legacy plaintext direct/group history и отдельные encrypted direct/group lanes сосуществуют.
- `partial/bootstrap/bounded`: encrypted lanes usable, но живут отдельно, forward-only и без full parity.
- `not implemented yet`: migration/unification старой plaintext history в encrypted timeline.

### Media and attachments

- `implemented`: upload intent, presigned upload/download, attachment-only messages, inline preview, retention/quota/cleanup, encrypted media relay v1.
- `partial/bootstrap/bounded`: encrypted media descriptor и search parity ограничены; media drafts локальны и scoped.
- `not implemented yet`: transcoding, thumbnails, global media drafts, CDN/proxy pipeline.

### Voice notes

- `implemented`: запись, upload и send через attachment flow в web.
- `partial/bootstrap/bounded`: browser capability зависит от `MediaRecorder`; draft не переживает смену scope/reload.
- `not implemented yet`: advanced editor/queue/recovery.

### Video notes

- `implemented`: запись, upload и send через attachment flow в web.
- `partial/bootstrap/bounded`: тот же bounded local recorder без recovery/polish parity.
- `not implemented yet`: advanced editing/transcoding pipeline.

### Realtime

- `implemented`: websocket realtime для people, direct chats, groups, typing/presence/read и encrypted delivery families.
- `partial/bootstrap/bounded`: realtime process-local и рассчитан на single-instance gateway.
- `not implemented yet`: cross-node realtime bus.

### Quotas / retention / lifecycle

- `implemented`: quota admission control, TTL cleanup, detached retention, tombstone parity для encrypted media.
- `partial/bootstrap/bounded`: cleanup выполняется внутри `aero-chat` loop, отдельного jobs subsystem нет.
- `not implemented yet`: richer lifecycle automation через `aero-jobs`.

### Deploy / self-host flow

- `implemented`: local compose, prod-like server compose, image publish flow, shared-edge deploy docs/runbooks.
- `partial/bootstrap/bounded`: single-server contract и ручной/tag-driven rollout; нет zero-downtime и backup automation.
- `not implemented yet`: multi-node rollout/orchestration.

### RTC / calls

- `implemented`: server-backed RTC signaling/call-control foundation, web audio-only direct-call bootstrap, one-active-call-per-user policy и group call control/lobby surface в `GroupsPage`.
- `partial/bootstrap/bounded`: direct media остаётся audio-only и page-scoped; group calls пока ограничены control/lobby semantics без multiparty browser media transport, video, device controls и missed-call/background ringing parity.
- `not implemented yet`: finished group audio/video calling, global call manager, durable recovery и более богатая switching/policy semantics.

### PWA / mobile / desktop shell polish

- `implemented`: responsive SPA shell с route-based workspace, real desktop shell на wide screens и dedicated mobile launcher/home surface на narrow screens.
- `partial/bootstrap/bounded`: mobile launcher уже reuse'ит canonical targets, recent items и folder entry path; manifest/install flow теперь тоже есть, но offline/PWA model и более глубокий mobile productivity polish ещё не доведены.
- `not implemented yet`: desktop wrapper, richer mobile shell/navigation polish beyond current launcher slice, offline-safe runtime model.

## Service ownership and boundaries

### `aero-gateway`

Владеет сегодня:

- внешним API entrypoint;
- websocket realtime edge;
- thin fan-out orchestration после downstream RPC.

Не владеет:

- identity source of truth;
- chat/group/message source of truth;
- attachments/quota state;
- crypto-device registry source of truth.

### `aero-identity`

Владеет сегодня:

- users, profile, sessions/devices;
- privacy flags;
- block list и social graph;
- crypto-device registry, bundle publish/link intent/revoke.

Не владеет:

- direct/group chat lifecycle;
- message history;
- attachment storage/lifecycle;
- realtime delivery.

### `aero-chat`

Владеет сегодня:

- direct/group chat state;
- plaintext and encrypted message/control-plane state;
- group membership/roles/moderation;
- attachment lifecycle/quota/cleanup;
- read/typing/presence state.

Не владеет:

- публичным edge;
- user account lifecycle;
- password auth;
- crypto-device registry.

### `aero-rtc-control`

Сегодня владеет:

- active call lifecycle;
- participant state;
- global one-active-call-per-user invariant;
- bounded signal relay contract.

Не владеет:

- media plane;
- chat membership source of truth;
- push/ringing semantics;
- device controls и future SFU concerns.

### `aero-jobs`

Сегодня не владеет ничем продуктовым, кроме зарезервированной сервисной границы.

## Key architectural patterns already visible in code

- Gateway-only external edge: web и внешние RPC идут через `aero-gateway`; downstream services наружу не публикуются.
- Proto-first contracts: `proto/*` являются формой service API, а handlers и generated code строятся поверх них.
- Direct/group split: direct и group домены живут отдельно и не сведены в один универсальный chat aggregate.
- Encrypted lane coexistence: encrypted direct/group paths живут рядом с legacy plaintext lanes и не притворяются полной заменой history.
- Attachment as first-class entity: attachment имеет отдельный lifecycle, quota semantics, upload session и linkage.
- Object storage via presigned upload: браузер грузит объект напрямую в MinIO/S3-compatible path.
- Process-local realtime assumptions: websocket hub в `aero-gateway` хранит сессии в памяти процесса.
- Server-backed RTC bootstrap without media overreach: `aero-rtc-control` владеет call lifecycle/signaling, а web поднимает только bounded direct audio peer connection.

## Drift and inconsistencies found

- README в заголовке и stack claims завышал текущее состояние, упоминая PWA и звонки как будто это уже существующий продуктовый slice.
- README в формулировках про безопасность слишком легко читался как будто весь messaging уже opaque для сервера, хотя в коде всё ещё есть legacy plaintext direct/group history.
- `docs/roadmap.md` заметно отставал от репозитория по foundation, identity и social graph: существующие README/AGENTS/ADR/tooling/CI и working account-social flows были оставлены unchecked.
- Roadmap не показывал, что block list уже реализован в backend/gateway, хотя web UI для него пока отсутствует.
- Наличие `aero-jobs` могло создать ложное впечатление о вынесенном lifecycle worker, но cleanup сейчас фактически живёт внутри `aero-chat`.
- README и ADR много говорят о PWA-ready/mobile-ready направлении, но в `apps/web` отсутствуют service worker, manifest и install flow.
- Encrypted search легко переоценить, если читать только roadmap/ADR названия: по коду это локальный bounded search, а не backend parity.

## Future feature readiness

### RTC / calls

Стартовая позиция стала рабочей для первого narrow slice:

- граница bounded context уже выделена;
- call lifecycle и signaling уже server-backed;
- gateway уже играет роль внешнего edge.

Ограничения:

- есть только direct-only audio-only web UX;
- нет group/video/device scope;
- нет durable continuity/replay model;
- нет NAT traversal operator platform и полноценных notifications.

### Big UI redesign

Кодовая база готова умеренно:

- маршруты и page-level разделение уже есть;
- direct/group/search/settings изолированы по своим state/hooks;
- current shell можно менять без перестройки backend;
- для нового desktop shell уже есть зафиксированный продуктовый и архитектурный канон, поэтому будущие PR могут идти маленькими slice'ами.

Ограничения:

- много UI-логики находится прямо в page components;
- encrypted/plaintext coexistence уже встроен в страницы и потребует аккуратного redesign;
- нельзя перепутать visual redesign с изменением service boundaries.

### PWA / mobile wrapper work

Стартовая позиция ограниченно готова:

- web-клиент уже SPA и работает через один gateway edge;
- auth/session/bootstrap и realtime path уже централизованы.

Ограничения:

- есть service worker, web push foundation и manifest/install flow, но отсутствует offline model;
- media recording и realtime path не описаны как install/offline-safe;
- mobile polish как отдельный slice ещё не проведён.
