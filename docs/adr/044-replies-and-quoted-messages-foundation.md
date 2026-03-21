# ADR-044: Foundation для replies и quoted message preview в direct chats и groups

- Статус: Accepted
- Дата: 2026-04-20

## Контекст

После foundation для direct chats, groups, attachments, unread state и message update transport
в AeroChat уже существуют:

- canonical direct message timeline;
- canonical primary group thread;
- attachment-only и text + attachment semantics;
- tombstone deletion для direct messages;
- gateway-only realtime fan-out для message updates;
- viewer-relative unread/read state.

Следующий узкий slice должен добавить reply-to-message semantics,
не превращая текущую модель в threaded messaging system.

Этот этап должен:

- разрешить reply на одно существующее сообщение в direct chat;
- разрешить reply на одно существующее сообщение в group primary thread;
- сделать reply first-class message semantics, а не client-only metadata;
- возвращать компактный quoted preview внутри обычного message snapshot;
- сохранить совместимость с attachments, tombstone deletion, unread и existing realtime events;
- не вводить tree/thread hierarchy, sidebar threads, reply chain expansion и search.

Также важно сохранить уже принятые инварианты:

- `aero-chat` остаётся владельцем direct/group message domain;
- `aero-gateway` остаётся единственной внешней backend edge-точкой;
- transport остаётся proto-first и эволюционирует через существующие send/list contracts;
- reply не должен обходить direct friendship/block policy и group membership/role policy;
- reply не должен создавать cross-chat или cross-group references.

## Решение

### 1. Reply остаётся обычным сообщением с одной optional reference

Для этого этапа принимается минимальная canonical model:

- сообщение может не иметь reply reference;
- сообщение может ссылаться ровно на одно предыдущее сообщение;
- reference хранится как optional `reply_to_message_id` в самой message row;
- отдельная thread tree/table/model не вводится.

Таким образом reply не становится новой conversation hierarchy.
Это обычное direct/group сообщение с дополнительной доменной семантикой.

### 2. Direct и group boundary валидируются явно

Reply target допускается только если:

- target message существует на момент отправки;
- target message доступно текущему отправителю;
- direct target принадлежит тому же `chat_id`;
- group target принадлежит той же canonical primary thread группы;
- target message не относится к чужому direct chat или другой группе.

Для direct chats сохраняются уже принятые write boundaries:

- активная friendship обязательна;
- block хотя бы в одну сторону запрещает отправку reply так же, как и обычного сообщения.

Для groups сохраняются уже принятые membership/role boundaries:

- reply может отправлять только роль, которая уже имеет право писать в группу;
- `reader` остаётся read-only и не может отправлять reply.

### 3. Snapshot возвращает compact quoted preview

Полный referenced message payload не дублируется.
Каждый reply message snapshot получает компактный `reply_preview`.

`reply_preview` содержит только viewer-safe минимум:

- `message_id` referenced message;
- compact author summary;
- флаги `has_text` и `attachment_count`;
- короткий `text_preview`, если текст есть;
- явные флаги `is_deleted` и `is_unavailable`.

Этого достаточно для thread/list rendering,
но недостаточно, чтобы незаметно превратить reply foundation в nested history API.

### 4. Tombstone и missing target обрабатываются раздельно

Если direct target позже tombstoned через delete-for-everyone:

- reply message остаётся валидным;
- `reply_to_message_id` сохраняется;
- `reply_preview` деградирует в explicit `is_deleted = true`;
- исходный plaintext preview больше не возвращается.

Если referenced message больше нельзя спроецировать как доступный snapshot
например из-за legacy inconsistency или будущего hard-delete вне этого slice:

- reply message остаётся;
- preview возвращается как `is_unavailable = true`;
- система не пытается искать fallback вне текущего chat/group scope.

### 5. Transport и realtime эволюционируют без нового сервиса

Существующие методы:

- `SendTextMessage`
- `SendGroupTextMessage`
- `ListDirectChatMessages`
- `ListGroupMessages`

расширяются reply-полями эволюционно.

Новый reply-specific service не вводится.

Realtime также остаётся прежним по семействам событий:

- `direct_chat.message.updated`
- `group.message.updated`

Envelope не получает новый reply-only event type.
Reply-семантика передаётся как часть уже существующего message snapshot.

### 6. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- threaded conversations как отдельная модель;
- nested replies;
- reply chain history expansion;
- jump/search/history API для referenced message beyond current fetch scope;
- delete/edit redesign поверх reply foundation;
- notification, search и moderation expansion;
- thread-level unread model.

## Последствия

### Положительные

- Direct chats и groups получают реальную reply semantics без transport redesign.
- Existing message/realtime foundation переиспользуется без второго notification layer.
- Attachment-only и mixed content messages становятся reply targets без special-case API.
- Tombstone deletion не ломает уже отправленные replies.
- SQL-модель остаётся narrow и reviewable.

### Отрицательные

- `aero-chat` получает дополнительную projection-логику для compact preview.
- Message snapshots становятся шире за счёт reply metadata.
- Это не решает future product wants вроде rich thread navigation или reply chain browsing.

### Ограничения

- Нельзя считать этот slice threaded messaging system.
- Нельзя делать cross-chat или cross-group reply fallback.
- Нельзя использовать reply preview как полный message history substitute.
- Нельзя расширять этот PR до search, notifications, moderation или new conversation abstraction.

## Альтернативы

### 1. Ввести отдельную thread tree/table уже сейчас

Не выбрано, потому что это резко расширяет scope,
ломает цель узкого slice и тащит navigation/unread/search complexity раньше необходимости.

### 2. Хранить reply только как client-side local metadata

Не выбрано, потому что это не даёт server source of truth,
ломает multi-device coherence и делает quoted preview нестабильным.

### 3. Дублировать полный referenced message payload в каждом reply snapshot

Не выбрано, потому что это раздувает transport,
создаёт лишнюю связанность между reply и full target payload
и не нужно для foundation-level rendering.
