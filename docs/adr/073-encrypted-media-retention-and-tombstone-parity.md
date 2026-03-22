# ADR-073: Encrypted media retention and tombstone parity

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-048`, `ADR-049`, `ADR-050`, `ADR-060`, `ADR-065`, `ADR-069` и `ADR-072`
в репозитории уже существуют:

- общий attachment lifecycle с состояниями `pending`, `uploaded`, `attached`, `detached`, `failed`, `expired`, `deleted`;
- cleanup и quota accounting, которые уже опираются только на relay-visible metadata, `status` и `object_key`;
- encrypted direct-message v2 и encrypted group lane с explicit `tombstone` mutation semantics;
- ciphertext-only encrypted media relay v1 и minimal linkage encrypted attachments к encrypted direct/group messages.

Но retention/delete parity для encrypted media оставалась неполной:

- plaintext direct tombstone уже переводил linked attachment из `attached` в `detached`;
- encrypted direct tombstone пока только скрывал content на клиенте, но не менял backend attachment lifecycle;
- encrypted group tombstone имел тот же gap;
- из-за этого ciphertext object мог бесконечно удерживать active quota и не попадать в detached cleanup path,
  хотя active encrypted history уже переставала его удерживать.

Нужен следующий узкий backend-first slice, который:

- вернёт retention parity для encrypted direct и encrypted group lanes;
- reuse'ит уже существующие `detached` semantics;
- не потребует plaintext media metadata;
- не расширит scope до backup/recovery, thumbnails, attachments-in-edits или RTC.

## Решение

### 1. Shared encrypted-media retention model reuse'ит существующий `detached`

Новый lifecycle status не вводится.

Для encrypted media фиксируется тот же retention transition, что уже существует для plaintext direct delete:

- attachment в `attached` удерживается только active visible history;
- когда explicit backend history-transition event делает encrypted media больше не удерживаемым active history,
  attachment переводится в `detached`;
- `detached` больше не удерживает active quota и позже попадает в уже существующий cleanup loop.

Таким образом encrypted media reuse'ит existing lifecycle foundation,
а не получает отдельную retention architecture.

### 2. Source of truth остаётся relay-visible и server-owned

Решение о retention transition принимается только по server-visible control-plane данным:

- `attachment_id`;
- `message_attachments` linkage;
- encrypted message `operation_kind`;
- `target_message_id`;
- lifecycle `status`;
- relay-visible `size_bytes` и `object_key`.

Сервер не читает:

- plaintext content;
- encrypted attachment descriptor;
- user-facing filename/MIME из ciphertext payload;
- client-local projection state.

### 3. Для encrypted direct lanes explicit history-transition event — tombstone

Для encrypted direct-message v2 в текущем репозитории активная media history меняется только через:

- `SendEncryptedDirectMessageV2(... operation_kind = tombstone ...)`

Если tombstone проходит валидацию и сохраняется,
backend в той же persistence-операции:

- записывает tombstone event;
- сохраняет доставки и control-plane metadata как раньше;
- переводит attachments, linked к target logical content message, из `attached` в `detached`.

Edit не меняет attachment retention,
потому что attachments-in-edits в этом этапе не поддерживаются.

### 4. Для encrypted group lanes применяется тот же принцип

Для encrypted group lane shared model не расходится с direct path.

`SendEncryptedGroupMessage(... operation_kind = tombstone ...)` теперь так же:

- сохраняет tombstone event;
- сохраняет group deliveries/control-plane metadata;
- переводит attachments target encrypted content message из `attached` в `detached`.

Тем самым group encrypted lane перестаёт отставать от direct encrypted lane в attachment retention semantics.

### 5. Cleanup и quota остаются без redesign

Этот PR не меняет базовые lifecycle/quota правила:

- quota по-прежнему считается по relay-visible `size_bytes`;
- `attached` продолжает удерживать active budget;
- `detached`, `expired`, `deleted` не удерживают active budget;
- object cleanup остаётся exact-key-driven и conservative;
- `RunAttachmentLifecycleCleanup` не делает bucket scan и не опирается на plaintext metadata.

Следовательно encrypted tombstone parity достигается не новым cleanup path,
а своевременным переходом `attached -> detached`.

### 6. Shared storage model не переизобретается

`ADR-065` остаётся неизменным:

- ciphertext-only object relay;
- relay metadata и encrypted descriptor split;
- один attachment lifecycle contract для direct и groups.

Этот slice добавляет только shared tombstone-triggered detachment для encrypted message linkage.

### 7. Honest boundary

Этот PR **решает только**:

- retention parity для encrypted direct tombstone media;
- retention parity для encrypted group tombstone media;
- reuse existing detached/quota/cleanup semantics без plaintext assumptions.

Этот PR **не решает**:

- backup/recovery;
- thumbnails/posters/transcoding/server preview;
- attachments-in-edits;
- media-content search expansion;
- full MLS client-state completeness;
- RTC;
- любую новую media management UI.

## Последствия

### Положительные

- Encrypted direct и encrypted group media перестают бесконечно удерживать active quota после tombstone.
- Shared cleanup path из `ADR-048/050` начинает честно работать и для encrypted lanes.
- Server по-прежнему не нуждается в plaintext media metadata или content.
- Direct и group сохраняют один общий relay/lifecycle contract.

### Отрицательные

- Retention semantics encrypted lanes становятся жёстко завязаны на explicit tombstone event как единственный текущий history-transition trigger.
- Историческая linkage row в `message_attachments` остаётся, поэтому lifecycle reasoning по-прежнему требует аккуратного state-based cleanup, а не “удалить связь и забыть”.

### Ограничения

- Нельзя называть этот slice полной encrypted media retention platform.
- Нельзя утверждать, что все исторические non-retention cases уже покрыты: сейчас покрыт explicit tombstone path.
- Нельзя расширять этот PR до attachments-in-edits, backup/recovery или media processing pipeline.

## Альтернативы

### 1. Ввести отдельный encrypted-only lifecycle status

Не выбрано, потому что существующий `detached` уже решает нужную retention семантику,
а новый status только раздвоил бы shared cleanup/quota model.

### 2. Оставить encrypted tombstone только client-side проекцией

Не выбрано, потому что тогда ciphertext object продолжал бы удерживать active quota и не попадал бы в detached cleanup semantics.

### 3. Делать detachment по client-local decrypt/render state

Не выбрано, потому что retention должен оставаться server-owned,
testable и основанным только на relay/control-plane metadata.
