# ADR-077: One-active-call-per-user policy в RTC control plane

- Статус: Accepted
- Дата: 2026-03-23

## Контекст

После `ADR-074`, `ADR-075` и `ADR-076` в AeroChat уже есть usable direct audio-call slice:

- `aero-rtc-control` владеет active call lifecycle и participant state;
- сервер уже гарантирует только один active call на conversation scope;
- web умеет start/join/rejoin direct call и получает bounded continuity внутри открытой app session.

Но глобального ограничения на пользователя пока нет. Это оставляет двусмысленное состояние до появления group-call UX и более богатой call orchestration:

- пользователь может попытаться стартовать новый direct call, уже оставаясь active participant в другом call;
- пользователь может попытаться join'ить другой active call из другого scope;
- клиентский stale state не является надёжным местом для такой product policy;
- без server-backed отказа дальнейшее расширение RTC ведёт к неочевидным multi-call semantics раньше времени.

Следующий изолированный slice должен убрать эту двусмысленность, но не раздувать PR до:

- auto-switch или auto-leave между звонками;
- call waiting, priorities и transfer semantics;
- отдельной generic call-policy platform;
- group/video UI.

## Решение

### 1. Вводится глобальный инвариант one-active-call-per-user

Для текущей RTC модели фиксируется правило:

- пользователь может иметь не более одного `active` participant record во всех active calls одновременно.

Это применяется одинаково к:

- direct calls;
- group calls;
- future call scopes, которые уже выражаются текущей canonical RTC model.

### 2. Policy owner остаётся `aero-rtc-control`

Правило реализуется именно в RTC control plane, потому что:

- это owner active call и participant lifecycle;
- именно там находится server-backed source of truth;
- `aero-gateway` должен оставаться thin edge без собственной call policy;
- web не может считаться authoritative источником из-за stale tabs, reconnect и нескольких клиентов.

Проверка применяется в:

- `StartCall`;
- `JoinCall`.

### 3. Конфликт моделируется как явный отказ, а не как автоматическое переключение

Выбран консервативный продуктовый ответ:

- если пользователь уже active participant в другом active call, `StartCall` и `JoinCall` отклоняются;
- сервер возвращает distinguishable RTC-specific conflict;
- текущий call пользователя не завершается автоматически;
- переход в новый call не делается “за пользователя”.

Это поведение выбрано, потому что до отдельного product design ещё не определены:

- приоритеты direct против group;
- transfer semantics;
- call waiting;
- UI для подтверждённого switch flow.

### 4. Conflict contract остаётся small и explicit

Wire-level transport остаётся совместимым с текущим ConnectRPC contract:

- код ошибки остаётся `failed_precondition`;
- для RTC-specific conflict добавляются явные metadata headers:
  - причина конфликта;
  - `call_id` уже активного звонка;
  - `participant_id`;
  - scope context (`direct_chat_id` или `group_id`).

Это даёт клиентам способ отличать:

- “уже участвуете в другом звонке”

от:

- permission denial;
- not found / ended call;
- validation failure;
- generic scope conflict.

### 5. Race-safety обеспечивается authoritative storage

Policy не полагается только на pre-check в памяти или в сервисном коде.

В Postgres добавляется partial unique index на active participation пользователя:

- только один `rtc_call_participants` c `state = 'active'` на `user_id`.

Service делает:

- явный pre-check для более понятного отказа;
- затем authoritative insert;
- при concurrent race повторно читает active participation и возвращает тот же explicit conflict.

Для текущего single-server runtime этого достаточно как минимально production-credible решения.

## Последствия

### Положительные

- Сервер становится единственным source of truth для one-active-call-per-user policy.
- Multi-call ambiguity убирается до появления group-call UX.
- Current direct-call UX получает явный и bounded отказ вместо generic failure.
- Решение остаётся узким и не превращается в policy platform.

### Отрицательные

- Пользователь не может сам начать второй звонок без явного leave/end текущего.
- Для richer switching UX позже потребуется отдельный продуктовый и архитектурный slice.
- Metadata contract добавляет небольшой explicit error surface для клиентов.

## Что сознательно отложено

- auto-leave текущего call при старте нового;
- auto-end текущего call;
- transfer и call waiting;
- любые приоритеты между direct и group calls;
- global call manager UI;
- device-level multi-session call policy;
- cluster-wide/distributed coordination beyond current authoritative Postgres + single-server runtime.

## Альтернативы

### 1. Оставить policy только на клиенте

Не выбрано, потому что stale client state и несколько открытых клиентов не дают надёжной защиты инварианта.

### 2. Автоматически покидать текущий звонок и подключать новый

Не выбрано, потому что это уже product flow с отдельными UX- и consistency-решениями, которых пока нет.

### 3. Перенести policy в `aero-gateway`

Не выбрано, потому что gateway не владеет call lifecycle и не должен становиться owner'ом RTC domain logic.

### 4. Строить общий policy framework для будущих call rules

Не выбрано, потому что текущему продукту нужен один конкретный инвариант, а не абстрактная platform layer.
