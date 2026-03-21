# ADR-054: Max groups per user rules foundation

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-030`, `ADR-032`, `ADR-047`, `ADR-049` и `ADR-053`
в AeroChat уже существуют:

- canonical group entity и explicit membership model внутри `aero-chat`;
- create group и join-by-invite flows через `aero-gateway`;
- ownership transfer, leave и remove member semantics;
- явный operator-facing admission control pattern для media quota;
- gateway-only внешний контракт без отдельного admin surface.

Но group foundation всё ещё оставлял операционный gap:

- один пользователь мог без backend limit создавать и вступать в неограниченное число групп;
- operator не имел простого и явного policy knob для этого домена;
- invite links и direct group creation не имели общего bounded admission rule;
- решение через отдельный anti-abuse platform, cache accounting или admin suite было бы чрезмерным для текущего slice.

Следующий slice должен добавить реальный max-groups policy foundation,
не ломая текущую group model,
не расширяя внешний API без необходимости
и не превращая PR в broad moderation/billing/anti-spam систему.

## Решение

### 1. Выбирается один лимит: максимум активных group membership на пользователя

Для текущего этапа вводится один явный и конфигурируемый лимит:

- лимит задаётся на пользователя;
- считается по количеству активных membership в группах;
- одинаково применяется к созданию новой группы и к вступлению по invite link.

Этот вариант выбран как smallest safe rule, потому что:

- он покрывает оба admission path одной политикой;
- не требует отдельной модели для `owned groups` и `joined groups`;
- не затрагивает role matrix, invite semantics и moderation model;
- остаётся простым для оператора и review.

### 2. Source of truth остаётся в SQL state текущих membership

Лимит считается только по backend-owned таблице `group_memberships`.

В active count входят только текущие membership rows пользователя.

Не считаются:

- уже удалённые membership;
- membership после `LeaveGroup`;
- любые несуществующие historical состояния.

Отдельный counter table, cache, background reconciliation и внешние anti-abuse services не вводятся.

### 3. Enforcement применяется только на admission paths

Для текущего этапа лимит проверяется только на:

- `CreateGroup`;
- `JoinGroupByInviteLink`.

Следствия:

- создание новой группы расходует один active membership, потому что creator сразу становится `owner`;
- join по invite link расходует один active membership только если membership реально создаётся;
- повторный join уже существующего участника остаётся идемпотентным и не должен отклоняться из-за исчерпанного лимита.

`ListGroups`, `GetGroup`, invite management, role updates, moderation actions и realtime delivery этим ADR не меняются.

### 4. Ownership transfer не получает отдельного лимитного правила

Для текущего этапа ownership transfer intentionally не считается новым admission event.

Причины:

- `TransferGroupOwnership` не создаёт новую membership;
- общее число active membership у старого и нового owner не меняется;
- отдельный запрет на ownership transfer при already-full target user добавил бы вторую overlapping policy без реального выигрыша.

Следовательно:

- ownership transfer сохраняет текущую семантику;
- отдельный limit-check на transfer не добавляется;
- owner-only invariants из прошлых ADR не меняются.

### 5. Enforcement должен быть deterministic и race-safe

Проверка лимита не должна оставаться best-effort precheck только в памяти сервиса.

Для текущего этапа admission выполняется внутри PostgreSQL transaction:

- `aero-chat` сериализует admission по `user` row через `SELECT ... FOR UPDATE`;
- затем считает текущее количество active membership в `group_memberships`;
- если новый admission превысил бы configured limit, запрос отклоняется с `resource_exhausted`;
- только после этого создаётся новая membership.

Такой подход уже согласован с паттерном `ADR-049` и не требует отдельной accounting platform.

### 6. Ошибка остаётся узкой и совместимой с текущим gateway-only контрактом

При превышении лимита backend возвращает только одну семантику:

- `resource_exhausted`

Новый public RPC, quota dashboard response model или отдельный policy discovery API не вводятся.

Текущий gateway-only edge contract сохраняется:

- `aero-chat` остаётся source of truth;
- `aero-gateway` по-прежнему только проксирует typed error наружу.

### 7. Config остаётся явным и operator-friendly

Вводится один новый runtime parameter:

- `AERO_MAX_ACTIVE_GROUP_MEMBERSHIPS_PER_USER`

Параметр:

- задаёт максимальное число active group membership на пользователя;
- должен быть положительным;
- документируется в env examples и compose wiring;
- не вычисляется автоматически из invite count, role, plan tier или антиспам-эвристик.

### 8. Scope намеренно остаётся узким

В этом ADR сознательно не реализуются:

- отдельный лимит только на owned/created groups;
- per-role limits;
- per-group-size limits;
- invite rate limiting;
- cooldown между созданиями групп;
- admin UI или moderation dashboard;
- billing/subscription semantics;
- anti-spam scoring system;
- notifications/toasts о приближении к лимиту.

## Последствия

### Положительные

- У operator появляется один понятный safety knob для group growth.
- `CreateGroup` и `JoinGroupByInviteLink` начинают вести себя согласованно и предсказуемо.
- Решение остаётся SQL-backed, reviewable и не требует второй competing accounting system.
- Existing ownership transfer, moderation model и gateway-only внешний контракт сохраняются.

### Отрицательные

- `aero-chat` получает ещё один admission check на create/join paths.
- При конкурентных mutate flows пользователь может получить консервативный отказ и повторить запрос позже.
- Policy пока intentionally coarse: один лимит на все active group membership без product-specific tiers.

### Ограничения

- Нельзя считать этот slice anti-abuse platform.
- Нельзя расширять его до admin control suite, billing или invite-rate limiting “заодно”.
- Нельзя добавлять вторую competing membership accounting model вне SQL source of truth.
- Нельзя ломать existing ownership transfer semantics без отдельного решения.

## Альтернативы

### 1. Лимитировать только созданные/owned группы

Не выбрано, потому что это не покрывает join-by-invite path
и оставляет второй неограниченный admission channel.

### 2. Добавить сразу несколько лимитов одновременно

Не выбрано, потому что `owned groups`, `joined groups` и per-role caps
резко усложняют policy model и не нужны для первого safe slice.

### 3. Делать limit через cache/counter service или anti-abuse platform

Не выбрано, потому что текущая SQL membership model уже достаточна
для deterministic narrow enforcement без новой platform complexity.
