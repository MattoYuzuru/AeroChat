# ADR-031: Group chat bootstrap с одной primary thread на группу

- Статус: Accepted
- Дата: 2026-04-08

## Контекст

После `ADR-030` в AeroChat уже существуют:

- canonical group entity внутри `aero-chat`;
- membership roles `owner` / `admin` / `member` / `reader`;
- invite links и explicit join flow;
- gateway-only web shell для открытия группы;
- canonical direct message model для 1:1 чатов.

Следующий архитектурно значимый slice должен добавить минимальный, но production-oriented bootstrap для group messaging,
не размывая уже принятые границы.

Этот этап должен:

- зафиксировать canonical message container для групп;
- добавить text-only group timeline;
- корректно применять role-based send policy;
- сделать `reader` реально read-only в message flow;
- дать минимальный web shell для чтения и отправки group text messages;
- не смешивать bootstrap group chat с realtime fan-out, calls, media, moderation и channel-management.

Также нужно сохранить уже принятые инварианты:

- `aero-chat` остаётся владельцем group и message domain;
- `aero-gateway` остаётся единственной внешней backend edge-точкой;
- transport остаётся proto-first и typed через ConnectRPC;
- raw HTML в пользовательских сообщениях остаётся запрещён;
- текущая markdown-семантика остаётся `safe_subset_v1`;
- криптография не импровизируется и этот slice не считается E2EE.

## Решение

### 1. Каноническая модель: одна primary thread на группу

Для этого этапа принимается модель:

- каждая группа получает ровно одну canonical primary thread;
- primary thread принадлежит группе и хранится внутри `aero-chat`;
- group messages принадлежат этой primary thread;
- thread является явной сущностью хранения, а не неявным “group_id как timeline”.

Причины:

- group и message container не смешиваются в одну сущность;
- появляется явная точка расширения для будущих channel-like и moderation-oriented сценариев;
- текущий slice остаётся узким, потому что thread пока только одна и не публикуется как общий multi-channel surface;
- storage model уже готова к будущему появлению дополнительных thread/container semantics отдельным решением.

На этом этапе web и transport работают только с одной primary thread на группу.
Полноценная multi-thread/channel model не вводится.

### 2. Ownership остаётся у `aero-chat`

Group thread и group messages остаются внутри сервисной границы `aero-chat`.

Причины:

- группа уже закреплена за `aero-chat` как conversation container в `ADR-030`;
- message lifecycle и role-based send policy принадлежат chat domain;
- перенос thread ownership в gateway или identity нарушил бы уже принятые сервисные границы.

`aero-gateway` в этом slice остаётся только edge-proxy и не получает ownership над group message semantics.

### 3. Role-based send policy

На этом этапе действуют следующие правила:

- `owner` может читать и отправлять text messages;
- `admin` может читать и отправлять text messages;
- `member` может читать и отправлять text messages;
- `reader` может читать history, но не может отправлять сообщения.

Следствия:

- `reader` становится реальной read-only role уже в bootstrap message flow, а не только “role на будущее”;
- permission check выполняется в `aero-chat`, а не только во frontend;
- web-клиент обязан показывать disabled composer для `reader`, но UI не считается source of truth для permission enforcement.

### 4. Message model

На этом этапе вводятся только group text messages.

Минимальная canonical модель сообщения:

- `id`
- `group_id`
- `thread_id`
- `sender_user_id`
- `kind`
- `text`
- `markdown_policy`
- `created_at`
- `updated_at`

Ограничения:

- поддерживается только `MESSAGE_KIND_TEXT`;
- `markdown_policy` фиксируется как `safe_subset_v1`;
- raw HTML запрещён той же серверной валидацией, что и в direct chat;
- сервер хранит text payload как foundation-level plaintext storage до отдельной crypto-реализации;
- attachments, edit flow, delete-for-everyone, pin/unpin и read receipts для group messages не вводятся.

### 5. Persistence model

Для bootstrap используются PostgreSQL-таблицы:

- `group_threads`
- `group_messages`

`group_threads` хранит canonical primary thread на группу.
`group_messages` хранит текстовые сообщения этой thread.

При создании новой группы primary thread создаётся сразу в той же storage-модели.
При отправке сообщения обновляются `updated_at` у thread и у самой группы,
чтобы group list и message timeline опирались на один и тот же activity signal.

### 6. Transport surface

`ChatService` расширяется методами:

- `GetGroupChat`
- `ListGroupMessages`
- `SendGroupTextMessage`

Surface выбран как минимальный и достаточный:

- `GetGroup` остаётся group metadata entrypoint;
- `GetGroupChat` возвращает группу вместе с canonical thread snapshot;
- history и send операции остаются явными и не смешиваются с realtime transport.

### 7. Web bootstrap

`apps/web` получает минимальный group chat shell внутри уже существующей страницы групп:

- открыть группу;
- увидеть canonical thread;
- загрузить existing text messages;
- отправить text message, если текущая роль это разрешает;
- увидеть disabled composer и read-only notice для `reader`.

Frontend остаётся gateway-only и не получает прямого доступа к downstream URL.

### 8. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- group realtime fan-out;
- group typing / presence / read receipts;
- moderation commands;
- attachments, media и voice/video messages;
- message edit;
- delete-for-everyone;
- pin / unpin;
- group calls и RTC policies;
- public discovery;
- promote / demote;
- multi-thread/channels как пользовательская функция.

## Последствия

### Положительные

- Появляется чёткая canonical group messaging model без premature channel system.
- `reader` получает реальную продуктовую семантику read-only role.
- Group chat bootstrap остаётся narrow и reviewable, но уже готов к дальнейшему расширению.
- Web получает реальный group thread UX без обхода gateway и без raw HTML rendering.

### Отрицательные

- На этом этапе у группы только одна thread и нет product-level channel management.
- Нет live updates: после команд клиент опирается на обычные HTTP/ConnectRPC вызовы.
- Message model для groups пока уже, чем у direct chat по mutation surface.

### Ограничения

- Нельзя считать этот slice реализацией полного group collaboration.
- Нельзя добавлять realtime, calls, media или E2EE “заодно”.
- Нельзя разрешать `reader` отправку сообщений ради UX-упрощения.
- Нельзя превращать primary thread в общий multi-channel contract без нового решения.

## Альтернативы

### 1. Хранить group messages прямо на сущности `group`

Не выбрано, потому что это смешивает conversation container и message container и ухудшает путь к future channel-like semantics.

### 2. Сразу делать полноценные channels / несколько thread на группу

Не выбрано, потому что это расширяет scope PR, тащит moderation и navigation complexity и хуже соответствует задаче узкого bootstrap slice.

### 3. Разрешить отправку сообщений только `owner` и `admin`

Не выбрано, потому что текущая foundation-роль `member` уже должна быть полезной для обычного group chat, а `reader`
нужен как явная read-only role.
