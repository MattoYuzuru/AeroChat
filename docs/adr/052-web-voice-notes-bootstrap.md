# ADR-052: Web voice notes bootstrap через существующий attachment upload flow

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-035`, `ADR-038`, `ADR-039`, `ADR-040`, `ADR-041`, `ADR-048`, `ADR-050` и `ADR-051`
в AeroChat уже существуют:

- first-class attachment entity и explicit upload/session lifecycle;
- web single-file attachment composer для direct chats и groups;
- attachment-only и text + attachment message semantics;
- bounded inline playback для `audio/*` attachments;
- conservative retention/quota foundation без нового media transport.

Но продуктовый gap остаётся явным:

- voice notes заявлены как целевая capability, но web-клиент пока умеет только выбрать уже готовый audio file;
- у пользователя нет встроенного microphone capture flow внутри текущего composer path;
- существующий attachment contract уже достаточен для узкой real voice-notes реализации без новых RPC;
- при этом нельзя расширять scope до video capture, waveform pipeline, transcoding, audio effects или отдельного message kind.

Нужен следующий изолированный slice, который:

- остаётся web/UI-first;
- пишет короткую голосовую заметку в браузере через стандартные microphone APIs;
- отправляет результат через уже существующий upload/send contract;
- переиспользует current attachment-only semantics и inline audio playback;
- не превращает web-клиент в media recording platform.

## Решение

### 1. Voice note остаётся обычным audio attachment message

На этом этапе voice note не получает новый backend message kind, новый send RPC или отдельный transport layer.

Записанная заметка интерпретируется как обычный audio attachment,
который может быть отправлен:

- как `attachment-only` сообщение;
- как `text + attachment` сообщение.

Message ownership, direct/group permission checks и existing realtime envelopes не меняются.

### 2. Capture flow остаётся bounded и page-scoped

`apps/web` получает минимальный recorder flow внутри текущего composer path:

1. начать запись;
2. остановить запись;
3. прослушать локальный preview;
4. либо удалить запись;
5. либо отправить её через existing attachment flow.

Разрешается только один pending recorded voice note на текущий composer scope.

Новый global media draft store и multi-record queue не вводятся.

### 3. Для capture используются стандартные browser APIs

Web-клиент использует:

- `navigator.mediaDevices.getUserMedia({ audio: true })`;
- `MediaRecorder`.

MIME выбирается консервативно и явно:

- клиент пробует небольшой список audio MIME через `MediaRecorder.isTypeSupported`;
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

Voice note становится ещё одним источником `File` для already existing single-file attachment composer,
а не отдельной upload subsystem.

### 5. Failure и permission states остаются bounded и не ломают composer

Если возникает одна из ситуаций:

- браузер не поддерживает `MediaRecorder`;
- нет `getUserMedia`;
- доступ к микрофону запрещён;
- микрофон недоступен;
- запись не удалось сохранить;
- upload/send завершились ошибкой;

web обязан:

- показать явное bounded сообщение об ошибке;
- дать удалить неудачную запись или повторить попытку;
- сохранить обычный text/file composer usable;
- не ломать current attachment failure semantics.

Если upload уже завершился, но send не удался,
дальше действует текущая single-file attachment recovery model.

### 6. Inline playback переиспользуется без нового rendering slice

Успешно отправленная voice note рендерится как обычный `audio/*` attachment
через уже существующий inline audio preview из `ADR-051`.

Новый waveform, duration badge, transcript preview или voice-note-specific card layout не вводятся.

### 7. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- video notes;
- camera capture;
- waveform generation;
- audio trimming;
- gain/noise processing;
- transcoding;
- background upload queue;
- push-to-talk behavior;
- новый backend media processing pipeline;
- новый message kind или отдельный voice-note transport.

## Последствия

### Положительные

- Voice notes становятся реально usable в web-клиенте без backend redesign.
- Existing attachment foundation получает следующий практический media slice.
- Direct chats и groups используют один и тот же bounded recording/send path.
- Сохраняется совместимость с будущим frontend redesign, потому что slice остаётся page-scoped и transport-neutral.

### Отрицательные

- Browser support зависит от availability `getUserMedia`, `MediaRecorder` и конкретного audio MIME/container.
- UI остаётся intentionally minimal и не даёт richer recording affordances.
- Локальная записанная заметка не переживает смену composer scope и не становится полноценной draft-recovery subsystem.

### Ограничения

- Нельзя считать этот slice полноценной media recording platform.
- Нельзя расширять этот PR до video/camera, waveform, transcoding или backend media jobs.
- Нельзя добавлять новый message kind только ради voice notes.
- Нельзя смешивать browser capture logic с отдельной storage/runtime redesign задачей.

## Альтернативы

### 1. Ввести отдельный backend RPC для voice note upload/send

Не выбрано, потому что текущий attachment contract уже достаточен,
а новый RPC только раздул бы transport surface.

### 2. Оставить пользователю только file picker для заранее записанного аудио

Не выбрано, потому что продуктовый gap именно в отсутствии встроенной записи внутри web composer.

### 3. Сразу делать waveform, transcoding и voice-note-specific UX

Не выбрано, потому что это резко расширяет scope
и превращает узкий bootstrap slice в media platform initiative.
