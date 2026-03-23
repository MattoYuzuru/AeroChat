# ADR-078: Web group call control / lobby bootstrap поверх существующего RTC control plane

- Статус: Accepted
- Дата: 2026-03-23

## Контекст

После `ADR-074` - `ADR-077` в репозитории уже существуют:

- серверный `RtcControlService` с direct/group scope, participant lifecycle и one-active-call-per-user policy;
- web audio-only direct-call slice с continuity внутри открытой app session;
- готовые group chats, membership roles и realtime в `apps/web`.

Но для group calls до этого PR не было пользовательского web slice:

- active group call нельзя было увидеть в group list;
- в открытой группе не было compact surface для start/join/leave/end;
- roster активных участников не показывался;
- group media transport в браузере ещё не реализован и не должен притворяться реализованным раньше времени.

Следующий изолированный slice должен дать первый честный product layer для group calls, но не раздувать scope до:

- multi-party browser audio transport;
- mesh/SFU/media orchestration;
- video, screen share и device controls;
- push/PWA/background ringing;
- нового backend transport или нового signaling flow.

## Решение

### 1. Следующий web slice фиксируется как group call control/lobby, а не full media calling

В этом PR web-клиент получает только:

- видимость active group call в списке групп;
- compact lobby surface внутри текущего group thread;
- start/join/leave/end actions поверх существующего RTC control plane;
- roster активных участников из server-backed participant list.

Сознательно не реализуются:

- browser multi-party audio media transport;
- `rtc.signal.received` для group flow;
- video и screen share;
- device picker, mute/output controls;
- полноэкранный call screen;
- push/background semantics.

### 2. UI surface остаётся встроенным и компактным

Выбранный product surface:

- в левом списке групп появляется компактный badge `Звонок активен`;
- внутри открытой группы появляется отдельная небольшая `Group call` карточка;
- карточка показывает server-backed phase, participant mode и roster;
- действия ограничены `Начать звонок`, `Присоединиться`, `Покинуть lobby`, `Завершить звонок`.

Отдельный giant call screen не добавляется. Group chat остаётся главным conversation surface.

### 3. Role behavior reuse'ит текущую backend policy без client-side фантазий

Web следует уже существующей серверной semantics:

- `owner`, `admin`, `member` могут стартовать group call;
- `owner`, `admin`, `member` могут join/leave active group call;
- `EndCall` доступен только creator'у активного call;
- `reader` может видеть факт active call и roster active participants;
- `reader` не получает start/join/end actions.

Клиент не invent'ит более широких прав и не маскирует server denial локальными optimistic допущениями.

### 4. Convergence строится через server-backed refresh по realtime событиям

Выбрана та же честная модель, что и для direct awareness:

- `rtc.call.updated` и `rtc.participant.updated` не считаются финальной локальной мутацией;
- эти события только триггерят `GetActiveCall` и `ListCallParticipants`;
- список групп и текущий group lobby сходятся из authoritative server reads;
- duplicate и слегка reordered realtime events не ломают UI, потому что browser не живёт в invented local call universe.

Для bounded resync используется и периодический refresh, пока active group calls видимы в открытой странице.

### 5. One-active-call-per-user conflict surface остаётся bounded и явным

Если `StartCall` или `JoinCall` отклонены policy `one-active-call-per-user`, group UI показывает отдельное bounded сообщение:

- нельзя начать или join'ить group call, пока пользователь уже участвует в другом активном звонке.

Этот PR не вводит auto-switch, auto-leave и не пытается разрулить multi-call semantics за пользователя.

### 6. Что сознательно остаётся отложенным

После этого PR всё ещё не реализованы:

- реальный group audio media plane;
- group signaling orchestration в web;
- video;
- device controls;
- background continuity, push и PWA;
- call history внутри chat timeline;
- глобальный cross-page/group call manager.

Текущий слайс честно означает только usable group control/lobby surface поверх уже существующего RTC control plane.

## Последствия

### Положительные

- Group calls становятся видимыми и управляемыми в web без расширения backend domain.
- `reader` получает честное observe-only поведение.
- Group list получает bounded discovery path без глобального banner subsystem.
- Архитектура остаётся future-compatible для later multiparty audio/video work.

### Отрицательные

- Пользователь может server-side join'ить group call, но реальный group media transport пока отсутствует.
- Awareness о group calls пока живёт только внутри `GroupsPage`, а не как глобальный shell-wide subsystem.
- Realtime по-прежнему зависит от bounded single-instance transport через `aero-gateway`.

## Альтернативы

### 1. Сразу делать полноценный group audio call UX

Не выбрано, потому что это резко расширяет scope до media plane, device state и более сложной браузерной orchestration.

### 2. Использовать `rtc.signal.received` уже в этом PR

Не выбрано, потому что без реального group media transport это создало бы ложное впечатление о finished multiparty calling.

### 3. Добавить глобальную shell-wide плашку для group calls

Не выбрано, потому что текущему slice нужен compact group-only discovery indicator, а не второй global continuity subsystem рядом с direct calls.
