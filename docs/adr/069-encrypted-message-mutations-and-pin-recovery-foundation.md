# ADR-069: Encrypted message mutations and pin recovery foundation

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-060`...`ADR-068` в репозитории уже существуют:

- encrypted direct-message v2 intake/storage/realtime path с opaque envelopes и per-device deliveries;
- encrypted media relay v1 для direct encrypted lane;
- encrypted group control-plane/storage foundation и web local/outbound bootstrap;
- отдельные web local projection paths для encrypted direct и encrypted group lanes;
- честная граница coexistence с legacy plaintext direct/group history.

При этом encrypted lanes всё ещё отставали от минимально usable message semantics:

- reply reference отсутствовал в recoverable encrypted виде;
- edit semantics нельзя было восстановить без возврата к plaintext in-place update;
- delete-for-everyone для encrypted lanes не был оформлен как явная mutation model;
- pin/unpin оставался legacy plaintext-only механизмом;
- сервер не должен был получать plaintext quoted preview, plaintext edit body или search fragment.

Нужен следующий узкий slice, который восстановит базовые mutation semantics для encrypted direct-message v2 и encrypted group lane, но не будет притворяться полным parity-complete E2EE-мессенджером.

## Решение

### 1. Вводится общая encrypted mutation model

Для encrypted direct-message v2 и encrypted group lane фиксируется одна и та же базовая модель:

- `content` создаёт новый logical message;
- `reply` не является отдельным server-visible видом операции и живёт как `content`/`edit` payload с `reply_to_message_id` внутри ciphertext;
- `edit` публикуется как отдельное encrypted revision event;
- `tombstone` публикуется как отдельное encrypted delete-for-everyone event;
- `pin` / `unpin` остаётся server-visible control-plane metadata по stable logical message id.

Это deliberately small foundation:

- без браузера истории ревизий;
- без full undo/restore semantics;
- без unread/search/backup parity.

### 2. Разделение между ciphertext, control-plane metadata и local projection фиксируется явно

В ciphertext payload хранятся:

- `operation` payload-level (`content`, `edit`, `tombstone`);
- `reply_to_message_id` для `content` и `edit`;
- renderable message body;
- encrypted attachment descriptors там, где они уже поддерживаются;
- `edited_at` или `deleted_at`, когда это нужно для честного client render.

Серверу остаётся видим только bounded control-plane metadata:

- `message_id`;
- `chat_id` / `group_id` и thread/group routing metadata;
- `sender_crypto_device_id`;
- `operation_kind`;
- `target_message_id` для `edit` и `tombstone`;
- `revision`;
- timestamps хранения и доставки;
- pin/unpin state как отдельная control-plane ссылка на logical message id.

Local projection на клиенте отвечает за:

- связывание mutation event с target logical message;
- deterministic revision convergence;
- client-side reply preview после decrypt;
- tombstone rendering;
- pin rendering, если target уже materialized локально.

### 3. Reply semantics восстанавливаются только client-side

Для encrypted reply reference сервер больше не строит plaintext preview.

Вместо этого:

- reply link передаётся как `reply_to_message_id` внутри encrypted payload;
- stable logical target id сохраняется через `message_id`;
- UI строит quoted preview только после decrypt и только из локально доступной projection;
- если target ещё не попал в bounded local window, UI честно показывает, что reply target пока недоступен;
- если target уже tombstoned, UI честно показывает tombstone-состояние, а не устаревший plaintext preview.

### 4. Edit semantics переводятся на encrypted revisions

Encrypted edit больше не означает server-side in-place plaintext update.

Вместо этого:

- edit отправляется как новый encrypted event;
- server-visible metadata содержит `target_message_id` и `revision`;
- logical identity исходного сообщения остаётся стабильной;
- local projection выбирает newest visible revision детерминированно;
- storage и realtime остаются opaque, без plaintext shadow path.

Этот slice не вводит полноценный history browser и не обещает browseable immutable revision log в UI.

### 5. Tombstone semantics фиксируются как control-plane delete event, а не “криптографическое стирание”

Delete-for-everyone для encrypted lanes трактуется честно:

- публикуется отдельный `tombstone` event на stable logical target id;
- сервер хранит control-plane факт удаления и не заявляет “магическое” стирание уже доставленного plaintext на старых устройствах;
- клиентская projection переводит target message в tombstoned state;
- UI больше не показывает body/attachments этого logical message в active projection;
- pin может пережить tombstone как ссылка на тот же logical id, но UI обязан честно показать, что pinned message теперь tombstoned.

### 6. Pins восстанавливаются как отдельная encrypted-compatible control-plane семантика

Pin/unpin не переносится внутрь ciphertext.

Выбрана минимальная и reusable модель:

- сервер хранит encrypted-specific pin sets отдельно от legacy plaintext pin sets;
- pin ссылается только на stable logical message id;
- для pin/unpin серверу не нужен plaintext body;
- direct и group encrypted lanes используют один и тот же принцип server-visible control-plane pin reference;
- UI рендерит pinned content только если target уже локально materialized;
- если target ещё не разрешён локально, UI честно показывает server-backed pin без содержимого.

### 7. Web local projection получает bounded convergence rules

Для encrypted direct и encrypted group projection применяются одинаковые базовые правила:

- `content` materializes message entry;
- `edit` обновляет target entry только при наличии target в текущем bounded окне;
- `tombstone` переводит target entry в deleted state;
- missing target даёт explicit local failure entry, а не скрытую догадку;
- `reply_to_message_id` хранится в projected entry и используется только client-side.

Это keeps the slice narrow:

- не вводится fake client-only truth;
- authoritative convergence остаётся через storage fetch + realtime;
- legacy plaintext timeline не merge'ится магически с encrypted lane.

### 8. Coexistence с legacy plaintext lanes остаётся явной

После этого PR:

- legacy plaintext direct/group history не меняется;
- encrypted lanes получают reply/edit/tombstone/pin independently;
- UI может показывать legacy plaintext и encrypted lane рядом, но не притворяется единым “идеальным” timeline;
- pin state для legacy plaintext и encrypted lanes хранится раздельно.

### 9. Honest boundary

Этот PR **решает только**:

- shared encrypted mutation foundation;
- reply/edit/tombstone recovery для encrypted direct-message v2 и encrypted group lane;
- encrypted-compatible pin/unpin control-plane foundation;
- bounded web local projection integration.

Этот PR **не решает**:

- unread/read parity;
- search parity;
- backup/recovery;
- full MLS client-state completeness;
- encrypted media parity для всех group сценариев;
- RTC;
- push/PWA;
- contact verification UX.

## Последствия

### Положительные

- Encrypted direct и encrypted group lanes перестают быть только text-send/fetch foundation и получают базовые mutation semantics.
- Сервер остаётся opaque к plaintext quoted preview и edit body.
- Pin/unpin снова становится usable для encrypted conversations без возврата к plaintext projections.
- Local projection rules становятся детерминированными и тестируемыми.

### Отрицательные

- Web получает дополнительный bounded state для encrypted reply/edit UI.
- Encrypted pins пока не имеют отдельного realtime event и в этом slice сходятся через server-backed fetch/RPC response.
- Missing target в bounded окне остаётся честным UX degradation, а не “полным parity”.

### Ограничения

- Reply preview существует только при наличии target в локальной projection.
- Edit не открывает полноценный revision browser.
- Tombstone не является криптографическим стиранием уже раскрытого контента.
- Search и unread semantics для encrypted lanes по-прежнему отсутствуют.

## Альтернативы

### 1. Вернуть server-side plaintext reply preview и edit projection

Не выбрано, потому что это ломает opaque storage boundary и создаёт ложное ощущение E2EE parity за счёт скрытого plaintext shadow path.

### 2. Сделать две разные mutation модели: одну для direct, другую для groups

Не выбрано, потому что это увеличивает архитектурную стоимость без реальной пользы и усложняет reuse local projection/runtime semantics.

### 3. Дождаться полного unread/search/backup parity и только потом возвращать replies/edit/delete/pin

Не выбрано, потому что это снова превратило бы узкий slice в слишком широкий PR и задержало бы recovery минимально usable encrypted conversations.
