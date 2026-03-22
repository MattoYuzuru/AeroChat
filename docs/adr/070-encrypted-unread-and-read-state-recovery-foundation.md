# ADR-070: Encrypted unread and read-state recovery foundation

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-060`...`ADR-069` encrypted direct-message v2 и encrypted group lane уже умеют:

- хранить и доставлять opaque ciphertext без server-side plaintext projection;
- строить bounded web local projection для direct и group encrypted lanes;
- восстанавливать replies, edits, tombstones и pin/unpin через stable logical `message_id`.

Но unread/read semantics для encrypted lanes всё ещё оставались сломанными:

- `ListDirectChats` / `GetDirectChat` и `ListGroups` / `GetGroupChat` не возвращали отдельный encrypted unread state;
- mark-as-read работал только для legacy plaintext history;
- realtime convergence для encrypted delivery не давал детерминированного viewer-relative unread progression;
- сервер не должен был получать plaintext preview или plaintext projection только ради unread/read.

Нужен отдельный узкий slice, который вернёт unread/read foundation для encrypted direct и encrypted group paths, не затрагивая search parity, backup/recovery или full MLS completeness.

## Решение

### 1. Вводится общая encrypted read position model

Для encrypted direct-message v2 и encrypted group lane используется одна и та же базовая модель:

- read progression хранится как viewer-relative позиция на stable logical `message_id`;
- позиция включает `message_id`, `message_created_at` и `updated_at`;
- unread считается по opaque control-plane metadata, без знания plaintext body;
- authoritative ordering для mark/read использует `created_at` + `message_id`, а не client-only эвристики.

### 2. Серверу разрешается видеть только bounded control-plane metadata

Для encrypted unread/read серверу доступны только:

- `chat_id` / `group_id`;
- `user_id`;
- stable logical `message_id`;
- `created_at`, `stored_at`, `updated_at`;
- `revision` и `operation_kind`, если это уже часть encrypted storage model.

Серверу по-прежнему **не нужен**:

- plaintext content;
- plaintext preview;
- plaintext search fragment;
- server-side decrypted message projection.

### 3. Encrypted unread считается только по content operations

В unread foundation для encrypted lanes учитываются только logical message creations:

- `content` увеличивает viewer-relative unread, если сообщение пришло не от самого пользователя и новее его encrypted read position;
- `edit`, `tombstone`, `control` и аналогичные mutation/control-plane events не создают новый unread;
- для direct и group используется один и тот же принцип.

Это keeps the slice honest:

- unread не превращается в mutation counter;
- local projection и unread semantics не расходятся из-за edit/tombstone noise.

### 4. Для encrypted direct-message v2 вводится viewer-relative read state без plaintext fallback

Для direct encrypted lane:

- появляется отдельная durable таблица encrypted read state;
- `GetDirectChat` возвращает `encrypted_read_state` отдельно от legacy `read_state`;
- `DirectChat` получает отдельный `encrypted_unread_state`;
- появляется `MarkEncryptedDirectChatRead`;
- realtime `direct_chat.read.updated` может нести legacy и encrypted read/unread независимо друг от друга.

Peer visibility подчиняется тем же privacy rules, что и legacy read receipts:

- своя encrypted read position нужна всегда как основа unread;
- peer encrypted read position скрывается, если peer выключил read receipts.

### 5. Для encrypted group lane вводится отдельный viewer-relative read state

Для encrypted group path:

- появляется отдельная durable таблица encrypted group read state;
- `GetGroupChat` возвращает `encrypted_read_state` отдельно от legacy group `read_state`;
- `Group` получает отдельный `encrypted_unread_state`;
- появляется `MarkEncryptedGroupChatRead`;
- realtime `group.read.updated` может нести legacy и encrypted state независимо.

Encrypted group unread остаётся совместимым с текущей membership/policy model:

- unread считается viewer-relative, а не globally;
- `reader` и write-restricted участники всё ещё могут читать и очищать unread;
- серверу не нужен plaintext group body.

### 6. Delivery surfaces могут возвращать unread metadata, но не plaintext projection

Для device-scoped encrypted delivery разрешается возвращать только bounded unread metadata:

- viewer delivery может нести unread count текущего пользователя после сохранения сообщения;
- это помогает web shell обновлять список чатов/групп без отдельного plaintext snapshot fanout;
- unread metadata остаётся control-plane sematics и не раскрывает message body.

### 7. Web хранит legacy и encrypted unread/read раздельно

Web shell не притворяется единым perfect timeline model.

Вместо этого:

- direct/group list получает отдельные поля `unread_count` и `encrypted_unread_count`;
- direct/group snapshot получает отдельные `read_state` и `encrypted_read_state`;
- active encrypted lane может явно вызывать отдельный encrypted mark-as-read;
- encrypted delivery realtime обновляет encrypted unread без попытки собрать server-side plaintext preview;
- legacy plaintext lanes и encrypted lanes продолжают жить как честно раздельные slices.

### 8. Deterministic convergence остаётся bounded

Encrypted unread/read convergence строится так:

- storage fetch даёт server-backed unread/read snapshot;
- encrypted delivery realtime может дать новый unread count для viewer;
- отдельный encrypted mark-as-read продвигает read position вперёд;
- backward update не должен откатывать read position назад;
- local decrypted projection остаётся display-layer, а не source of truth для unread storage.

### 9. Honest boundary

Этот PR **решает только**:

- shared encrypted unread/read foundation;
- encrypted unread/read recovery для direct-message v2;
- encrypted unread/read recovery для group encrypted lane;
- bounded web/runtime integration для явного mark-as-read и unread indication.

Этот PR **не решает**:

- search parity;
- backup/recovery;
- RTC;
- full unified timeline redesign;
- full MLS client-state completeness;
- все encrypted media UX edge cases;
- push/PWA и contact verification UX.

## Последствия

### Положительные

- Encrypted direct и encrypted group lanes перестают выглядеть unread/read-broken.
- Сервер по-прежнему не строит plaintext projection для encrypted сообщений.
- Direct и group используют один и тот же control-plane подход к encrypted read progression.
- Realtime и storage convergence остаются тестируемыми и детерминированными.

### Отрицательные

- Появляется ещё один слой read state рядом с legacy plaintext read state.
- Web shell должен явно держать separate unread/read semantics для legacy и encrypted paths.
- Если encrypted target не попал в bounded local projection, UI не обязан симулировать полный parity.

### Ограничения

- Search parity для encrypted lanes всё ещё отсутствует.
- Backup/recovery не появляется.
- Unified merged history для legacy + encrypted не вводится.
- Viewer mark-as-read для encrypted lanes опирается на уже materialized logical message ids.

## Альтернативы

### 1. Вернуть server-side plaintext previews и decrypted projections ради unread/read

Не выбрано, потому что это ломает opaque boundary и превращает unread в повод вернуть скрытый plaintext shadow path.

### 2. Сделать две разные unread/read модели: одну для encrypted direct, другую для encrypted groups

Не выбрано, потому что это без нужды удваивает архитектурную стоимость и усложняет transport/web/runtime semantics.

### 3. Ждать сразу search parity, backup/recovery и full MLS completeness

Не выбрано, потому что это снова делает следующий slice слишком широким и задерживает восстановление базовой usable semantics для encrypted conversations.
