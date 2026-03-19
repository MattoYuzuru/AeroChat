# ADR-040: Web media message rendering polish поверх существующей attachment foundation

- Статус: Accepted
- Дата: 2026-04-17

## Контекст

После `ADR-035`, `ADR-036`, `ADR-037`, `ADR-038` и `ADR-039` в AeroChat уже существуют:

- attachment entity и attach-to-message model;
- direct-to-object-storage upload через presigned URL;
- explicit `GetAttachment` flow с short-lived presigned download URL;
- single-file web attachment composer для direct chats и groups;
- attachment-only message semantics поверх текущего message envelope.

Но текущий продуктовый UX для сообщений с вложениями остаётся недостаточно цельным:

- direct chats и groups уже умеют отправлять вложения, но thread рендерит их слишком минимально;
- attachment-only message визуально выглядит как "остаток" от bubble, а не как полноценное сообщение;
- text + attachment и attachment-only сообщения визуально расходятся между direct и group thread;
- MIME/type hint и file metadata пока не дают достаточно human-friendly display;
- длинные имена файлов и пустой text path требуют более аккуратного layout-поведения.

Нужен следующий узкий slice, который:

- остаётся web/UI-only как primary scope;
- улучшает rendering attachment messages в `/app/chats` и `/app/groups`;
- не меняет media edge contract, storage semantics, upload flow и gateway runtime;
- не превращается в preview pipeline, media player, background cache layer или новый backend slice.

Также важно сохранить уже принятые ограничения:

- attachment categorization на этом этапе нужна только для display polish;
- download остаётся explicit user action через существующий `GetAttachment`;
- preview/thumbnails/transcoding/media processing не входят в scope;
- safe text/markdown rendering продолжает быть каноническим путём для text payload.

## Решение

### 1. Slice остаётся display-oriented поверх существующей attachment model

В этом ADR не меняется attachment entity, upload lifecycle или message transport.

Web-клиент только улучшает presentation уже существующих `attachments` внутри message snapshot:

- direct thread;
- group primary thread;
- text-only message path;
- text + attachment path;
- attachment-only path.

Attachment rendering остаётся pure UI slice поверх уже принятой domain model.

### 2. Attachment rendering получает полноценный message-card presentation

Для каждого attachment внутри message bubble/card web показывает:

- file name;
- readable size;
- display-oriented category hint;
- MIME hint;
- explicit CTA для `open` и `download`.

Attachment-only сообщение должно выглядеть как полноценное сообщение даже без text payload:

- bubble/card сохраняет нормальную высоту и внутренние отступы;
- attachment block не выглядит как случайный "хвост" после отсутствующего текста;
- direct и group thread следуют одинаковым базовым rendering rules.

### 3. Вводится консервативная display categorization без security semantics

На web-слое вводится узкая categorization только для display polish:

- `image`
- `audio`
- `video`
- `document`
- `archive/binary`
- `generic file`

Эта categorization:

- не влияет на authorization;
- не влияет на trust/security decisions;
- не подменяет MIME validation backend'а;
- не является content sniffing;
- не означает, что файл безопасно preview'ить inline.

Разрешены только консервативные эвристики по MIME и, при необходимости, по filename extension для human-friendly display.

### 4. Download остаётся явным пользовательским действием

Web по-прежнему использует существующий `GetAttachment` flow:

- клиент запрашивает access только по явному user action;
- получает short-lived presigned URL;
- не prefetch'ит все attachment URLs заранее;
- не строит тяжёлый cache/storage layer;
- не добавляет service worker или PWA media storage.

Explicit `open` и `download` CTA считаются UX-надстройкой над тем же access flow, а не новым transport slice.

### 5. Safe fallback остаётся обязательным

Если MIME не распознан или не подходит под узкую categorization:

- attachment рендерится как generic file card;
- safe markdown/text rendering не меняется;
- raw HTML не используется;
- attachment rendering не предполагает inline browser preview.

Это нужно, чтобы UX улучшился без ложного ощущения, что система уже поддерживает полноценный media preview pipeline.

### 6. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- inline image preview;
- thumbnail generation;
- audio/video player;
- transcoding;
- multi-file composer;
- drag-and-drop overhaul;
- antivirus;
- cleanup jobs;
- новый gateway/chat domain slice;
- media-specific background prefetch;
- attachment explorer/gallery/files page.

## Последствия

### Положительные

- Attachment messages становятся визуально читаемыми и консистентными в direct chats и groups.
- Attachment-only message перестаёт выглядеть как деградировавший edge-case.
- Пользователь получает явные open/download действия без изменения media contract.
- Текущий single-file composer и existing attachment foundation становятся продуктово завершённее.

### Отрицательные

- UI по-прежнему не даёт inline preview и richer media affordances.
- `download` behaviour остаётся зависимым от текущего presigned object access path и browser handling.
- Categorization на клиенте остаётся эвристической и намеренно ограниченной.

### Ограничения

- Нельзя считать этот slice preview/media processing pipeline.
- Нельзя использовать display categorization как security signal.
- Нельзя расширять изменение до storage/runtime/deploy concerns.
- Нельзя подменять explicit user action background prefetch-механикой.

## Альтернативы

### 1. Сразу внедрить preview pipeline

Не выбрано, потому что это резко расширяет scope до thumbnails, inline rendering, media processing и новых runtime concerns.

### 2. Оставить текущий minimal rendering до отдельного большого media PR

Не выбрано, потому что upload/send foundation уже usable, а продуктовый UX gap можно закрыть отдельным узким web-only slice без backend redesign.

### 3. Делать attachment categorization на backend

Не выбрано, потому что текущая задача касается только display polish и не требует нового domain/runtime contract.
