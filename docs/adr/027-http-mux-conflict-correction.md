# ADR-027: Коррекция HTTP ServeMux-конфликта между observability и ConnectRPC

- Статус: Accepted
- Дата: 2026-03-17

## Контекст

После вывода production-like compose runtime на реальный VPS подтвердился runtime blocker:

- `postgres`, `redis` и `minio` стартуют успешно;
- `aero-identity` и `aero-chat` завершаются сразу после запуска HTTP-сервера;
- причина — конфликт шаблонов в `net/http.ServeMux`.

Подтверждённые ошибки старта:

- `"/aerochat.identity.v1.IdentityService/" conflicts with "GET /"`
- `"/aerochat.chat.v1.ChatService/" conflicts with "GET /"`

Текущая причина:

- `libs/go/observability.NewBaseMux` регистрирует диагностические маршруты на одном `http.ServeMux`, включая `GET /`;
- `aero-identity` и `aero-chat` на том же mux регистрируют ConnectRPC service path с конечным `/`;
- в актуальной модели сопоставления шаблонов `net/http` такая комбинация считается конфликтующей ещё во время регистрации маршрутов.

Ранее этот же класс проблемы уже был исправлен в `aero-gateway`.
Нужно устранить blocker минимально, без изменения product scope, deploy topology и глобального observability API.

## Решение

### 1. Для `aero-identity` и `aero-chat` используется раздельная HTTP-композиция

Каждый сервис собирает HTTP handler из двух внутренних mux:

- `diagnosticsMux` обслуживает только:
  - `GET /`
  - `GET /healthz`
  - `GET /readyz`
- `connectMux` обслуживает только ConnectRPC service path соответствующего сервиса.

Внешний `http.Handler` вручную маршрутизирует диагностические пути в `diagnosticsMux`, а все остальные запросы передаёт в `connectMux`.

### 2. `libs/go/observability` не редизайнится в этом corrective slice

Библиотека observability сохраняет текущий контракт:

- корневая диагностика остаётся на `GET /`;
- `healthz` и `readyz` не меняют формат и семантику;
- глобальная перестройка общего helper слоя не входит в scope этого исправления.

### 3. Паттерн должен совпадать с уже принятым решением в `aero-gateway`

Для снижения архитектурного дрейфа `aero-identity` и `aero-chat` используют тот же принцип раздельной маршрутизации, который уже применяется в gateway:

- диагностика не делит один `ServeMux` с ConnectRPC service path;
- сервисные endpoints сохраняют текущие URL;
- readiness остаётся завязанной на существующие проверки зависимостей.

## Последствия

### Положительные

- `aero-identity` и `aero-chat` снова стартуют на актуальном runtime без паники на регистрации маршрутов.
- `GET /`, `GET /healthz` и `GET /readyz` сохраняют существующее поведение.
- ConnectRPC endpoints не меняют путь и остаются совместимыми с текущими клиентами и gateway.
- Исправление остаётся локальным и не вносит глобальный redesign observability слоя.

### Отрицательные

- Появляется ещё один повторяющийся HTTP-компоновщик по тому же паттерну, что уже есть в gateway.
- Если в будущем будет вводиться общий helper для такой композиции, это потребует отдельного осознанного шага.

### Ограничения

- Нельзя удалять корневую диагностику только ради обхода конфликта.
- Нельзя менять ConnectRPC service path или product API в этом corrective slice.
- Нельзя смешивать это исправление с redesign deploy topology, observability library или transport stack.

## Альтернативы

### 1. Глобально изменить `libs/go/observability.NewBaseMux`

Не выбрано, потому что для текущего blocker достаточно локального и уже проверенного паттерна из `aero-gateway`, а глобальный redesign увеличивает scope и риск регрессий.

### 2. Удалить `GET /` из диагностики

Не выбрано, потому что это меняет действующий runtime contract observability без необходимости.

### 3. Перейти на другой HTTP router

Не выбрано, потому что это не требуется для исправления подтверждённого blocker и нарушает принцип минимального корректирующего изменения.
