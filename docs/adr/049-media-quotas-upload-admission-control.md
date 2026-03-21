# ADR-049: Media quotas foundation для upload-intent admission control

- Статус: Accepted
- Дата: 2026-03-21

## Контекст

После `ADR-035`, `ADR-036`, `ADR-037`, `ADR-038`, `ADR-039`, `ADR-040`, `ADR-041` и `ADR-048`
в AeroChat уже существуют:

- first-class attachment entity и explicit upload intent model;
- direct-to-object-storage presigned upload flow;
- explicit attachment lifecycle states;
- bounded cleanup path для stale uploads и orphaned unattached attachments;
- gateway-only внешний контракт.

Но media foundation всё ещё оставлял операционный риск:

- upload intent можно создавать до исчерпания operator budget без server-side quota gate;
- lifecycle cleanup уже умеет освобождать quota-relevant state, но quota admission itself отсутствует;
- без backend-owned quota rule пользователь может абьюзить storage budget через повторное создание новых reservations;
- bucket scan как source of truth для quota противоречит уже принятому state-driven lifecycle approach.

Следующий slice должен добавить реальную quota foundation,
не превращая проект в billing/storage governance platform,
не ломая existing attachment model
и не расширяя public API без необходимости.

## Решение

### 1. Выбирается smallest safe quota model: per-user total media quota in bytes

Для текущего этапа вводится один явный лимит:

- quota задаётся на пользователя;
- измеряется в байтах;
- применяется ко всем direct и group attachment upload intents одинаково.

Причины:

- модель проста для объяснения оператору;
- она не требует per-group или per-class accounting tables;
- она уже даёт реальную защиту от storage abuse;
- она хорошо композируется с текущим owner-based attachment lifecycle.

### 2. Quota проверяется только на `CreateAttachmentUploadIntent`

Admission control выполняется при создании нового upload intent,
до записи нового attachment reservation.

Следствия:

- текущий explicit presigned upload flow сохраняется;
- уже существующие direct/group permission checks не меняются;
- quota enforcement не зависит от браузера или client-local state;
- public transport surface не расширяется отдельным quota RPC.

Если новый upload intent превышает лимит,
запрос отклоняется с `resource_exhausted`.

### 3. Source of truth остаётся в backend-owned metadata, без bucket scan

Quota usage считается только по PostgreSQL metadata,
которыми уже владеет `aero-chat`.

Bucket listing, object scan и внешние accounting services не используются.

Это сохраняет совместимость с `ADR-048`:

- cleanup и quota опираются на одну и ту же state model;
- quota release происходит естественно через lifecycle transitions;
- не появляется вторая competing accounting system.

### 4. В quota считаются только states, которые ещё занимают или резервируют budget

Для текущего этапа в quota usage включаются user-owned attachments в состояниях:

- `pending`
- `uploaded`
- `attached`
- `failed`

Не включаются:

- `expired`
- `deleted`

Смысл:

- `pending` считается, потому что upload intent уже резервирует storage budget и иначе его можно абьюзить массовым созданием reservations;
- `uploaded` считается как реальный storage occupant;
- `attached` считается как активная часть текущей media history;
- `failed` считается консервативно до cleanup/delete, потому что lifecycle ещё не вывел такой attachment из active budget;
- `expired` и `deleted` больше не должны удерживать quota, потому что `ADR-048` уже вывел их из active lifecycle.

### 5. Quota enforcement должен быть deterministic и race-safe

Проверка quota не должна быть best-effort или purely optimistic.

Для текущего этапа admission выполняется внутри одной PostgreSQL transaction:

- backend сериализует quota admission на owner level;
- считает текущий usage в БД;
- проверяет, помещается ли новый `size_bytes` в configured limit;
- только после этого создаёт attachment и upload session.

Это выбрано как smallest safe option,
который не требует отдельного counter table и не создаёт race между двумя параллельными intent requests.

### 6. Config остаётся явным и операторским

Вводится один новый runtime parameter:

- `AERO_MEDIA_USER_QUOTA_BYTES`

Он задаёт общий per-user media quota для upload admission.

Параметр:

- обязателен как часть runtime config;
- должен быть положительным;
- не вычисляется автоматически из cleanup TTL, bucket size или иных эвристик.

### 7. Scope намеренно остаётся узким

В этом ADR сознательно не реализуются:

- user-facing quota dashboard;
- admin quota UI;
- per-group quotas;
- billing/accounting platform;
- historical analytics;
- bucket reconciliation scanner;
- manual quota reset API;
- quota notifications/toasts;
- separate jobs-platform для quota accounting.

## Последствия

### Положительные

- upload admission получает реальный deterministic server-side gate;
- quota и lifecycle cleanup используют одну и ту же metadata/state model;
- оператор получает простой и понятный storage safety knob;
- direct/group attachment flow сохраняется без transport redesign.

### Отрицательные

- `aero-chat` получает ещё один admission concern на create-intent path;
- quota rule пока intentionally coarse: один per-user total bytes limit;
- attached files продолжают удерживать quota, пока отдельная retention policy не определена.

### Ограничения

- Нельзя считать этот slice полноценной storage accounting platform.
- Нельзя использовать bucket scan как source of truth для quota enforcement.
- Нельзя расширять этот PR до quota UI, billing, analytics или reconciliation jobs.
- Нельзя считать `failed` state мгновенно освобождённым от quota до lifecycle cleanup.

## Альтернативы

### 1. Считать quota только по фактически uploaded objects

Не выбрано, потому что тогда `pending` upload intent можно массово абьюзить без admission pressure.

### 2. Делать quota через external counter service

Не выбрано, потому что это добавляет platform complexity без необходимости:
текущая attachment state model уже достаточна для narrow quota slice.

### 3. Вводить per-group или per-file-class quotas сразу

Не выбрано, потому что это раздувает policy model,
не нужно для первого safe admission gate
и усложняет operator contract.
