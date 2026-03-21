# ADR-048: Hardening lifecycle для attachment upload sessions и orphaned attachments

- Статус: Accepted
- Дата: 2026-03-21

## Контекст

После `ADR-035`, `ADR-036`, `ADR-037`, `ADR-038`, `ADR-039`, `ADR-040`, `ADR-041` и `ADR-047`
в AeroChat уже существуют:

- first-class attachment entity и explicit upload intent model;
- private S3-compatible media storage с direct-to-object-storage upload;
- attachment-only и text + attachment message semantics;
- gateway-only внешний контракт;
- group moderation expansion без изменения media ownership.

Но attachment foundation всё ещё оставлял операционный gap:

- `attachment_upload_session` имел TTL только как поле и enum, но не как реальный lifecycle transition;
- `pending` uploads могли застревать без bounded expiry path;
- `uploaded`, но не attached attachments не имели backend-driven cleanup path;
- текущая схема не давала консервативного object cleanup без bucket scan;
- `failed` и `deleted` состояния были определены, но media retention path оставался неполным.

Следующий slice должен закрыть именно этот lifecycle gap,
не превращая проект в media processing platform,
не ломая gateway-only external model
и не затрагивая attached history.

## Решение

### 1. Upload session expiration становится реальным lifecycle transition

`attachment_upload_session` больше не считается expired только по сравнению текущего времени с `expires_at`.

Вводится явный backend transition:

- `pending -> expired`, если upload session не завершена к моменту TTL expiry;
- transition может происходить:
  - eager-path при обращении в `CompleteAttachmentUpload` после TTL;
  - batch cleanup path внутри runtime `aero-chat`.

Это делает `expired` реальным durable состоянием в БД, а не только вычисляемым условием.

### 2. Attachment lifecycle расширяется консервативным состоянием `expired`

Для attachment lifecycle фиксируются состояния:

- `pending`
- `uploaded`
- `attached`
- `failed`
- `expired`
- `deleted`

Семантика:

- `pending`: intent создан, upload ещё не подтверждён backend;
- `uploaded`: объект найден и прошёл базовую size validation;
- `attached`: attachment связан с message relation и считается частью истории;
- `failed`: upload завершился некорректно или не прошёл базовую валидацию;
- `expired`: attachment больше не считается usable для attach/access lifecycle и ожидает cleanup policy;
- `deleted`: backend завершил логическое удаление orphaned attachment после safe object cleanup.

`expired` используется только для unattached attachment lifecycle.
`attached` attachment не переводится в `expired` этим slice.

### 3. Cleanup строится только от backend state и message linkage

Source of truth для cleanup остаётся PostgreSQL state.

Cleanup никогда не определяется:

- по UI-событиям;
- по client-local draft state;
- по bucket listing;
- по эвристике “объект давно лежит в storage”.

Основной guard:

- attachment с существующей записью в `message_attachments` не считается orphaned;
- такой attachment не участвует в cleanup path, даже если message был позже tombstoned или иным образом изменён.

### 4. Выбирается smallest safe runtime model: bounded in-process cleanup в `aero-chat`

Для текущего этапа cleanup не выносится в отдельную jobs-platform.

Выбрана модель:

- `aero-chat` запускает узкий периодический lifecycle cleanup loop;
- loop работает batch-oriented и configurable;
- object deletion идёт по точным `object_key`, полученным из БД;
- batch size ограничен;
- loop можно отключить через runtime config, если оператору нужен manual rollout.

`aero-jobs` не используется в этом slice,
потому что текущая задача уже целиком лежит в ownership boundary `aero-chat`
и не требует отдельного service/platform expansion.

### 5. Cleanup policy разделяется на три узких этапа

#### 5.1. Истёкшие незавершённые upload sessions

Если upload session остаётся `pending` после `expires_at`,
backend переводит:

- `attachment_upload_session -> expired`
- связанный `attachment`, если он всё ещё `pending`, в `expired`

Это даёт:

- operational detectability stale uploads;
- запрет на позднее завершение такого upload;
- явный source of truth для последующего cleanup.

#### 5.2. Uploaded, но не attached attachments

Для `uploaded`, но не linked attachments вводится отдельный unattached TTL.

Если attachment:

- остаётся `uploaded`;
- не имеет строки в `message_attachments`;
- старше configured unattached TTL;

backend переводит его в `expired`.

Это считается консервативным retention rule для orphaned uploaded objects.

#### 5.3. Object cleanup и logical delete

Object cleanup выполняется только для unattached attachments,
которые уже находятся в cleanup-eligible backend state:

- `expired`
- `failed`, если `failed` состояние уже выдержало configured retention window

Удаление объекта:

- идёт по точному `bucket + object_key`;
- не использует bucket scan;
- должно быть idempotent;
- already-missing object не считается fatal condition.

После успешного или idempotent-safe object cleanup
attachment переводится в `deleted`
с заполнением `deleted_at`.

Row в БД на этом этапе не hard-delete'ится.
Это выбрано как более безопасный и reviewable вариант.

### 6. Attached history защищена жёстким правилом исключения

Этот slice фиксирует жёсткое ограничение:

- attachment, уже linked к message history, не участвует ни в expiry, ни в object cleanup.

Следствия:

- direct/group rendering текущей attached history не ломается;
- existing explicit `GetAttachment` access flow для attached files остаётся прежним;
- delete-for-everyone tombstone semantics не превращается автоматически в media retention engine;
- будущая attached retention policy, если понадобится, должна оформляться отдельным ADR.

### 7. Persistence остаётся минимальной

Чтобы не раздувать storage model, принимаются минимальные изменения:

- добавить `expired` в attachment status constraint;
- добавить cleanup-oriented SQL queries и индексы;
- использовать уже существующие timestamps:
  - `expires_at` для upload session;
  - `uploaded_at` для orphaned uploaded TTL;
  - `failed_at` для failed retention;
  - `updated_at` как timestamp последнего lifecycle transition без отдельного `expired_at`.

Отдельный `expired_at` столбец сознательно не вводится в этом slice.

### 8. Публичный API surface почти не меняется

Gateway-only external model сохраняется.

Этот slice:

- не добавляет user-facing cleanup API;
- не добавляет cleanup commands наружу;
- не вводит notification/toast layer;
- не строит attachment management UI.

Proto surface меняется только эволюционно:

- attachment status получает `expired`, чтобы внешний typed contract не терял реальную lifecycle state.

### 9. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- transcoding;
- thumbnails;
- antivirus scanning;
- CDN;
- multipart/resumable redesign;
- quota UI;
- user-facing trash/explorer;
- search по filename/media;
- отдельная jobs-platform;
- hard-delete attachment rows;
- attached media retention policy;
- cleanup по message delete semantics.

## Последствия

### Положительные

- upload session TTL становится реальным durable lifecycle;
- stale unfinished uploads и orphaned uploaded attachments получают bounded cleanup path;
- cleanup становится state-driven, key-driven и reviewable;
- attached history остаётся защищённой от accidental cleanup;
- foundation остаётся совместимой с будущими media improvements без platform explosion.

### Отрицательные

- `aero-chat` получает дополнительный runtime cleanup responsibility;
- появятся новые cleanup-oriented env/config knobs;
- `expired` attachment state требует явной поддержки в transport mapping и тестах.

### Ограничения

- Нельзя считать этот slice полной media retention platform.
- Нельзя использовать bucket listing как основной cleanup source of truth.
- Нельзя распространять cleanup на attached attachments без нового ADR.
- Нельзя трактовать logical `deleted` как сигнал, что attachment row должна сразу hard-delete'иться из БД.

## Альтернативы

### 1. Сразу вынести cleanup в `aero-jobs`

Не выбрано, потому что текущий `aero-jobs` пока не содержит готовой operational foundation,
а задача решается уже внутри `aero-chat` меньшим и безопасным scope.

### 2. Оставить expiry только ленивой проверкой на read/write path

Не выбрано, потому что это не даёт bounded cleanup для stale uploads и orphaned objects,
а `expired` продолжает оставаться почти декларативным состоянием.

### 3. Делать cleanup через bucket scan

Не выбрано, потому что такой подход хуже объясняется,
хуже ограничивается permission/state model
и создаёт лишний риск accidental deletion вне message linkage semantics.
