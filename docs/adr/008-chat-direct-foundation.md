# ADR-008: Foundation для direct 1:1 chats и текстовых сообщений

- Статус: Accepted
- Дата: 2026-03-18

## Контекст

После завершения social graph foundation проекту нужен следующий изолированный slice:
минимальная, production-oriented база для личных 1:1 чатов внутри `aero-chat`.

Этот этап должен:

- ввести отдельный доменный объект direct chat;
- не создавать чат автоматически при принятии friendship;
- разрешать явное создание чата только между уже существующими друзьями;
- сохранить разделение между `aero-identity` и `aero-chat`;
- добавить foundation для текстовых сообщений, safe markdown metadata, tombstone deletion и pin/unpin;
- не внедрять groups, RTC, media, read receipts, typing, presence, drafts и E2EE.

Также важно не сломать уже принятые ограничения:

- social graph остаётся source of truth для friendship внутри `aero-identity`;
- `aero-chat` не получает ownership над friendship lifecycle;
- plaintext message storage на этом этапе не считается crypto-ready реализацией;
- transport должен оставаться proto-first и thin;
- persistence должна оставаться явной и типизированной через PostgreSQL + sqlc.

## Решение

### 1. Граница сервиса

Direct chat foundation реализуется внутри сервисной границы `aero-chat`.

`aero-chat` отвечает за:

- lifecycle direct chats;
- message persistence;
- tombstone deletion semantics;
- pin/unpin message state;
- chat-facing API.

`aero-identity` остаётся владельцем:

- пользователей;
- sessions;
- block list;
- friendship relation.

### 2. Явное создание direct chat

Direct chat создаётся только явной операцией `CreateDirectChat`.

Принятие friend request:

- не создаёт чат автоматически;
- не считается скрытым side effect для chat domain.

Таким образом friendship и direct chat остаются разными доменными сущностями.

### 3. Eligibility policy

Создание direct chat разрешено только если:

- инициатор аутентифицирован;
- второй пользователь отличается от инициатора;
- между пользователями существует активная friendship;
- для этой canonical pair ещё не существует direct chat.

Проверка friendship выполняется через узкий adapter boundary внутри `aero-chat`, который читает только факт активной связи из relation source of truth.

`aero-chat` не пишет в social graph storage и не управляет friendship semantics.

### 4. Persistence model

Для chat foundation используется PostgreSQL.

Минимальный набор таблиц:

- `direct_chats`
- `direct_chat_participants`
- `direct_chat_messages`
- `direct_chat_message_tombstones`
- `direct_chat_pins`

`direct_chats` хранят canonical pair для защиты от дубликатов.

`direct_chat_participants` фиксирует явное membership-состояние и оставляет путь к будущему расширению transport и permission checks без переизобретения схемы.

### 5. Текстовые сообщения и markdown policy

На этом этапе вводятся только текстовые сообщения.

Сервер хранит:

- plaintext text payload;
- metadata о markdown policy.

Поддерживается только `safe_subset_v1`.

Следствия:

- raw HTML запрещён;
- сервер не рендерит markdown;
- message payload остаётся обычным текстом;
- frontend и будущие клиенты обязаны трактовать policy как safe subset без raw HTML.

Это foundation для продукта, но не E2EE-реализация и не финальная content model.

### 6. Tombstone deletion

Удаление сообщений для всех строится на tombstone semantics.

Следствия:

- сообщение не hard delete как user-facing основная модель;
- факт удаления хранится отдельным доменным состоянием;
- после удаления message body не должен возвращаться как обычный видимый контент;
- transport должен показывать tombstone вместо исходного текста.

На этом этапе delete-for-everyone разрешён только автору сообщения.

### 7. Pin / unpin

Direct chat foundation поддерживает pin/unpin message state.

На этом этапе:

- pin доступен участникам чата;
- message pin хранится отдельно от message body;
- pin deleted message запрещён.

Модель допускает расширение без пересборки основной message table.

### 8. Transport

Chat API фиксируется через protobuf и ConnectRPC методами:

- `CreateDirectChat`
- `ListDirectChats`
- `GetDirectChat`
- `SendTextMessage`
- `ListDirectChatMessages`
- `DeleteMessageForEveryone`
- `PinMessage`
- `UnpinMessage`

Transport layer:

- извлекает auth context из bearer session token;
- не содержит бизнес-логики chat domain;
- делегирует решения application/service слою.

## Последствия

### Положительные

- Появляется минимальный, но реальный direct chat foundation.
- Friendship остаётся отдельным доменом и не смешивается с chat lifecycle.
- SQL-модель остаётся явной и пригодной для sqlc.
- Tombstone и pin/unpin закладываются сразу, без hard-delete semantics по умолчанию.

### Отрицательные

- На этом этапе нет edit message, drafts, receipts, typing и presence.
- Plaintext storage временно используется как foundation до отдельной crypto-реализации.
- Для отображения участников chat service читает identity-owned user/session data из общей БД, что требует дисциплины в service boundaries.

### Ограничения

- Нельзя считать этот этап реализацией E2EE.
- Нельзя создавать group chats в рамках этой модели.
- Нельзя автоматически создавать direct chat при social graph событиях.
- Нельзя разрешать raw HTML как допустимую message payload семантику.

## Альтернативы

### 1. Автоматически создавать чат при принятии friendship

Не выбрано, потому что это смешивает social graph и chat lifecycle и усложняет дальнейшие продуктовые политики.

### 2. Хранить direct chat только как canonical pair без participant table

Не выбрано, потому что participant membership нужен как явный permission boundary и как задел на дальнейшее развитие transport и policy logic.

### 3. Делать delete message через hard delete

Не выбрано, потому что это противоречит принятой tombstone semantics из ADR-004.
