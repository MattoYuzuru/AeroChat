# ADR-039: Attachment-only message semantics bootstrap поверх media foundation

- Статус: Accepted
- Дата: 2026-04-16

## Контекст

После `ADR-035`, `ADR-036`, `ADR-037` и `ADR-038` в AeroChat уже существуют:

- attachment entity и attach-to-message model внутри `aero-chat`;
- upload intent, presigned `PUT` upload и `CompleteAttachmentUpload`;
- private media storage с presigned download через `GetAttachment`;
- web single-file attachment composer для direct chats и groups;
- direct chat и group chat foundation с текущими permission rules;
- existing realtime message envelopes, уже несущие attachment metadata.

Но у продукта оставался подтверждённый gap:

- attachment можно было загрузить и прикрепить только к сообщению с непустым text;
- attachment-only user intent приходилось искусственно маскировать пустой подписью;
- composer и backend расходились с ожидаемой продуктовой семантикой “файл как самостоятельное сообщение”;
- при этом storage/runtime foundation уже был достаточным и не требовал нового media slice.

Нужен следующий узкий шаг:

- признать attachment полноценной message-семантикой;
- разрешить `text-only`, `text + attachment` и `attachment-only`;
- жёстко запретить полностью пустое сообщение;
- не менять deploy topology, media edge contract, MinIO runtime contract, bucket contract и presigned upload model;
- не раздувать scope до preview, thumbnails, transcoding, multi-file и cleanup jobs.

Также важно сохранить уже принятые инварианты:

- проект остаётся proto-first и gateway-only снаружи;
- `aero-chat` остаётся владельцем message и attachment lifecycle;
- `aero-gateway` остаётся thin proxy и не получает новый media transport;
- existing relationship/group role rules сохраняются без ослабления;
- single-file composer из `ADR-038` остаётся текущим intentional limitation.

## Решение

### 1. Message semantics расширяется эволюционно, без нового RPC

Существующие методы:

- `SendTextMessage`
- `SendGroupTextMessage`

сохраняются как единственная send surface для текущего slice.

Новый RPC, attachment-specific send method или transport redesign не вводятся.

Контракт эволюционирует семантически:

- `text-only` сообщение остаётся валидным;
- `text + attachment` сообщение остаётся валидным;
- `attachment-only` сообщение становится валидным;
- полностью пустое сообщение без text и без attachment жёстко отклоняется.

Attachment-only сообщение продолжает использовать тот же message envelope и тот же `MessageKind`,
а отсутствие text выражается пустым text input на send-path и отсутствующим `TextMessageContent` в выдаче message snapshot.

### 2. Empty message запрещён доменно

Сервер больше не требует непустой text сам по себе,
но требует meaningful content сообщения в целом.

Следствия:

- если после нормализации text пуст и `attachment_ids` пуст,
  send отклоняется как `invalid_argument`;
- если text пуст, но есть хотя бы один валидный uploaded attachment,
  сообщение считается допустимым;
- raw HTML policy и text length policy продолжают применяться только к непустому text payload.

Таким образом меняется именно message-level validation, а не attachment lifecycle.

### 3. Attachment lifecycle не меняет ownership и attach model

Attachment по-прежнему может быть прикреплён к сообщению только если он:

- принадлежит текущему автору;
- находится в status `uploaded`;
- соответствует scope чата или группы;
- ещё не связан с другим сообщением.

При успешной отправке attachment-only сообщения attachment:

- линкуется к новому message;
- переводится в status `attached`;
- получает `message_id` в рамках уже существующей linkage model.

Повторное прикрепление уже linked attachment не разрешается.

### 4. Permission policy не меняется

Для direct chats продолжают действовать уже принятые write rules:

- участник должен состоять в direct chat;
- friendship между участниками должна оставаться активной;
- block хотя бы в одну сторону запрещает send.

Для groups продолжают действовать уже принятые role rules:

- `owner`, `admin`, `member` могут писать;
- `reader` остаётся read-only и не может отправлять ни text message, ни attachment-only message;
- те же role rules применяются и к attachment upload intent.

### 5. Storage model остаётся прежней, кроме снятия group-specific text-only ограничения

Attachment-only message не требует новой message table,
нового attachment table и не требует redesign `message_attachments`.

Для direct messages существующая storage model уже допускает пустой `text_content`.

Для group messages снимается прежний SQL-level check, запрещавший blank `text_content`,
потому что он противоречил новой message semantics.

При этом:

- `text_content` не становится nullable;
- отсутствие текста интерпретируется на domain/projection layer как `nil TextMessageContent`;
- cross-table SQL constraint “text или attachment обязателен” не вводится в этом slice;
- source of truth для запрета empty message остаётся в domain validation.

Это сохраняет storage change narrow и не превращает задачу в schema redesign.

### 6. Gateway и realtime сохраняют совместимость

`aero-gateway` остаётся thin proxy:

- проксирует те же send methods;
- не вводит новый event type;
- не получает attachment-specific command slice.

Existing realtime envelopes:

- `direct_chat.message.updated`
- `group.message.updated`

остаются совместимыми.

Attachment-only message доставляется тем же message snapshot:

- `attachments` продолжают приходить как раньше;
- `text` может отсутствовать;
- клиенты должны корректно рендерить message bubble/card и при отсутствии text.

### 7. Web composer меняет только send eligibility

`apps/web` продолжает использовать уже существующий single-file attachment composer.

На этом этапе фиксируется:

- send button активен, если есть meaningful text или uploaded attachment;
- пока attachment ещё `preparing` или `uploading`, attachment-only send не уходит;
- после успешной отправки composer очищается и для `text + attachment`, и для `attachment-only`;
- если send mutation падает после успешного upload, uploaded attachment reference сохраняется recoverable в рамках текущего composer scope;
- `reader` в group UI по-прежнему не может отправлять сообщения.

### 8. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- multi-file composer;
- preview, thumbnails и transcoding;
- image/audio/video special rendering;
- cleanup jobs и orphan lifecycle automation;
- новый media infra/runtime slice;
- attachment-specific realtime events;
- richer message kind taxonomy;
- cross-page draft recovery subsystem beyond current single-scope restore.

## Последствия

### Положительные

- Media foundation становится продуктово полезнее без нового storage/runtime redesign.
- Пользователь получает естественную семантику “отправить файл как самостоятельное сообщение”.
- Existing send RPC и realtime envelopes продолжают работать без surface area inflation.
- Single-file composer из `ADR-038` получает более завершённый смысл без перехода в full media overhaul.

### Отрицательные

- Message rows продолжают использовать `MessageKindText`, хотя теперь text payload может отсутствовать.
- Запрет empty message остаётся domain-level правилом, а не полноценно выраженной cross-table SQL-инвариантой.
- UI по-прежнему ограничен single-file и minimal rendering без preview-polish.

### Ограничения

- Нельзя трактовать этот slice как multi-attachment или media preview pipeline.
- Нельзя менять upload contract, media edge contract, MinIO runtime contract и presigned upload model.
- Нельзя считать текущий single-file composer окончательным UX.
- Нельзя расширять этот PR до cleanup jobs, transcoding, thumbnails или attachment storage redesign.

## Альтернативы

### 1. Ввести новые RPC `SendAttachmentMessage` и `SendGroupAttachmentMessage`

Не выбрано, потому что текущие send methods уже имеют `attachment_ids`,
а новый RPC только раздул бы transport surface без реальной архитектурной пользы.

### 2. Сохранить text mandatory и заставлять клиента добавлять placeholder подпись

Не выбрано, потому что это оставляет product gap нерешённым,
делает message semantics неестественной и приводит к ложному text payload.

### 3. Делать полноценный redesign message content model вместе с несколькими attachment kind

Не выбрано, потому что это резко расширяет scope,
смешивает текущий узкий slice с будущими media/product решениями
и не нужно для attachment-only bootstrap.
