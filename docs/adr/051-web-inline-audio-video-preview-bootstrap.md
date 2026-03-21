# ADR-051: Web inline audio/video preview bootstrap поверх существующего presigned attachment access

- Статус: Accepted
- Дата: 2026-03-21

## Контекст

После `ADR-035`, `ADR-038`, `ADR-039`, `ADR-040`, `ADR-041` и `ADR-050` в AeroChat уже существуют:

- attachment entity и attach-to-message model;
- direct-to-object-storage upload через presigned `PUT`;
- explicit `GetAttachment` flow с short-lived presigned download URL;
- polished file-card rendering для attachment messages;
- bounded inline image preview для `image/*`;
- attachment retention/delete semantics foundation после direct message tombstone.

Но у web-клиента остаётся подтверждённый UX gap:

- audio и video attachments по-прежнему выглядят как обычные file cards даже там, где пользователю нужен быстрый playback context;
- attachment-only audio/video messages уже поддерживаются доменно, но ещё не становятся продуктово удобными;
- текущий attachment contract уже достаточен для bounded inline playback без нового backend slice;
- при этом нельзя расширять scope до recording, transcoding, thumbnails, streaming backend или нового media proxy.

Нужен следующий узкий slice, который:

- остаётся web/UI-only как primary scope;
- добавляет inline playback только для `audio/*` и `video/*` attachments;
- использует уже существующий `GetAttachment` flow и short-lived presigned download URL;
- сохраняет текущий image preview path без изменения;
- сохраняет polished file-card fallback и явные `Открыть` / `Скачать` действия.

## Решение

### 1. Slice остаётся client-side display layer поверх текущего attachment contract

В этом ADR не меняются:

- attachment entity;
- upload lifecycle;
- `GetAttachment` RPC;
- media edge/runtime/deploy contract;
- gateway/chat ownership;
- message transport и existing message kinds.

Inline audio/video playback реализуется только в `apps/web`
как продолжение уже принятого attachment rendering path.

### 2. Inline playback разрешён только для MIME-confirmed `audio/*` и `video/*`

Preview/playback допускается только для attachment,
который на display layer консервативно классифицируется по MIME:

- `audio/*` -> inline audio player;
- `video/*` -> inline video player.

Следствия:

- filename и extension не считаются достаточным сигналом для inline playback;
- extension-based эвристики могут оставаться только для human-friendly labels;
- если MIME пустой, сомнительный или не audio/video-like,
  attachment остаётся обычной polished file card;
- preview policy не является security feature и не подменяет backend MIME validation.

### 3. URL для player source берётся только из существующего `GetAttachment` flow

Web не строит media URL самостоятельно.

Для inline player используется тот же access path:

1. attachment card решает, что MIME допускает bounded inline playback;
2. клиент лениво запрашивает `GetAttachment`;
3. получает short-lived presigned download URL;
4. использует этот URL как `audio src` или `video src`.

Новый backend method, proxy endpoint, binary relay через `aero-gateway`
или отдельный media access contract не вводятся.

### 4. Playback остаётся lazy, bounded и file-card-first

Inline playback не должен агрессивно prefetch'ить все media URLs в thread.

На этом этапе фиксируется:

- access URL запрашивается только когда attachment card реально доходит до viewport или близка к нему;
- inline player остаётся bounded по размерам и не ломает direct/group thread layout;
- autoplay не используется;
- стандартные browser controls достаточны;
- metadata file card и явные `Открыть` / `Скачать` CTA сохраняются.

Таким образом audio/video rendering остаётся file-card-first:
player только дополняет существующую безопасную карточку,
а не заменяет attachment access model.

### 5. Loading/error/fallback состояния обязательны

Для inline audio/video preview web обязан показывать:

- lazy placeholder до реального viewport trigger;
- loading state во время `GetAttachment`;
- bounded player после получения usable URL;
- понятный fallback, если `GetAttachment` не вернул usable URL,
  presigned URL истёк или browser playback не сработал.

При любой проблеме attachment остаётся в текущей safe модели:

- polished file card с metadata;
- явные кнопки `Открыть` и `Скачать`;
- без broken layout;
- без попытки обойти policy через filename trust.

### 6. Scope намеренно не расширяется до media processing subsystem

В этом ADR сознательно не реализуются:

- запись с микрофона или камеры;
- waveform generation;
- transcoding;
- poster/thumbnail pipeline;
- streaming backend;
- service worker media cache;
- gallery/explorer/files page;
- attachment-specific realtime events;
- новые message kinds;
- EXIF/media metadata extraction platform.

## Последствия

### Положительные

- Attachment-only и text + audio/video messages становятся продуктово usable без backend redesign.
- Existing presigned access model переиспользуется без contract drift.
- Current image preview и polished file-card path сохраняют совместимость.
- Web получает richer media UX, оставаясь в пределах уже принятого attachment foundation.

### Отрицательные

- Web получает дополнительный client-side path для lazy media URL resolution.
- Playback зависит от short-lived presigned URL и browser support конкретного MIME/container.
- Без poster/thumbnails исходные video files могут выглядеть менее polished, чем в полноценном media pipeline.

### Ограничения

- Нельзя считать этот slice recording/media processing platform.
- Нельзя использовать filename как source of truth для inline playback.
- Нельзя расширять решение до backend proxy/CDN, transcoding или storage/runtime changes.
- Нельзя подменять explicit open/download background-prefetch моделью для всей ленты.

## Альтернативы

### 1. Оставить audio/video attachments только как file cards

Не выбрано, потому что текущий attachment contract уже достаточен для узкого bounded playback UX,
а product gap можно закрыть на web-слое без backend redesign.

### 2. Сразу внедрить poster/thumbnails/transcoding pipeline

Не выбрано, потому что это резко расширяет scope до media processing,
новых runtime concerns и background jobs.

### 3. Делать preview через отдельный backend proxy endpoint

Не выбрано, потому что текущая model уже использует presigned download через `GetAttachment`,
и новый proxy path только расширил бы transport/runtime surface без необходимости.
