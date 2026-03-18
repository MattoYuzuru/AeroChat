# ADR-034: Group typing bootstrap через bounded ephemeral state и существующий gateway realtime

- Статус: Accepted
- Дата: 2026-04-11

## Контекст

После `ADR-030`, `ADR-031`, `ADR-032` и `ADR-033` в AeroChat уже существуют:

- canonical group entity и primary thread внутри `aero-chat`;
- text-only group messaging bootstrap;
- membership roles `owner` / `admin` / `member` / `reader`;
- bounded realtime fan-out для group messages и membership changes через `aero-gateway`.

Но groups всё ещё имеют последний подтверждённый usability-разрыв:

- в открытой группе нет live typing feedback;
- отправка текста выглядит менее живой, чем direct chat;
- `reader` уже read-only в message flow, но typing policy для ролей ещё не зафиксирована;
- web shell опирается только на message/membership realtime и не умеет устойчиво держать typing state.

Следующий slice должен закрыть этот разрыв, не размывая уже принятые границы.

Этот этап должен:

- добавить bounded typing только для group primary thread;
- переиспользовать уже существующий ephemeral Redis-style подход;
- сохранить WebSocket только для server-to-client delivery;
- оставить все typing writes на обычных ConnectRPC/HTTP мутациях;
- уважать membership scope, role policy и privacy constraints;
- не смешивать решение с presence, read receipts, calls, media, RTC, moderation и E2EE.

## Решение

### 1. Group typing остаётся ephemeral и не попадает в durable history

Group typing трактуется как краткоживущее thread-scoped состояние участника группы.

На этом этапе typing:

- не попадает в message history;
- не хранится в PostgreSQL;
- не имеет audit trail и replay history;
- живёт только в пределах короткого TTL;
- очищается по явной команде `clear` или по истечению TTL.

### 2. Ownership и orchestration остаются внутри `aero-chat`

`aero-chat` остаётся владельцем:

- role-aware authorization для group typing;
- проверки membership и thread scope;
- постановки и очистки ephemeral typing indicator;
- выдачи текущего typing snapshot для `GetGroupChat` и typing-методов.

`aero-gateway` не становится владельцем typing domain.
Он только проксирует HTTP/ConnectRPC команды и публикует realtime events через уже существующий hub.

### 3. Persistence model переиспользует существующий bounded Redis-style слой

Для group typing используется тот же класс ephemeral storage, что и для direct typing:

- отдельный Redis-backed state layer;
- короткий TTL;
- отсутствие SQL-таблиц и durable cleanup model.

Ключ typing indicator фиксируется по scope:

- `group_id`
- `thread_id`
- `user_id`

Это сохраняет явную thread-boundary уже сейчас, даже при одной canonical primary thread на группу.

### 4. Privacy policy переиспользует существующий user-level typing visibility flag

Group typing подчиняется уже существующему privacy-флагу `typing_visibility_enabled`.

Следствия:

- если пользователь отключил видимость набора, новый group typing indicator не раскрывается никому;
- собственный typing пользователя с отключённым флагом также не возвращается как видимое состояние;
- `ClearGroupTyping` остаётся допустимой операцией независимо от privacy-флага;
- отдельный group-specific privacy toggle не вводится.

Это решение выбрано как минимальное и согласованное с уже принятым поведением direct typing.

### 5. Role policy остаётся консервативной

Typing emit разрешён только ролям, которые уже имеют право отправлять group messages:

- `owner`
- `admin`
- `member`

`reader`:

- может читать group thread;
- может видеть текущий typing snapshot группы;
- не может выполнять `SetGroupTyping`.

UI обязан уважать это правило, но source of truth остаётся backend authorization.

### 6. Transport surface остаётся явным и typed

`ChatService` расширяется bounded surface:

- `SetGroupTyping`
- `ClearGroupTyping`

`GetGroupChat` также начинает возвращать текущий `GroupTypingState`,
чтобы существующий fetch path мог восстановить bounded typing snapshot после reload/reconnect.

WebSocket по-прежнему:

- не принимает domain writes;
- не становится двусторонним command transport.

### 7. Realtime event остаётся явным и reducer-safe

Для live updates вводится отдельный event type:

- `group.typing.updated`

Payload содержит:

- `groupId`
- `threadId`
- `typingState`

`typingState` несёт устойчивый snapshot активных видимых typers для конкретной thread.
Reducer обязан терпеть duplicate delivery и повторное применение того же snapshot без flicker.

### 8. Delivery scope ограничен только текущими участниками группы

Gateway публикует `group.typing.updated` только current group members.

Следствия:

- неучастники группы не получают typing events;
- удалённый или вышедший пользователь не получает будущие typing events этой группы;
- group typing не превращается в global presence signal.

### 9. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- group presence;
- group read receipts;
- typing в списке групп и previews;
- replay после reconnect beyond existing fetch paths;
- cross-process delivery и multi-instance infra;
- calls, media, RTC, moderation, channels и E2EE.

## Последствия

### Положительные

- Group thread получает последний bounded live-signal без нового transport surface.
- Typing reuse'ит уже существующий Redis-style ephemeral подход и не требует SQL-модели.
- Privacy policy остаётся согласованной между direct и group typing.
- `reader` остаётся строго read-only в write flows, но не ломает read-side UX группы.
- `GetGroupChat` становится достаточным fetch path для восстановления typing snapshot после reconnect.

### Отрицательные

- Gateway получает ещё один точечный realtime event type и fan-out path.
- Single-server/process-local realtime ограничения из `ADR-029` и `ADR-033` сохраняются.
- Typing state остаётся best-effort bootstrap signal без distributed guarantees.

### Ограничения

- Нельзя считать это реализацией group presence.
- Нельзя добавлять сюда read receipts, calls, media или moderation “заодно”.
- Нельзя переносить group typing writes в WebSocket transport.
- Нельзя хранить typing state в PostgreSQL ради удобства query/debug.

## Альтернативы

### 1. Хранить group typing в PostgreSQL

Не выбрано, потому что typing остаётся короткоживущим ephemeral state,
а SQL-модель здесь добавила бы лишнюю TTL/cleanup сложность.

### 2. Публиковать typing только локально на клиенте без backend state

Не выбрано, потому что это не даёт live typing другим участникам и плохо переживает несколько активных сессий.

### 3. Делать typing-команды через WebSocket

Не выбрано, потому что уже принят явный transport boundary:
mutations остаются на ConnectRPC/HTTP, а WebSocket используется только для server-to-client delivery.
