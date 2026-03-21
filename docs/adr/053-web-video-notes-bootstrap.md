# ADR-053: Web video notes bootstrap через существующий attachment upload flow

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-035`, `ADR-038`, `ADR-039`, `ADR-040`, `ADR-041`, `ADR-048`, `ADR-050`, `ADR-051` и `ADR-052`
в AeroChat уже существуют:

- first-class attachment entity и explicit upload/session lifecycle;
- web single-file attachment composer для direct chats и groups;
- attachment-only и `text + attachment` message semantics;
- bounded inline playback для `video/*` attachments;
- bounded web voice-notes recording через существующий attachment flow;
- conservative retention/quota foundation без нового media transport.

Но продуктовый gap остаётся явным:

- video notes заявлены как целевая capability, но web-клиент пока умеет только выбрать уже готовый video file;
- у пользователя нет встроенного camera capture flow внутри текущего composer path;
- существующий attachment contract уже достаточен для узкой real video-notes реализации без новых RPC;
- при этом нельзя расширять scope до media processing platform, editor UX, poster generation, transcoding или отдельного message kind.

Нужен следующий изолированный slice, который:

- остаётся web/UI-first;
- пишет короткую video note в браузере через стандартные browser media capture APIs;
- отправляет результат через уже существующий upload/send contract;
- переиспользует current attachment-only semantics и inline video playback;
- не превращает web-клиент в full camera/media-recording platform.

## Решение

### 1. Video note остаётся обычным video attachment message

На этом этапе video note не получает новый backend message kind, новый send RPC или отдельный transport layer.

Записанная заметка интерпретируется как обычный video attachment,
который может быть отправлен:

- как `attachment-only` сообщение;
- как `text + attachment` сообщение.

Message ownership, direct/group permission checks и existing realtime envelopes не меняются.

### 2. Capture flow остаётся bounded и page-scoped

`apps/web` получает минимальный recorder flow внутри текущего composer path:

1. запросить доступ к камере;
2. попытаться поднять `video + audio` capture;
3. если это не удалось, сделать одну консервативную попытку `video-only` capture;
4. начать запись;
5. остановить запись;
6. просмотреть локальный preview;
7. либо удалить запись;
8. либо отправить её через existing attachment flow.

Разрешается только один pending recorded video note на текущий composer scope.

Новый global media draft store, multi-record queue и editor surface не вводятся.

### 3. Для capture используются стандартные browser APIs

Web-клиент использует:

- `navigator.mediaDevices.getUserMedia(...)`;
- `MediaRecorder`.

Базовая capture policy остаётся консервативной:

- сначала запрашивается `video` вместе с `audio`;
- при невозможности полного `video + audio` capture допускается bounded fallback на `video-only`;
- MIME выбирается через явный `MediaRecorder.isTypeSupported(...)`;
- если явный MIME недоступен, используется default recorder config браузера;
- после stop итоговый `Blob` превращается в обычный `File` с явным именем и MIME.

Server-side transcoding, normalization и container conversion не добавляются.

### 4. Upload/send переиспользует уже существующий attachment contract

После локального review запись не отправляется отдельным media API.

Используется тот же flow, что и у обычного file attachment:

1. `CreateAttachmentUploadIntent`
2. browser upload в object storage по presigned URL
3. `CompleteAttachmentUpload`
4. `SendTextMessage` или `SendGroupTextMessage`

Video note становится ещё одним источником `File` для already existing single-file attachment composer,
а не отдельной upload subsystem.

### 5. Failure и permission states остаются bounded и не ломают composer

Если возникает одна из ситуаций:

- браузер не поддерживает `MediaRecorder`;
- нет `getUserMedia`;
- доступ к камере запрещён;
- доступ к микрофону запрещён или микрофон недоступен;
- запись не удалось сохранить;
- upload/send завершились ошибкой;

web обязан:

- показать явное bounded сообщение об ошибке;
- при доступном `video-only` capture продолжить flow без звука и явно сообщить об этом;
- дать удалить неудачную запись или повторить попытку;
- сохранить обычный text/file composer usable;
- не ломать current attachment failure semantics.

Если upload уже завершился, но send не удался,
дальше действует текущая single-file attachment recovery model.

### 6. Playback и review переиспользуют существующую video foundation

Во время recording web может показывать bounded live camera preview.

После stop пользователь получает локальный video review через стандартный browser player
без trimming/cropping/editor affordances.

Успешно отправленная video note рендерится как обычный `video/*` attachment
через уже существующий inline video preview из `ADR-051`.

Poster generation, thumbnails, duration badges и autoplay не вводятся.

### 7. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- новый backend message kind или upload RPC;
- camera/photo platform abstraction;
- video trimming/cropping;
- waveform/timeline UI;
- transcoding;
- poster/thumbnail pipeline;
- service worker media cache;
- streaming backend;
- autoplay behavior;
- отдельный video-note transport layer.

## Последствия

### Положительные

- Video notes становятся реально usable в web-клиенте без backend redesign.
- Existing attachment foundation получает следующий практический media slice.
- Direct chats и groups используют один и тот же bounded recording/send path.
- Сохраняется совместимость с будущим frontend redesign, потому что slice остаётся page-scoped и transport-neutral.

### Отрицательные

- Browser support зависит от availability `getUserMedia`, `MediaRecorder` и конкретного video MIME/container.
- UI остаётся intentionally minimal и не даёт richer camera/editor affordances.
- Локальная записанная заметка не переживает смену composer scope и не становится полноценной draft-recovery subsystem.

### Ограничения

- Нельзя считать этот slice полноценной camera/media-recording platform.
- Нельзя расширять этот PR до transcoding, poster/thumbnails, autoplay или backend media jobs.
- Нельзя добавлять новый message kind только ради video notes.
- Нельзя смешивать browser capture logic с отдельной storage/runtime redesign задачей.

## Альтернативы

### 1. Ввести отдельный backend RPC для video note upload/send

Не выбрано, потому что текущий attachment contract уже достаточен,
а новый RPC только раздул бы transport surface.

### 2. Оставить пользователю только file picker для заранее записанного видео

Не выбрано, потому что продуктовый gap именно в отсутствии встроенной записи внутри web composer.

### 3. Сразу делать poster generation, duration badges и richer media UX

Не выбрано, потому что это резко расширяет scope
и превращает узкий bootstrap slice в media platform initiative.
