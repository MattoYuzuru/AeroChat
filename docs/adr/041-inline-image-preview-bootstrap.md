# ADR-041: Web inline image preview bootstrap поверх существующего presigned attachment access

- Статус: Accepted
- Дата: 2026-04-18

## Контекст

После `ADR-035`, `ADR-036`, `ADR-037`, `ADR-038`, `ADR-039` и `ADR-040` в AeroChat уже существуют:

- attachment entity и attach-to-message model;
- direct-to-object-storage upload через presigned `PUT`;
- explicit `GetAttachment` flow с short-lived presigned download URL;
- single-file attachment composer для direct chats и groups;
- polished file-card rendering для attachment messages;
- attachment-only message semantics;
- отсутствие preview/thumbnails/transcoding pipeline как сознательное ограничение.

Но после `ADR-040` у продукта остаётся узкий UX gap:

- image attachments по-прежнему выглядят как обычные file cards даже там, где пользователю нужен быстрый визуальный контекст;
- attachment-only image message и text + image message читаются хуже, чем должны;
- direct chats и groups уже имеют достаточный message/attachment foundation, чтобы показать bounded inline preview без нового backend slice;
- при этом storage/runtime/deploy contract, media edge contract и presigned-only access model менять нельзя без крайней необходимости.

Нужен следующий узкий slice, который:

- остаётся web/UI-only как primary scope;
- добавляет inline preview только для `image/*` attachments;
- использует уже существующий `GetAttachment` flow и short-lived presigned download URL;
- не вводит thumbnails, transcoding, service worker, новый client cache framework и media processing pipeline;
- сохраняет текущий polished file-card rendering для non-image attachments без деградации.

## Решение

### 1. Slice остаётся client-side display layer поверх текущего attachment contract

В этом ADR не меняются:

- attachment entity;
- upload lifecycle;
- `GetAttachment` RPC;
- media edge/runtime/deploy contract;
- gateway/chat ownership.

Inline preview реализуется только в `apps/web` как display-oriented слой поверх уже существующего access path.

### 2. Preview разрешён только для image attachments и определяется консервативно

Inline preview допускается только для attachment, который на display layer классифицируется как image по MIME.

Следствия:

- filename сам по себе не считается достаточным сигналом для preview;
- extension-based heuristics могут оставаться только для human-friendly labels, но не для решения preview/not-preview;
- если MIME пустой, сомнительный или не image-like, attachment остаётся обычной file card;
- preview policy не является security feature и не подменяет backend MIME validation.

### 3. URL для preview берётся из существующего `GetAttachment` flow

Web не строит preview URL самостоятельно.

Для inline preview используется тот же access path:

1. клиент решает, что конкретная image card может показать preview;
2. запрашивает `GetAttachment`;
3. получает short-lived presigned download URL;
4. использует этот URL как `img src`.

Новый backend method, отдельный preview endpoint, binary proxy через `aero-gateway` или новый media origin contract не вводятся.

### 4. Preview остаётся lazy и bounded

Preview не должен агрессивно prefetch'ить все изображения в thread.

На этом этапе фиксируется:

- preview URL запрашивается только когда image card реально доходит до viewport или близка к нему;
- service worker не используется;
- новый client cache/storage framework не вводится;
- browser `img` loading остаётся обычным bounded inline rendering, а не background gallery prefetch.

Это сохраняет уже принятую explicit/presigned access model и не превращает thread в bulk media downloader.

### 5. UX остаётся file-card first с inline image block

Image attachment внутри сообщения рендерится как обычная attachment card, дополненная bounded inline image block.

Правила:

- preview показывается внутри message bubble/card;
- dimensions ограничены и не ломают layout direct/group threads;
- изображение рендерится через safe `object-fit` strategy;
- есть явные loading/error/fallback состояния;
- click по preview использует тот же explicit open flow, что и существующая кнопка `Открыть`;
- кнопка `Скачать` и metadata file card сохраняются.

Таким образом preview улучшает читаемость image messages, но не подменяет существующий explicit file access UX.

### 6. Fallback на обычную attachment card обязателен

Если происходит любая проблема:

- `GetAttachment` не вернул usable download URL;
- presigned URL истёк или не загрузился;
- browser не смог декодировать изображение;
- MIME не прошёл preview policy;

web обязан остаться в текущей safe модели:

- attachment card с metadata и `Открыть` / `Скачать`;
- без raw HTML;
- без broken layout;
- без попытки "додумать" preview через filename trust или иные обходы.

### 7. Scope намеренно не расширяется до media processing pipeline

В этом ADR сознательно не реализуются:

- thumbnails generation;
- transcoding;
- audio/video inline player;
- multi-file composer;
- drag-and-drop overhaul;
- EXIF processing;
- antivirus;
- backend image proxy/CDN layer;
- storage/runtime/deploy changes;
- attachment-specific client cache subsystem.

## Последствия

### Положительные

- Product gap для image attachments закрывается без нового backend/runtime slice.
- Attachment-only и text + image messages становятся визуально понятнее и в direct chats, и в groups.
- Existing presigned download model переиспользуется без contract drift.
- Non-image attachments сохраняют текущий polished rendering без ухудшений.

### Отрицательные

- Web получает дополнительный client-side access path для lazy preview resolution.
- Preview по-прежнему зависит от short-lived presigned URL и browser image support.
- Без thumbnails большие оригинальные изображения всё ещё могут быть тяжелее, чем специализированный preview pipeline.

### Ограничения

- Нельзя считать этот slice thumbnail/media processing pipeline.
- Нельзя использовать filename как source of truth для preview.
- Нельзя расширять решение до audio/video preview, EXIF, CDN или storage/runtime changes.
- Нельзя подменять explicit open/download background-prefetch моделью для всей ленты.

## Альтернативы

### 1. Сразу внедрить thumbnails и processing pipeline

Не выбрано, потому что это резко расширяет scope до backend/runtime/media jobs и ломает цель узкого bounded slice.

### 2. Оставить только текущий file-card rendering

Не выбрано, потому что existing attachment foundation уже достаточно зрелая, а image UX gap можно закрыть чисто web-layer решением.

### 3. Делать preview через отдельный backend proxy endpoint

Не выбрано, потому что текущая model уже использует presigned download через `GetAttachment`,
и новый proxy path только расширил бы transport/runtime surface без необходимости.
