# ADR-065: Encrypted media relay v1 для direct chats и будущих group E2EE

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-035`, `ADR-048`, `ADR-049`, `ADR-050`, `ADR-055` и `ADR-060` through `ADR-064`
в репозитории уже существуют:

- attachment entity, presigned upload/download, lifecycle, quotas и retention;
- encrypted direct-message v2 storage, device-aware delivery, local projection и outbound send;
- web crypto/runtime boundary с worker-driven decrypt/send path;
- явное архитектурное требование из `ADR-055`, что encrypted media должно reuse existing presigned relay flow,
  но перестать опираться на plaintext-visible media assumptions.

Одновременно media path всё ещё оставался незавершённым с точки зрения E2EE:

- объект в object storage до этого момента мог быть plaintext payload;
- attachment metadata в server-visible contract оставалась plaintext-oriented для filename/MIME/display;
- encrypted direct-message v2 lane сознательно не умела нести usable attachment descriptor;
- будущая group E2EE direction рисковала получить второй, несовместимый media contract,
  если direct encrypted media будет спроектировано ad hoc.

Нужен следующий изолированный backend-first slice, который:

- сохраняет текущий presigned direct-to-object-storage flow;
- переводит encrypted media на ciphertext-only blob relay;
- жёстко отделяет relay metadata от encrypted display descriptor;
- делает encrypted media реально usable в direct encrypted lane уже сейчас;
- оставляет storage/lifecycle model общей для direct и будущих groups;
- не притворяется MLS/group encrypted messaging, thumbnail pipeline, media proxy или full legacy parity.

## Решение

### 1. Presigned relay flow сохраняется, но только как ciphertext relay для encrypted media v1

Для encrypted media v1 сохраняется тот же flow shape:

1. `CreateAttachmentUploadIntent`
2. browser `PUT` в object storage по presigned URL
3. `CompleteAttachmentUpload`
4. `GetAttachment` / presigned download access

Но для encrypted media v1 меняется содержимое объекта:

- upload в object storage идёт только как ciphertext blob;
- download из object storage возвращает только ciphertext blob;
- сервер и object storage не получают plaintext file bytes;
- browser/client шифрует файл до upload и расшифровывает blob после download локально.

`aero-gateway` и `aero-chat` не становятся binary proxy.

### 2. В attachment entity вводится relay-visible schema

Attachment entity получает явный `relay_schema`.

На текущем этапе фиксируются две схемы:

- `legacy_plaintext`
- `encrypted_blob_v1`

`legacy_plaintext` сохраняется только как explicit compatibility state для уже существующего attachment foundation.
Новый encrypted media slice не объявляет legacy path безопасным и не расширяет его продуктовые claims.

`encrypted_blob_v1` означает:

- object storage содержит только ciphertext blob;
- `size_bytes` считается ciphertext-visible размером;
- server-visible `file_name` и `mime_type` относятся только к relay object metadata,
  а не к user-facing display metadata.

### 3. Relay metadata и encrypted descriptor разделяются жёстко

#### Server-visible relay metadata

Серверу разрешено знать только operational минимум:

- `attachment_id`;
- scope и ownership;
- linkage к message history;
- lifecycle status;
- `bucket/object_key`;
- ciphertext-visible `size_bytes`;
- `relay_schema`.

Эти поля остаются достаточными для:

- quota admission;
- cleanup;
- retention;
- authorization;
- direct/group reuse одного storage contract.

#### Encrypted attachment descriptor

User-facing display metadata и decrypt material переносятся в encrypted descriptor,
который передаётся только внутри encrypted message payload.

Для `encrypted_blob_v1` descriptor содержит:

- `attachment_id`;
- descriptor schema/version;
- исходное имя файла;
- display MIME type;
- plaintext size;
- symmetric content key;
- IV/nonce;
- ciphertext size как consistency hint.

Сервер не должен делать этот descriptor source of truth для lifecycle
и не должен читать его как обычную metadata модель.

### 4. Direct encrypted media отправляется через существующий encrypted DM v2 path

Encrypted media v1 не получает отдельный message transport.

Для direct chats flow такой:

1. Web crypto runtime локально шифрует файл.
2. Ciphertext blob загружается через обычный attachment upload intent c `relay_schema = encrypted_blob_v1`.
3. После успешного upload worker/runtime встраивает encrypted attachment descriptor в encrypted DM v2 payload.
4. `SendEncryptedDirectMessageV2` продолжает хранить только opaque per-device deliveries.
5. Получатель локально расшифровывает payload, достаёт descriptor, затем отдельно получает ciphertext blob через `GetAttachment` и расшифровывает его локально.

Таким образом attachment reference становится реальной частью encrypted direct-message lane,
а не документированным “позже сделаем”.

### 5. Web runtime boundary остаётся явной

Для encrypted media v1 фиксируется bounded runtime contract:

- encrypt-before-upload делается client-side;
- decrypt-after-download делается client-side;
- file keys не должны становиться частью server-visible API;
- file keys не должны уходить в обычный persistent UI store;
- bounded local runtime/cache для decrypted projection и later media decrypt допустим.

Это не означает завершённый media cache subsystem, backup или offline recovery.

### 6. Lifecycle, quota и retention продолжают опираться на relay metadata

Encrypted media v1 не вводит новую competing storage accounting system.

Текущие lifecycle/quota/retention semantics сохраняются:

- quota считается по `attachments.size_bytes`, то есть по ciphertext-visible bytes;
- `pending`, `uploaded`, `attached`, `failed` продолжают удерживать active quota;
- `detached`, `expired`, `deleted` не удерживают active quota;
- cleanup и delete semantics продолжают опираться только на backend state и exact `object_key`;
- `detached` / `expired` / `deleted` по-прежнему относятся к ciphertext object lifecycle,
  а не к plaintext visibility.

### 7. Модель storage relay специально делается reusable для будущих groups

Encrypted media relay v1 не должен стать direct-only media architecture.

Поэтому фиксируется:

- attachment entity и relay lifecycle остаются общими для direct и group scopes;
- descriptor не содержит direct-only assumptions;
- будущая group encrypted message lane должна уметь ссылаться на тот же `attachment_id` + ciphertext relay model;
- group E2EE позже меняет только message crypto transport, а не attachment storage foundation.

### 8. Honest boundary

Этот slice **решает только**:

- ciphertext-only encrypted media relay v1;
- descriptor split;
- usable encrypted direct media send/fetch/decrypt path;
- future-ready reuse того же relay model для group E2EE.

Этот slice **не решает**:

- MLS;
- encrypted group messages;
- encrypted group media UX;
- thumbnails/posters/transcoding;
- server-side preview pipeline;
- gateway binary proxy;
- encrypted media search;
- backup/recovery;
- full reply/edit/unread parity для encrypted conversations;
- legacy attachment UX migration to fully encrypted semantics.

## Последствия

### Положительные

- Encrypted media перестаёт быть только архитектурным намерением и становится реальным working path.
- Existing attachment lifecycle/quota/retention foundation reuse’ится без нового storage platform slice.
- Сервер больше не нуждается в plaintext media bytes для encrypted lane.
- Direct encrypted media и future group encrypted media получают общую relay foundation.

### Отрицательные

- В web runtime появляется дополнительный bounded local media decrypt path.
- Attachment contract становится двухрежимным: `legacy_plaintext` и `encrypted_blob_v1`.
- Legacy attachment UX не получает автоматическую encrypted parity в этом PR.

### Ограничения

- Нельзя трактовать `encrypted_blob_v1` как завершённую media platform.
- Нельзя делать server-visible plaintext metadata “для удобства preview”.
- Нельзя расширять этот slice до MLS/group messaging, media proxy или preview pipeline.
- Нельзя считать current bounded web decrypt path равным backup/cache/recovery subsystem.

## Альтернативы

### 1. Сделать новый gateway media proxy

Не выбрано, потому что это ломает уже принятый presigned direct-to-object-storage contract
и расширяет scope до binary transport redesign.

### 2. Сохранить plaintext media object, а descriptor шифровать отдельно

Не выбрано, потому что это оставляет главный confidentiality gap нерешённым:
storage по-прежнему видит plaintext file bytes.

### 3. Спроектировать отдельный encrypted media contract только для direct chats

Не выбрано, потому что тогда будущая group E2EE получила бы вторую media architecture
и later forced redesign storage/lifecycle layer.
