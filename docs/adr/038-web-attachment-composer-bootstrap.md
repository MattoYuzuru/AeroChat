# ADR-038: Web attachment composer bootstrap для direct и group chat flows

- Статус: Accepted
- Дата: 2026-04-15

## Контекст

После `ADR-015`, `ADR-016`, `ADR-031`, `ADR-033`, `ADR-034`, `ADR-035`, `ADR-036` и `ADR-037` в AeroChat уже существуют:

- web direct chat flow через `aero-gateway`;
- web group chat flow через `aero-gateway`;
- attachment entity, upload intent и attach-to-message model;
- private S3-compatible media storage с direct-to-object-storage upload;
- message payloads, уже умеющие нести attachment metadata;
- bounded realtime foundation для обычных `message.updated` событий.

Но для пользователя media foundation всё ещё оставалась почти недоступной:

- в web composer не было file picker и upload progress;
- direct и group flows не умели довести файл до состояния "готов прикрепить к сообщению";
- уже прикреплённые файлы не рендерились в thread;
- private bucket требовал presigned download URL, но текущий `GetAttachment` возвращал только metadata.

Нужен следующий узкий slice:

- сделать attachment upload реально usable в direct chats и groups;
- не менять storage/runtime foundation;
- не превращать `aero-gateway` в binary proxy;
- не добавлять preview, multi-file batches, resumable upload, drag-and-drop polish или cleanup jobs;
- сохранить gateway-only web архитектуру и текущие reducer/hook patterns.

Также важно сохранить уже принятые ограничения:

- attachment-only messages не поддерживаются, пока backend требует непустой текст;
- media download остаётся presigned-only поверх private bucket;
- attachment lifecycle не размывается по страницам и не уходит в новый global store;
- существующие `message.updated` события продолжают быть единственным live transport для message-level UI.

## Решение

### 1. Web остаётся на существующем attachment contract

Для direct и group chat composer используется уже существующий backend flow:

1. `CreateAttachmentUploadIntent`
2. browser `PUT` в object storage по presigned URL
3. `CompleteAttachmentUpload`
4. `SendTextMessage` или `SendGroupTextMessage` с `attachment_ids`

Новый отдельный upload transport или gateway binary relay не вводятся.

### 2. Минимальный contract gap закрывается через `GetAttachment`

Для user-facing download/open flow текущего контракта metadata было недостаточно,
потому что bucket остаётся private и доступен только через presigned URL.

Поэтому `GetAttachment` минимально расширяется:

- продолжает возвращать attachment metadata;
- дополнительно возвращает short-lived presigned download URL;
- не превращается в новый download proxy API;
- не ломает attach-to-message model.

Это считается допустимым минимальным proto-gap,
потому что без него web не может корректно открыть уже отправленный файл.

### 3. Web composer state выносится в отдельный узкий модуль

В `apps/web` вводится отдельный attachment composer module,
который инкапсулирует:

- локальный single-file draft state;
- стадии `preparing` / `uploading` / `uploaded` / `error`;
- upload progress;
- retry/remove semantics;
- XHR-based upload cancel;
- восстановление уже загруженного attachment reference из `sessionStorage` для того же chat/group scope.

Этот модуль остаётся page-scoped.
Новый global state framework не вводится.

### 4. Scope намеренно остаётся single-file

На этом bootstrap-этапе web composer поддерживает только одно pending attachment на сообщение.

Причины:

- PR остаётся reviewable;
- reducer и UX не разрастаются в multi-file batch manager;
- retry/remove semantics остаются явными;
- продукт получает рабочий upload flow без drag-and-drop и batch complexity.

Если пользователь выбирает новый файл, текущий local draft может быть заменён.

### 5. Текст остаётся обязательным и это явно видно в UX

Пока backend `normalizeMessageText` требует непустой текст:

- composer не вводит attachment-only send semantics;
- UI явно подсказывает, что файл прикрепляется к обычному текстовому сообщению;
- send button остаётся disabled при пустом тексте;
- при попытке отправки без текста показывается явное сообщение о контрактном ограничении.

Frontend здесь адаптируется к существующему domain contract,
а не invent'ит новую message semantics.

### 6. Upload failure и send failure различаются явно

Для local composer фиксируется разная политика:

- если upload failed, draft остаётся в bounded error state и допускает retry;
- если send failed после успешного upload, уже загруженный attachment reference не теряется;
- draft очищается только после успешного send;
- user может вручную убрать draft перед отправкой.

Это нужно, чтобы не терять уже загруженный attachment ID из-за последнего шага send mutation.

### 7. Message rendering остаётся минимальным и безопасным

В direct и group threads attachment rendering показывает только:

- file name;
- size;
- MIME/type label;
- кнопку безопасного открытия файла через `GetAttachment`.

Не реализуются:

- inline image preview;
- thumbnails;
- gallery;
- audio/video player;
- HTML/markdown mixing сверх уже существующего safe subset.

### 8. Existing realtime message updates получают attachment metadata "по пути"

Новый attachment-specific realtime event type не вводится.

Но существующие `direct_chat.message.updated` и `group.message.updated`
начинают нести attachment metadata в том же message snapshot,
чтобы live message delivery не теряла уже прикреплённые файлы.

Это не считается расширением realtime platform,
а только доведением уже существующего message payload до полноты.

### 9. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- image/video/audio preview;
- multi-attachment batches;
- drag-and-drop polish;
- paste upload;
- resumable upload;
- virus scanning;
- cleanup/orphan jobs;
- attachment-only messages;
- отдельные attachment-specific realtime events;
- explorer/gallery/files page.

## Последствия

### Положительные

- Direct chats и groups получают первый реально usable attachment upload flow.
- Web переиспользует уже принятый media foundation без redesign backend/runtime.
- Upload lifecycle перестаёт быть размазанным по страницам и живёт в одном узком module.
- Send failure больше не теряет уже загруженный attachment reference.
- Message rendering становится достаточным для alpha-safe file exchange.

### Отрицательные

- `GetAttachment` получает минимальное расширение ради presigned download URL.
- Пока поддерживается только single-file composer draft.
- После reload нельзя восстановить неуспешный локальный upload,
  если сам файл ещё не дошёл до `uploaded` состояния.

### Ограничения

- Нельзя считать этот slice реализацией preview/media-processing pipeline.
- Нельзя считать attachment download новым public CDN path.
- Нельзя расширять этот шаг до multi-file UX, resumable upload или retention engine.
- Нельзя трактовать `sessionStorage` restore как полноценный draft recovery subsystem.

## Альтернативы

### 1. Вообще не менять proto и строить download link на клиенте

Не выбрано, потому что private bucket и presigned-only access model не позволяют web безопасно построить корректный download URL только из текущей metadata.

### 2. Сразу сделать multi-file composer

Не выбрано, потому что это резко расширяет reducer/UI scope и затрудняет review первого attachment UX slice.

### 3. Проксировать attachment download через `aero-gateway`

Не выбрано, потому что это ломает уже принятый direct-to-object-storage contract и делает gateway binary path.
