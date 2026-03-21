# ADR-050: Foundation для attachment retention и delete semantics после message tombstone

- Статус: Accepted
- Дата: 2026-03-21

## Контекст

После `ADR-035`, `ADR-048` и `ADR-049` в AeroChat уже существуют:

- first-class attachment entity;
- explicit upload/session lifecycle;
- bounded cleanup для stale и orphaned unattached attachments;
- deterministic per-user quota admission;
- direct message tombstone semantics;
- gateway-only внешний контракт.

Но у media lifecycle всё ещё оставался фундаментальный gap:

- attachment в состоянии `attached` мог удерживать quota бесконечно;
- direct message tombstone не менял attachment lifecycle вообще;
- cleanup из `ADR-048` сознательно не трогал linked attachments;
- backend не различал attachment, удерживаемый активной видимой историей, и attachment, оставшийся только у tombstoned message.

Нужен следующий узкий slice, который:

- вводит реальную retention/delete-semantics foundation для attachments после history transition;
- остаётся backend-first и не строит trash/archive product surface;
- не ломает текущую visible attached history для активных сообщений;
- не превращает tombstone request в немедленный hard-delete object storage;
- сохраняет gateway-only внешний контракт и существующую message ownership model.

## Решение

### 1. `attached` больше не считается бессрочным финальным состоянием

Attachment в состоянии `attached` считается удерживаемым только **активной видимой историей**.

Это означает:

- attachment у обычного visible message остаётся `attached`;
- `attached` продолжает участвовать в quota usage;
- `attached` продолжает быть единственным message-linked status, который возвращается в обычных message snapshots.

### 2. Вводится новый explicit lifecycle status `detached`

Для attachment lifecycle добавляется состояние:

- `detached`

Семантика `detached`:

- attachment уже не считается активной частью message history;
- attachment больше не должен удерживать quota как `attached`;
- attachment ещё не `deleted` и не означает мгновенный hard-delete object storage;
- attachment ожидает cleanup после retention grace period;
- object cleanup остаётся state-driven и idempotent.

`detached` не используется для upload/orphan lifecycle из `ADR-048`.
Он существует только для attachment, которые раньше были linked к message history, но затем потеряли active-history retention.

### 3. Direct message tombstone становится explicit source event для retention transition

Для текущего этапа единственным backend history-transition event считается:

- `DeleteMessageForEveryone` в direct chat.

При успешном direct tombstone backend в одной persistence-операции:

- создаёт tombstone;
- снимает pin, если он был;
- переводит все linked attachments этого message из `attached` в `detached`.

Переход не вычисляется по UI, не угадывается по bucket contents и не зависит от клиента.

### 4. Tombstoned direct message больше не удерживает attachment как active visible history

После перехода `attached -> detached`:

- attachment больше не возвращается в обычном direct message history snapshot;
- tombstoned message остаётся tombstone-событием, но без активного attachment payload;
- существующий attachment access path не должен давать usable download для `detached`.

Это фиксирует правило:
после direct tombstone attachment больше не считается частью active visible history semantics,
но object storage удаляется отдельно и консервативно.

### 5. Cleanup для `detached` остаётся staged и configurable

Для `detached` attachment вводится отдельный retention grace period.

Cleanup выполняется тем же bounded in-process loop внутри `aero-chat`, что и в `ADR-048`, но с новым eligibility rule:

- `detached` attachment становится object-delete eligible только после configured retention window;
- delete идёт по точному `bucket + object_key`;
- отсутствие объекта в storage остаётся idempotent-safe;
- после safe delete attachment переводится в `deleted`.

Hard-delete row из БД по-прежнему не вводится.

### 6. Quota accounting перестаёт считать `detached` как active budget

Quota usage по-прежнему считается только по backend-owned metadata.

В active quota budget остаются:

- `pending`
- `uploaded`
- `attached`
- `failed`

Из active quota budget исключаются:

- `detached`
- `expired`
- `deleted`

Таким образом quota release становится детерминированным:
она происходит в момент explicit backend transition `attached -> detached`,
а не в момент bucket cleanup или UI-события.

### 7. Direct и group history сейчас различаются явно

На текущем этапе direct и group attachment model различаются в одном узком месте:

- для direct chats уже существует tombstone delete path;
- для groups отдельный message delete/tombstone slice пока отсутствует.

Следствия:

- direct attachments могут переходить в `detached` через `DeleteMessageForEveryone`;
- group attachments на текущем этапе остаются `attached`, пока не появится отдельный explicit group history-transition event;
- leave/remove/restrict membership не считаются attachment retention transition сами по себе.

Эта асимметрия фиксируется явно и не скрывается за “общей логикой”.

### 8. Публичный API surface меняется минимально

Gateway-only внешний контракт сохраняется.

На этом этапе:

- не добавляются новые retention management RPC;
- не добавляется trash/explorer API;
- существующие send/delete flows остаются прежними;
- attachment status получает `detached`, чтобы typed contract не терял реальное backend state.

### 9. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- group message delete redesign;
- restore flow;
- user-facing trash/archive UI;
- explorer/files page;
- bulk retention management;
- отдельная jobs-platform;
- storage reconciliation scanner;
- policy governance beyond current grace-period cleanup;
- hard-delete attachment rows;
- per-user/per-group retention overrides.

## Последствия

### Положительные

- `attached` больше не удерживает quota бесконечно после direct tombstone.
- Attachment retention становится явной backend-owned моделью, а не декларацией в документации.
- Cleanup из `ADR-048` получает следующий безопасный шаг без bucket scan.
- Active visible history для обычных сообщений не ломается.
- Delete semantics остаётся консервативной: tombstone не равен мгновенному object delete.

### Отрицательные

- Появляется ещё один attachment lifecycle status, который нужно учитывать в transport и тестах.
- Direct и group message retention пока различаются из-за отсутствия group delete foundation.
- Удалённый direct message больше не выступает носителем attachment payload в history snapshot.

### Ограничения

- Нельзя трактовать `detached` как user-facing trash model.
- Нельзя распространять cleanup на `attached` без explicit history-transition event.
- Нельзя делать object delete прямо в tombstone request.
- Нельзя вычислять retention transition по клиентскому рендерингу или bucket age.

## Альтернативы

### 1. Оставить только документацию без state transition

Не выбрано, потому что это не решает quota и cleanup problem реально.

### 2. Сразу удалять object storage в tombstone request

Не выбрано, потому что это слишком агрессивно,
ухудшает retry safety
и смешивает message delete с object cleanup.

### 3. Повторно использовать `expired` для tombstoned attached media

Не выбрано, потому что `expired` уже закреплён в `ADR-048` как состояние unattached lifecycle,
а attached retention transition требует отдельной явной семантики.
