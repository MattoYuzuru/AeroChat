# ADR-072: Web encrypted group media send bootstrap

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-065`, `ADR-066` и `ADR-067`...`ADR-071` в репозитории уже существуют:

- ciphertext-only encrypted media relay v1 для direct encrypted lane и future group reuse;
- encrypted group control-plane с `mls_group_id`, `roster_version`, opaque storage path и device-aware realtime;
- web encrypted group runtime, local projection, outbound text send, replies/edits/tombstones/pins, unread/read и bounded local search;
- legacy plaintext group history, которая честно остаётся отдельной timeline;
- отсутствие реального send/use path для encrypted media внутри web encrypted group lane.

При этом важные ограничения уже зафиксированы:

- `ADR-065` не должен переизобретаться под groups;
- server-side preview, thumbnails, transcoding и media proxy не входят в scope;
- backup/recovery, full MLS client-state completeness, RTC и full legacy UX parity по-прежнему отсутствуют;
- encrypted search остаётся local-only по расшифрованному text и не обещает media-content search parity.

Нужен следующий узкий slice, который:

- даёт реальный encrypted group media send/use path на web;
- reuse'ит existing ciphertext-only relay и attachment lifecycle contract;
- не создаёт второй group-only media architecture;
- не притворяется полной parity со всем legacy attachment UX.

## Решение

### 1. Encrypted group media reuse'ит ADR-065 без redesign

Для encrypted group lane используется тот же media relay contract, что и для encrypted direct lane:

- upload идёт только как ciphertext blob;
- object storage и backend не получают plaintext file bytes;
- relay-visible metadata и encrypted attachment descriptor по-прежнему разделены;
- user-facing filename/MIME/plaintext size живут только внутри encrypted descriptor.

Group lane не получает отдельный storage path, отдельный media proxy или новый relay schema.

### 2. Web шифрует файл до upload и отправляет descriptor только внутри encrypted group payload

Flow фиксируется так:

1. `apps/web` выбирает файл внутри encrypted group lane.
2. Crypto runtime локально шифрует файл и готовит encrypted media draft.
3. Ciphertext blob загружается через уже существующий `CreateAttachmentUploadIntent` / presigned upload / `CompleteAttachmentUpload`.
4. `SendEncryptedGroupMessage` получает только `attachment_ids` для server-visible linkage control-plane.
5. Encrypted attachment descriptor встраивается только в encrypted group `content` payload.

Legacy plaintext `SendGroupTextMessage` для этого path не используется и plaintext shadow write не появляется.

### 3. Shared relay control-plane расширяется только linkage к encrypted messages

Чтобы участники группы могли получить ciphertext blob через уже существующий `GetAttachment`,
server должен видеть, что uploaded attachment стал `attached`, а не остался owner-only `uploaded`.

Для этого в shared relay control-plane допускается только минимальное расширение:

- encrypted direct/group send RPC получают `attachment_ids`;
- repository linkage переводит uploaded attachment в `attached`;
- attachment связывается с logical encrypted message id.

Это не новая media architecture, а минимальное продолжение уже существующего attachment lifecycle contract для reuse `ADR-065`.

### 4. Encrypted group payload поддерживает content с attachments и attachment-only сообщения

Web encrypted group codec теперь допускает:

- text-only content;
- text + encrypted attachments;
- attachment-only encrypted content.

При этом:

- edit остаётся text-only и не добавляет новые attachments;
- tombstone не несёт attachments;
- runtime явно отклоняет полностью пустой content без текста и без descriptor'ов.

### 5. Local decrypt/use path остаётся bounded и reuse'ит existing encrypted media primitives

После decrypt encrypted group payload web:

- сохраняет public attachment descriptors в local projection;
- получает ciphertext blob через уже существующий attachment access path;
- расшифровывает blob локально внутри crypto runtime;
- даёт bounded open/download/inline preview для file/image/audio/video там, где это уже поддерживает shared encrypted attachment list.

Этот slice не добавляет:

- server-side previews;
- transcoding;
- poster/thumbnails pipeline;
- giant media gallery;
- persistent decrypted media cache subsystem.

### 6. UI integration остаётся минимальной и только внутри текущей encrypted lane

`GroupsPage` получает только bounded additions:

- отдельный encrypted file picker внутри encrypted group composer;
- honest draft/upload/error states;
- send path для encrypted content message с media descriptor;
- local render/open/download через shared encrypted attachment list;
- honest ограничения для text-only edit и unsupported states.

`GroupsPage` не redesign'ится и не притворяется unified media composer поверх legacy plaintext timeline.

### 7. Coexistence и recovered semantics сохраняются

После этого PR:

- legacy plaintext group history остаётся как есть;
- encrypted group lane продолжает жить отдельно;
- replies/edits/tombstones/pins не теряются, потому что attachment descriptors живут внутри decrypted content projection;
- unread/read остаётся server-visible control-plane metadata и не зависит от media preview;
- local encrypted search продолжает индексировать только decrypted text.

Следовательно attachment-only encrypted media message без текста не становится searchable hit, и это должно оставаться явно задокументировано.

### 8. Honest boundary

Этот PR **решает только**:

- web encrypted group media send bootstrap;
- reuse shared encrypted media relay v1;
- minimal attachment linkage к encrypted direct/group messages;
- bounded local decrypt/use path для encrypted group media.

Этот PR **не решает**:

- backup/recovery;
- full MLS client-state completeness;
- RTC;
- full legacy attachment UX parity;
- server-side preview/thumbnails/transcoding;
- media-content search parity beyond locally decrypted text;
- push/PWA work.

## Последствия

### Положительные

- Encrypted group lane становится usable не только для text, но и для bounded media send/use.
- Direct и group действительно делят один ciphertext-only relay contract вместо двух архитектур.
- Existing attachment lifecycle/quota/retention foundation продолжает работать без нового media backend slice.
- Web reuse'ит уже готовые local decrypt/open/download primitives.

### Отрицательные

- Shared attachment control-plane получает ещё одну linkage surface для encrypted messages.
- UI groups временно остаётся mixed-mode: legacy plaintext media path и отдельный encrypted media path видимы рядом.
- Attachment-only encrypted media messages не дают search hit без текста.

### Ограничения

- Нельзя описывать этот PR как full encrypted group media parity.
- Нельзя обещать backup/recovery или exhaustive media UX.
- Нельзя расширять этот slice до preview pipeline, RTC или redesign всей group page.

## Альтернативы

### 1. Сделать отдельный group-only media relay path

Не выбрано, потому что это ломает `ADR-065`,
дублирует lifecycle/quota/retention architecture
и создаёт две несовместимые media модели для direct и groups.

### 2. Оставить attachment linkage только owner-visible и не переводить blob в `attached`

Не выбрано, потому что тогда group participants не смогли бы легально получить ciphertext blob через существующий attachment access path,
а encrypted media стало бы “отправленным”, но не usable.

### 3. Ждать полного MLS media parity и не делать bootstrap сейчас

Не выбрано, потому что это снова откладывает already-available shared relay foundation,
а узкий bootstrap slice уже даёт реальную ценность без media architecture redesign.
