# ADR-035: Media/File foundation через attachment entity, upload intent и S3-compatible object storage

- Статус: Accepted
- Дата: 2026-04-12

## Контекст

После `ADR-008`, `ADR-030`, `ADR-031`, `ADR-032`, `ADR-033` и `ADR-034` в AeroChat уже существуют:

- direct chat foundation;
- group foundation и primary group thread;
- realtime bootstrap для direct/group flows;
- single-server runtime с `postgres`, `redis` и `minio`.

Следующий крупный продуктовый трек — media/files.

На этом этапе нужен узкий, но production-oriented foundation slice, который:

- вводит каноническую модель attachment как отдельной сущности;
- не хранит бинарный payload в PostgreSQL;
- даёт browser-to-object-storage upload flow через presigned URL;
- различает незавершённый upload и attachment, уже привязанный к сообщению;
- фиксирует explicit lifecycle и authorization rules для direct и group chat;
- не тянет preview pipeline, transcoding, explorer, antivirus, calls, RTC и E2EE “заодно”.

Также нужно уважить уже принятые ограничения:

- сервер не должен становиться постоянным plaintext-архивом медиа согласно `ADR-002` и `ADR-004`;
- chat domain остаётся в `aero-chat`;
- transport остаётся proto-first и thin;
- storage foundation не должен подменять будущую crypto specification.

## Решение

### 1. Attachment становится first-class entity

В `aero-chat` вводится отдельная доменная сущность `attachment`.

`attachment`:

- не встраивается внутрь message row;
- имеет собственный `id`;
- имеет владельца `owner_user_id`;
- имеет chat scope: `direct` или `group`;
- знает свой storage object key и bucket;
- хранит только metadata и lifecycle state;
- может существовать до привязки к сообщению.

Связь message ↔ attachment хранится отдельно через явную relation table.

Это означает, что message body и file lifecycle больше не смешиваются в один неявный payload.

### 2. Бинарь хранится только в S3-compatible object storage

Для первичного хранения бинарного content используется `MinIO` / любой S3-compatible storage.

`PostgreSQL` хранит только:

- attachment metadata;
- upload session metadata;
- explicit message attachment relation.

Серверный backend не становится primary binary stream storage и не проксирует сам upload-файл как основную модель.

### 3. Upload flow строится через explicit upload intent

Перед upload клиент обязан запросить `upload intent`.

На этом этапе intent:

- резервирует `attachment`;
- создаёт `attachment_upload_session`;
- фиксирует owner, scope, MIME, размер и object key;
- возвращает presigned `PUT` URL для browser-to-object-storage upload;
- имеет короткий TTL и явный status.

Upload session остаётся отдельной сущностью, потому что:

- lifecycle upload и lifecycle attachment не совпадают полностью;
- незавершённый upload должен быть отличим от уже доступного attachment;
- foundation должен быть готов к будущим retry/cleanup/jobs без переизобретения модели.

### 4. Lifecycle фиксируется явно

Для `attachment` фиксируются состояния:

- `pending`
- `uploaded`
- `attached`
- `failed`
- `deleted`

Для `attachment_upload_session` фиксируются состояния:

- `pending`
- `completed`
- `failed`
- `expired`

Смысл состояний:

- `pending`: intent создан, но upload ещё не подтверждён backend;
- `uploaded`: объект найден в storage и прошёл базовую проверку размера;
- `attached`: attachment явно привязан к message relation;
- `failed`: upload завершился некорректно или объект не прошёл базовую валидацию;
- `deleted`: attachment логически выведен из активного использования отдельной future policy.

### 5. Storage key policy остаётся deterministic и без user-controlled path

Object key формируется backend'ом.

В key не используются произвольные пользовательские директории.

Ключ строится детерминированно по scope и owner context, например:

- `attachments/direct/<chat_id>/<owner_user_id>/<attachment_id>/original.<ext>`
- `attachments/group/<group_id>/<owner_user_id>/<attachment_id>/original.<ext>`

Это оставляет место для будущих preview objects и background jobs без пересборки базовой схемы.

### 6. Authorization rules фиксируются отдельно для direct и group scope

#### Direct attachments

Создание upload intent разрешено только текущему участнику direct chat, который всё ещё имеет право писать в чат:

- friendship активна;
- block отсутствует.

Непривязанный `pending/uploaded` attachment в direct scope виден только owner'у.

После `attached` metadata attachment доступна участникам соответствующего direct chat как часть chat history semantics.

#### Group attachments

Создание upload intent разрешено только текущему group member, который имеет право отправлять сообщения:

- `owner`
- `admin`
- `member`

`reader` не может создавать attachment upload intent.

Непривязанный `pending/uploaded` attachment в group scope виден только owner'у.

После `attached` metadata attachment доступна текущим участникам группы по тем же membership boundary, что и message history.

### 7. Public discovery не вводится

Attachment:

- не публикуется через публичный directory;
- не становится browseable storage listing;
- не получает anonymous discovery flow.

Любой доступ к metadata требует knowledge of attachment id и chat-scoped authorization.

### 8. Базовая validation policy остаётся консервативной

На foundation-этапе backend валидирует:

- file name;
- MIME syntax;
- размер;
- denylist для явно опасных browser-renderable MIME (`text/html`, `application/xhtml+xml`, `image/svg+xml`).

Deep content sniffing, antivirus scanning и media-specific processing сознательно не реализуются в этом slice.

### 9. Message linkage остаётся explicit и attach-once

Attachment привязывается к сообщению только явной relation.

На текущем foundation-этапе один attachment может быть связан только с одним message relation.

Это даёт:

- однозначный lifecycle;
- простую ownership model;
- отсутствие скрытого fan-out одного storage object в несколько сообщений.

Если в будущем понадобится reuse semantics, это будет отдельным решением.

### 10. Удаление message / attachment не расширяется сверх foundation

На этом этапе:

- delete flow для attachment не становится отдельной пользовательской фичей;
- существующее message deletion не превращается автоматически в полноценный media retention engine;
- cleanup jobs и TTL-delete policy для blobs откладываются.

Но документируется базовая семантика:

- attachment и message остаются разными сущностями;
- удаление message не означает неявный hard delete storage object в том же request;
- future cleanup policy должна опираться на explicit lifecycle state, а не на неявные side effects.

### 11. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- web upload UI;
- preview rendering;
- thumbnails;
- video transcoding;
- audio waveform extraction;
- file explorer;
- bulk download/zip;
- antivirus pipeline;
- advanced retention cleanup jobs;
- media realtime beyond existing message flow;
- calls, RTC, streaming и E2EE.

## Последствия

### Положительные

- Появляется каноническая attachment model без хранения бинаря в PostgreSQL.
- Browser upload может идти напрямую в object storage через presigned URL.
- Незавершённые uploads и уже прикреплённые файлы различаются явно.
- Direct и group authorization rules фиксируются без смешивания с preview/media-processing scope.
- Foundation готов к дальнейшим preview/jobs/cleanup slices без пересборки основной схемы.

### Отрицательные

- Runtime требует отдельной конфигурации browser-visible S3 endpoint для presigned upload URL.
- `aero-chat` получает новую ответственность по orchestration upload intent и storage verification.
- Cleanup, quotas и virus scanning остаются pending и потребуют отдельных slices.

### Ограничения

- Нельзя считать этот этап реализацией encrypted relay semantics из `ADR-004`.
- Нельзя считать этот этап E2EE или crypto-ready media implementation.
- Нельзя silently расширять этот foundation до preview/transcoding pipeline.
- Нельзя делать public file discovery или anonymous media access.

## Альтернативы

### 1. Хранить бинарь в PostgreSQL

Не выбрано, потому что это ухудшает storage profile, усложняет runtime и противоречит required foundation модели.

### 2. Делать upload через backend stream proxy как primary path

Не выбрано, потому что текущий целевой flow — browser-to-object-storage upload через presigned URL,
а backend должен оставаться orchestration boundary, а не основным бинарным relay на этом этапе.

### 3. Встраивать attachment metadata прямо в message row

Не выбрано, потому что это ломает отдельный lifecycle attachment и ухудшает будущее расширение preview/jobs/delete semantics.

### 4. Сразу реализовать preview/thumbnails/transcoding

Не выбрано, потому что это другой scope и он резко расширяет slice раньше, чем зафиксирована базовая attachment/storage модель.
