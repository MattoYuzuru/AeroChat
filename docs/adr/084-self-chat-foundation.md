# ADR-084: Self chat как canonical direct chat текущего пользователя

- Статус: Accepted
- Дата: 2026-03-26

## Контекст

Desktop/mobile shell уже сделал `Я` обязательным системным entrypoint, но до этого этапа он оставался только
account-oriented shell surface без backend conversation semantics.

Теперь продукту нужен реальный self chat, который:

- открывается как тот же route-backed singleton target `Я`;
- работает как обычный личный чат для заметок, быстрых файлов и multi-device handoff;
- не вводит отдельный chat service, отдельный transport или отдельную media модель;
- reuse'ит уже существующий encrypted direct-message v2, attachment relay и local projection path;
- не ломает friendship-based policy для обычных direct chats.

Также важно не нарушить уже принятые ограничения:

- `aero-chat` остаётся владельцем direct chat domain согласно ADR-008;
- encrypted DM v2 остаётся opaque/device-aware lane без server-readable content согласно ADR-060, ADR-061, ADR-063 и ADR-064;
- shell сохраняет canonical `self_chat` как отдельный system app target согласно ADR-079, ADR-080 и продуктовой спецификации shell;
- криптография не импровизируется и не получает отдельный self-chat-only протокол.

## Решение

### 1. Self chat остаётся частью direct chat domain

Self chat реализуется внутри уже существующей direct chat модели `aero-chat`, а не как отдельная сущность account/profile domain.

Следствия:

- `CreateDirectChat` теперь может принимать `peer_user_id`, совпадающий с текущим пользователем;
- canonical self chat считается обычным direct chat по transport/API surface;
- существующие `ListDirectChats`, `GetDirectChat`, attachment API и encrypted DM v2 API переиспользуются без новых RPC.

### 2. Persistence допускает single-participant direct chat

Self chat хранится как canonical direct chat pair, где `user_low_id == user_high_id`, а membership состоит из одного
participant row.

Следствия:

- обычный direct chat между двумя разными пользователями не меняет свою модель;
- self chat не требует дублировать того же пользователя в participant table;
- duplicate protection остаётся canonical и по-прежнему не позволяет иметь несколько self chats для одного user id.

### 3. Policy для write path отдельная от friendship

Для обычных direct chats сохраняется требование активной friendship и отсутствия block.

Для self chat:

- friendship не требуется;
- block policy не участвует;
- write разрешён, пока пользователь аутентифицирован и является owner единственного participant entry.

Это сохраняет прежнюю безопасность для peer-to-peer direct chats и не делает friendship необязательной для обычных диалогов.

### 4. Encrypted DM v2 reuse'ит тот же protocol surface

Self chat не получает отдельный crypto flow.

Вместо этого:

- originating sender device по-прежнему получает delivery для самого себя;
- остальные active devices того же пользователя становятся sender-side target roster;
- `recipient_user_id` остаётся текущим пользователем;
- отдельный self-chat-only transport или special ciphertext schema не добавляются.

Следствие: self chat сразу работает как честный multi-device handoff поверх уже существующего device-aware storage/realtime path.

### 5. Shell сохраняет canonical `Я` как system app target

Маршрут `/app/self` остаётся canonical route-backed singleton target.

Frontend:

- открывает или создаёт self chat через уже существующий gateway chat client;
- рендерит тот же рабочий direct chat surface вместо старой account-only заглушки;
- не создаёт отдельный desktop shortcut/entity для self chat среди auto-populated direct chats, чтобы не дублировать системный entrypoint `Я`.

## Последствия

### Положительные

- `Я` становится реальным chat surface без отдельного доменного дерева.
- Encrypted media, attachment-only send и multi-device self-delivery работают без новой backend архитектуры.
- Shell сохраняет канонический singleton target и не плодит duplicate desktop entries.

### Отрицательные

- Direct chat domain теперь поддерживает две формы membership: двухучастниковый peer chat и single-participant self chat.
- Часть helper-логики должна явно учитывать self-chat case вместо неявного предположения о двух разных участниках.

### Ограничения

- Это не делает unread/read state device-relative: self chat остаётся user-relative direct chat.
- Это не меняет RTC policy: self chat не становится основанием для self-call semantics.
- Это не вводит отдельный self-chat search/storage/retention model.

## Альтернативы

### 1. Оставить `Я` отдельной shell/account surface без backend conversation

Не выбрано, потому что это ломает ожидаемый продуктовый сценарий заметок и multi-device media handoff.

### 2. Сделать self chat отдельной account-domain сущностью

Не выбрано, потому что это дублирует уже существующий chat/media/encrypted transport stack и усложняет дальнейшую поддержку.

### 3. Реализовать self chat как обычный двухучастниковый direct chat с дублированием того же user id

Не выбрано, потому что это даёт искусственную membership модель, усложняет constraints и хуже отражает реальную семантику self chat.
