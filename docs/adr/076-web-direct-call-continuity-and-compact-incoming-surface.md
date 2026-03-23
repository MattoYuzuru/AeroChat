# ADR-076: Direct-call continuity, reconnect convergence и компактный incoming-call surface в web

- Статус: Accepted
- Дата: 2026-03-23

## Контекст

После `ADR-075` в репозитории уже есть рабочий direct-only audio-call bootstrap:

- `RtcControlService` остаётся source of truth для active call lifecycle;
- web умеет start/join/leave/end direct call внутри открытого direct thread;
- realtime уже доставляет `rtc.call.updated`, `rtc.participant.updated` и `rtc.signal.received`.

Но первый usable slice сознательно был page-scoped и узким:

- при уходе из active direct thread локальный session teardown сопровождался best-effort `LeaveCall`;
- knowledge об active call практически исчезало вне текущего thread;
- reconnect/rejoin поведение было честным, но слишком хрупким для следующего продуктового шага;
- пользователь внутри открытой сессии приложения мог не заметить уже активный direct call, если нужный thread сейчас не открыт.

Следующий изолированный slice должен улучшить continuity и заметность существующих 1:1 audio calls, но не раздувать scope до:

- group calls;
- video;
- device picker и output controls;
- push/PWA/background ringing;
- full reload continuity claims;
- durable signaling replay;
- нового backend call history или новой transport architecture.

## Решение

### 1. Следующий RTC slice фиксируется как direct-call polish, а не group/video expansion

Приоритетом становится не новый feature breadth, а product credibility уже shipped direct audio-call bootstrap:

- server-backed convergence после reconnect и thread churn;
- видимость active call вне текущего thread;
- явный bounded rejoin/return path;
- suppression stale UI после server-ended call.

Group/video/device/push work остаются отдельными будущими slices.

### 2. В web вводится минимальный shared layer для server-backed awareness об active direct calls

Frontend получает небольшой app-level state только для direct calls.

Этот слой хранит:

- active direct call awareness, ключом по `direct_chat_id`;
- latest server-backed participants для active call;
- локально dismissed visual surface для конкретного `call_id`.

Этот слой не хранит:

- глобальный media session runtime;
- глобальный peer connection;
- клиентский invented call universe;
- durable replay пропущенных signals.

Local media session и `RTCPeerConnection` остаются page-scoped внутри открытого direct thread.

### 3. Continuity model меняется: при уходе из direct thread рвётся только local media runtime

Новая консервативная policy:

- при уходе из активного direct thread web teardown'ит local `MediaStream` и `RTCPeerConnection`;
- browser больше не делает автоматический best-effort `LeaveCall` только из-за смены thread route;
- server-backed participant и active call awareness продолжают жить по правилам `RtcControlService`;
- пользователь получает явный быстрый путь вернуться в thread и заново выполнить bounded join/rejoin.

Это означает:

- continuity внутри открытой app session становится честно лучше;
- full seamless continuity через browser reload по-прежнему не обещается;
- локальный media runtime не притворяется глобальной telephony subsystem.

### 4. Incoming/active-call surface выбирается как компактная in-app плашка в shell

Для открытой web session добавляется bounded surface:

- компактная плашка в shell;
- только для direct calls;
- видна, когда active direct call существует, а соответствующий direct thread сейчас не открыт.

Плашка показывает:

- какой direct chat затронут;
- что active call существует;
- действия `Открыть чат`, `Присоединиться` или `Вернуться в звонок`;
- локальное `Скрыть` только для visual surface текущего `call_id`.

Эта плашка не считается OS-level ringing, не требует push и не перехватывает весь shell.

### 5. Rejoin/return behavior фиксируется как explicit и bounded

В рамках этого slice:

- если active call уже существует, но пользователь ещё не joined, UI показывает явный `Присоединиться`;
- если active call существует, а local media/peer runtime уже teardown'нут, UI показывает явный `Вернуться в звонок`;
- route intent из compact surface может открыть нужный direct thread и сразу инициировать bounded join;
- `JoinCall` остаётся server-backed и может использоваться как безопасный rejoin path даже если active participant record уже существует.

### 6. Realtime reconnect convergence строится через bounded refresh, а не через локальные догадки

При reconnect realtime web делает bounded refresh active direct-call awareness:

- refresh запускается на `realtime.connected`;
- `rtc.call.updated` и `rtc.participant.updated` не применяются как окончательная client-only мутация, а триггерят server-backed refresh;
- ended call удаляется из global awareness и из compact surface после server convergence;
- duplicate или слегка reordered participant events не должны ломать UI state machine, потому что source of truth снова читается с сервера.

`rtc.signal.received` остаётся bounded ephemeral signaling path и не получает durable replay semantics.

### 7. Что сознательно остаётся отложенным

Этот slice по-прежнему не объявляет реализованными:

- group call continuity;
- video;
- device picker/output controls;
- push notifications и background ringing;
- missed-call history;
- one-active-call-per-user policy;
- PWA/offline continuity;
- durable signaling replay;
- full continuity across browser reload.

## Последствия

### Положительные

- Active direct call теперь заметен глобально внутри открытой web session.
- Thread switching перестаёт автоматически выбрасывать пользователя из server-backed call lifecycle.
- Reconnect и duplicate realtime events сходятся через сервер, а не через fragile local assumptions.
- Direct thread получает честкий explicit return path после teardown local media runtime.

### Отрицательные

- Пользователь может остаться server-side active participant без живого local media runtime, пока явно не вернётся в thread.
- Web по-прежнему не обещает seamless continuity после полного reload.
- Глобальный compact surface добавляет ещё один небольшой app-level state slice, который придётся дальше держать узким.

## Альтернативы

### 1. Сохранить старую policy с автоматическим `LeaveCall` при уходе из thread

Не выбрано, потому что это делает continuity слишком хрупкой и ломает usability даже внутри одной открытой сессии приложения.

### 2. Построить полноценный глобальный call screen и global media runtime уже сейчас

Не выбрано, потому что это резко расширяет scope и превращает узкий direct-call polish в телефонийный subsystem.

### 3. Сразу делать push/ringing/PWA continuity

Не выбрано, потому что это другой platform slice с отдельными ограничениями, delivery model и ожиданиями пользователя.

### 4. Попробовать восстановить всё бесшовно после reload и reconnect без явного rejoin

Не выбрано, потому что такой claim пока не подтверждён существующей page-scoped browser media model и bounded signaling transport.
