# ADR-074: RTC signaling и call-control foundation в `aero-rtc-control`

- Статус: Accepted
- Дата: 2026-03-23

## Контекст

После текущего merged audit в AeroChat уже существуют:

- единый внешний edge через `aero-gateway`;
- устойчивые доменные границы `aero-identity` и `aero-chat`;
- realtime transport foundation в `aero-gateway`;
- direct chats, groups, membership roles и encrypted/device-aware foundations;
- reserved bounded context `aero-rtc-control`, который пока реализован только как health-only skeleton с `Ping`.

Следующий изолированный slice должен превратить RTC reservation в реальный control-plane foundation для будущих звонков, но не раздувать PR до media plane, browser call UX или ложных security claims.

Нужно одновременно соблюсти уже принятые инварианты:

- `aero-gateway` остаётся единственной внешней backend edge-точкой;
- `aero-chat` остаётся владельцем direct chats, groups, memberships и permission boundaries;
- signaling/control plane не смешивается с media plane;
- сервер остаётся source of truth для call state и authorization;
- продукт не заявляет full E2EE calls, SFU или готовый browser call UX.

## Решение

### 1. RTC получает собственный bounded context

`aero-rtc-control` становится владельцем только RTC control-plane state:

- active call entity;
- active participant lifecycle;
- bounded signal relay contract;
- call lifecycle rules.

`aero-chat` не получает call state storage и не становится signalling owner.

`aero-gateway` остаётся thin edge:

- проксирует typed ConnectRPC API `RtcControlService`;
- публикует bounded realtime events через уже существующий websocket transport;
- не хранит call domain state.

### 2. Signaling/control plane отделяется от media plane

На этом этапе реализуется только control plane:

- создание active call;
- join / leave / manual end;
- participant-targeted signal relay;
- realtime delivery server-to-client.

Не реализуются:

- media plane;
- SFU;
- TURN/STUN orchestration platform;
- browser peer-connection UX;
- call capture / device picker / output controls;
- screen share, recording, push notifications.

Сервер не становится media relay и не пытается семантически интерпретировать SDP/ICE beyond bounded validation envelope type + payload size.

### 3. Каноническая модель call

Вводится одна минимальная canonical сущность `call`.

Поля:

- `call_id`;
- явный `scope_type`: `direct` или `group`;
- `direct_chat_id` либо `group_id`;
- `created_by_user_id`;
- `status`: `active` или `ended`;
- `created_at`, `started_at`, `updated_at`;
- `ended_at`, `ended_by_user_id`, `end_reason`.

Инварианты:

- одновременно допускается только один active call на conversation scope;
- direct scope привязан к существующему direct chat;
- group scope привязан к существующей group;
- завершённый call не используется как call history продукта и не попадает в chat timeline в этом PR.

### 4. Модель participant/session

Для active call вводится отдельная сущность `call_participant`.

Поля:

- `participant_id`;
- `call_id`;
- `user_id`;
- `state`: `active` или `left`;
- `joined_at`, `left_at`, `updated_at`;
- `last_signal_at`.

Выбрана user-scoped модель:

- один пользователь может иметь не более одного active participant record в рамках одного call;
- повторный join после leave создаёт новый record, а не переиспользует старый tombstone;
- отдельная device/session topology пока не вводится.

Это сознательно уже не “простая in-memory presence”, но ещё и не full device-aware call graph.

### 5. Authorization строится поверх текущих chat boundaries

`aero-rtc-control` не копирует membership и direct-chat ownership в свою БД.

Проверки выполняются через существующие typed downstream вызовы к `aero-chat` и `aero-identity`:

- direct scope проверяется через `ChatService.GetDirectChat`;
- group scope проверяется через `ChatService.GetGroup`;
- аутентификация и source of truth по bearer session остаются в `aero-identity`.

Правила:

- только участник target conversation может видеть active call и список active participants;
- direct call могут start/join/leave/signal только участники direct chat;
- group call могут start/join/leave/signal только участники группы с role `owner`, `admin` или `member`;
- `reader` в группе может видеть факт active call и active participants, но не может start/join/send signal/end call;
- manual end разрешён только создателю call;
- если последний active participant выходит, call завершается автоматически сервером с reason `last_participant_left`.

`reader` выбран консервативно как read-only role и для RTC foundation тоже не считается активным speaking/joining участником.

### 6. Signaling transport model

`RtcControlService` остаётся typed ConnectRPC API для command/read path.

Bounded signal relay фиксируется как explicit envelope:

- `offer`;
- `answer`;
- `ice_candidate`.

Свойства:

- сигнал всегда `call_id`-scoped;
- сигнал всегда `target_user_id`-scoped;
- payload остаётся opaque binary blob с ограничением размера;
- сигнал не хранится как durable replay log.

Realtime delivery reuse'ит существующий gateway websocket transport с минимальным каталогом:

- `rtc.call.updated`;
- `rtc.participant.updated`;
- `rtc.signal.received`.

Отдельный публичный websocket stack для `aero-rtc-control` не вводится.

### 7. Persistence/runtime model

`aero-rtc-control` получает собственный Postgres-backed storage layer:

- `rtc_calls`;
- `rtc_call_participants`.

Active call и participant lifecycle хранятся авторитетно в БД.

Signaling delivery остаётся честно ephemeral:

- сервер не полагается на process memory для `call` или `participant`;
- сервер не обещает durable replay пропущенных signaling messages;
- realtime websocket через `aero-gateway` остаётся bounded single-instance transport.

Сервис получает явный runtime wiring:

- database bootstrap;
- downstream URLs `aero-identity` и `aero-chat`;
- bounded signal payload limit;
- compose wiring для dev и server stacks.

### 8. Что сознательно откладывается

Этот slice сознательно не реализует:

- user-facing call screen и browser peer-connection orchestration;
- actual media streams;
- device-aware mute/camera/output controls;
- screen share hooks в UI;
- recordings;
- push / ringing / missed-call notifications;
- call timeline/history inside chats;
- one-active-call-per-user policy across all conversations;
- distributed realtime bus;
- claims о full call encryption или final call security model.

## Последствия

### Положительные

- `aero-rtc-control` перестаёт быть пустым reservation и становится реальным bounded context.
- Call lifecycle теперь имеет серверный source of truth.
- RTC authorization reuse'ит существующие chat/group boundaries без размазывания ownership.
- Gateway получает минимально достаточный edge slice для будущих web calls без второго публичного транспорта.
- Архитектура готова к следующим слоям: audio-first UX, group join UX, later video и later device controls.

### Отрицательные

- Появляется ещё один stateful backend service с собственной БД-схемой и downstream зависимостями.
- Signaling delivery на этом этапе не даёт durable replay и остаётся single-instance realtime path.
- `reader` в group calls выглядит строго ограниченным, что может потребовать отдельного продуктового пересмотра позже.

## Альтернативы

### 1. Хранить call state в `aero-chat`

Не выбрано, потому что это смешивает chat history/membership domain с RTC lifecycle и signalling semantics.

### 2. Делать signalling только через frontend peer-to-peer без серверного call state

Не выбрано, потому что active call ownership, authorization и one-active-call-per-conversation invariant должны быть server-controlled.

### 3. Сразу строить media plane или SFU

Не выбрано, потому что это резко расширяет scope, добавляет operational complexity и создаёт ложное впечатление о готовых calls.

### 4. Разрешить `reader` участвовать в group calls уже сейчас

Не выбрано, потому что текущая role philosophy фиксирует `reader` как read-only участника, а RTC foundation должен выбрать минимальное и консервативное правило.
