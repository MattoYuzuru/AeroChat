# ADR-033: Group realtime bootstrap через существующий gateway websocket hub

- Статус: Accepted
- Дата: 2026-04-10

## Контекст

После `ADR-030`, `ADR-031` и `ADR-032` в AeroChat уже существуют:

- canonical group entity и primary thread внутри `aero-chat`;
- text-only group messages;
- explicit membership management и ownership transfer;
- gateway-only web shell для groups;
- bounded websocket realtime foundation внутри `aero-gateway`.

Но groups всё ещё имеют подтверждённый UX-разрыв:

- после `SendGroupTextMessage` thread и group list не обновляются живо;
- join/remove/leave/role/ownership changes требуют явного refresh;
- у уже открытого group shell нет live roster update;
- у других активных сессий того же пользователя нет live sync после join в группу;
- удалённый или вышедший пользователь не получает явного финального сигнала о потере membership.

Следующий архитектурно значимый slice должен сделать groups live, не ломая уже принятый bounded realtime foundation.

Этот этап должен:

- использовать существующий gateway websocket transport и process-local hub;
- оставить все writes на текущих ConnectRPC/HTTP командах;
- добавить bounded fan-out только для text messages и membership changes;
- держать delivery user-scoped и idempotent-friendly;
- не вводить новый event bus, polling-first стратегию, calls, media, RTC, typing, presence или E2EE.

## Решение

### 1. Group realtime публикуется только через существующий `aero-gateway`

`aero-gateway` остаётся единственной публичной realtime entrypoint.

Новый slice не добавляет:

- отдельный group websocket endpoint;
- downstream websocket transport в `aero-chat`;
- Redis pub/sub, Kafka, NATS или другой cross-process bus.

Group realtime fan-out публикуется только через уже существующий in-process hub из `ADR-029`.

### 2. WebSocket остаётся только server-to-client transport

Команды по-прежнему выполняются только через существующие ConnectRPC/HTTP методы:

- `SendGroupTextMessage`
- `JoinGroupByInviteLink`
- `UpdateGroupMemberRole`
- `TransferGroupOwnership`
- `RemoveGroupMember`
- `LeaveGroup`

WebSocket в этом slice не принимает domain writes и не становится вторым command surface.

### 3. Вводится малый и явный каталог group realtime событий

Для bootstrap-этапа фиксируется следующий каталог:

- `group.message.updated`
- `group.membership.updated`
- `group.role.updated`
- `group.ownership.transferred`

`group.membership.updated` используется только для:

- `member_joined`
- `member_removed`
- `member_left`

Role update и ownership transfer остаются отдельными event types, потому что они меняют viewer-relative shell state
с разной семантикой и не должны прятаться в один расплывчатый generic event.

### 4. Payload остаётся web-friendly и recipient-aware

Group realtime payload не публикуется как opaque backend delta.

Каждый envelope содержит готовые для web state сведения:

- recipient-aware `group` snapshot с `selfRole`;
- recipient-aware `thread` snapshot с `canSendMessages`;
- минимальный `member` / `selfMember` snapshot там, где это нужно;
- `groupId` и `affectedUserId` для remove/leave сценариев;
- `message` snapshot для text message fan-out.

Это решение выбрано, потому что:

- current web shell уже зависит от viewer-relative `selfRole`;
- composer state зависит от `canSendMessages`;
- дубли и частичный reordering проще переживать при upsert/remove по устойчивым идентификаторам;
- frontend не обязан после каждой мутации заново перечитывать весь group shell.

### 5. Delivery остаётся user-scoped, а не group-broadcast without context

Gateway публикует события по user-scoped websocket sessions.

При fan-out на группу gateway сам строит recipient-aware payload для каждого участника:

- `selfRole` и `canSendMessages` вычисляются для конкретного получателя;
- тот же event type может иметь разные viewer-relative payload fields у разных пользователей;
- несколько активных сессий одного и того же пользователя получают один и тот же user-scoped state.

Это сохраняет already accepted hub model и не требует отдельной group session registry.

### 6. Membership loss доставляется явно один раз

Для `RemoveGroupMember` и `LeaveGroup` вводится важное правило:

- пользователь, который перестал быть участником группы, получает финальный `group.membership.updated`;
- этот envelope содержит `groupId` и `affectedUserId`, но не содержит active `group` / `thread` / `selfMember` snapshot;
- после этой доставки пользователь больше не попадает в fan-out следующих group событий этой группы.

Это даёт web-клиенту явный bounded сигнал, что group shell надо закрыть и убрать группу из списка,
не опираясь на polling или случайный `404` при следующем refresh.

### 7. Reconnect/replay semantics не расширяются

В этом slice сознательно не добавляются:

- durable replay;
- backlog after reconnect;
- cross-node delivery guarantees;
- event version stream для всей истории группы.

После reconnect web-клиент продолжает опираться на уже существующие fetch paths:

- `ListGroups`
- `GetGroupChat`
- `ListGroupMembers`
- `ListGroupMessages`

Realtime слой отвечает только за live push поверх текущего process-local runtime.

### 8. Frontend обновляет groups state локально и идемпотентно

`apps/web` подписывается на group realtime envelopes и применяет их локально:

- group list обновляется upsert/remove по `group.id`;
- messages upsert'ятся по `message.id`;
- roster upsert/remove выполняется по `member.user.id`;
- selected group shell обновляется без обязательного full refresh после каждой covered mutation.

Reducers обязаны терпеть:

- duplicate delivery;
- частичный reordering там, где это практически возможно на bootstrap-этапе.

### 9. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- group typing;
- group presence;
- group read receipts;
- message edit/delete/pin для groups;
- replay/history beyond existing fetch flows;
- multi-instance delivery;
- distributed event infrastructure;
- calls, media, moderation, channels и E2EE.

## Последствия

### Положительные

- Groups получают первый живой UX без нового transport surface и без отказа от gateway-only edge.
- Web shell больше не обязан делать mandatory refresh после каждой group mutation из scope этого slice.
- Just-joined пользовательские сессии получают live group addition через user-scoped fan-out.
- Removed/left users получают явный финальный signal и прекращают получать future group events.
- Process-local bounded hub остаётся достаточным для текущего single-server runtime.

### Отрицательные

- Gateway становится шире по orchestration responsibility, потому что строит recipient-aware group payload.
- Для `LeaveGroup` post-state частично synthesizes gateway-side envelope metadata без отдельного privileged backend read.
- Multi-instance realtime consistency по-прежнему отсутствует.

### Ограничения

- Нельзя считать этот slice полной collaborative model для groups.
- Нельзя добавлять сюда typing, presence, read receipts, calls, media, RTC или E2EE.
- Нельзя превращать gateway hub в general-purpose event platform.
- Нельзя рассчитывать на replay после reconnect как на часть этого решения.

## Альтернативы

### 1. После каждой group mutation делать только full refresh на web

Не выбрано, потому что product gap именно в отсутствии live delivery,
а текущая задача требует убрать mandatory refresh для covered group flows.

### 2. Ввести один generic `group.updated` event

Не выбрано, потому что такой контракт становится слишком двусмысленным:
message flow, membership loss и ownership transfer требуют разных reducer semantics.

### 3. Сразу внедрить Redis pub/sub или другой distributed bus

Не выбрано, потому что текущий runtime остаётся bounded single-server,
а добавление внешней event infrastructure расширило бы scope раньше подтверждённой необходимости.

### 4. Публиковать одинаковый payload всем участникам группы

Не выбрано, потому что `selfRole` и `canSendMessages` являются viewer-relative,
и одинаковый payload сломал бы group shell для `reader`, owner/admin transitions и membership loss сценариев.
