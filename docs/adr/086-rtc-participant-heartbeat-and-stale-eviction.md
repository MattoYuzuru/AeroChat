# ADR-086: RTC participant heartbeat и server-backed stale eviction для direct calls

- Статус: Accepted
- Дата: 2026-03-29

## Контекст

После `ADR-074`, `ADR-075`, `ADR-076`, `ADR-077` и `ADR-085` у проекта уже есть usable direct audio-call slice:

- `aero-rtc-control` владеет active call и participant lifecycle;
- web умеет start/join/rejoin direct call и держит bounded continuity внутри открытой app session;
- browser direct-call runtime уже получил voice-oriented capture/tuning, bounded reconnect recovery и TURN/STUN runtime contract.

Но в control-plane оставался важный operational gap:

- если вкладка или браузер закрывались жёстко, best-effort `LeaveCall` мог не уйти;
- active participant record оставался `active` бесконечно долго;
- stale call блокировал `one-active-call-per-user` policy из `ADR-077`;
- следующий `StartCall` / `JoinCall` мог получать ложный conflict, хотя живого звонка уже нет;
- direct-call awareness могла продолжать показывать call, который фактически умер вместе со страницей.

Нужен следующий изолированный slice, который уберёт этот stale-runtime gap, но не раздует scope до:

- нового media-plane backend;
- cluster-wide background scheduler;
- отдельного distributed heartbeat bus;
- redesign всей call model.

## Решение

### 1. Web вводит явный lightweight heartbeat для active participant

В `rtc/v1` добавляется отдельный RPC:

- `TouchCallParticipant`.

Web вызывает его только пока текущая страница действительно локально участвует в active call.

Heartbeat остаётся:

- минимальным по payload;
- независимым от `ListCallParticipants`/`GetActiveCall`;
- существенно дешевле, чем повторный polling полного call snapshot.

### 2. `aero-rtc-control` получает server-backed stale timeout для active participant

В runtime конфигурации сервиса вводится timeout:

- `AERO_RTC_ACTIVE_PARTICIPANT_STALE_TIMEOUT`

с безопасным default `75s`.

Если active participant не обновлял свою activity дольше этого окна, он считается stale.

### 3. Authoritative liveness остаётся в RTC control plane

Heartbeat не решается только на клиенте.

`aero-rtc-control` сам authoritative определяет stale participant и переводит его из `active` в `left`.

Если после такого eviction active participants больше не осталось, call автоматически завершается с уже существующей причиной:

- `last_participant_left`.

### 4. Eviction выполняется opportunistic, а не через отдельный background sweeper

Для текущего single-server/Postgres runtime выбран консервативный путь:

- stale participants вычищаются во время значимых RTC операций;
- это применяется в `GetActiveCall`, `GetCall`, `StartCall`, `JoinCall`, `LeaveCall`, `EndCall`, `ListCallParticipants`, `SendSignal` и `TouchCallParticipant`;
- если stale participant мешает `one-active-call-per-user`, conflict сначала вычищается, а уже потом принимается решение о новом call.

Это даёт нужную product-correctness без отдельного daemon/scheduler slice.

### 5. Для activity reuse'ится существующий participant touch path

В этом slice не вводится отдельная новая persistence schema только ради heartbeat telemetry.

Authoritative cutoff для stale eviction считается по participant activity timestamp, который обновляется:

- при RTC signaling;
- при explicit `TouchCallParticipant`.

Этого достаточно для current direct-call bootstrap и не требует миграции call model.

## Последствия

### Положительные

- Жёстко закрытая вкладка больше не может удерживать stale active call бесконечно.
- `one-active-call-per-user` больше не блокируется stale participant хвостами.
- Direct-call awareness быстрее сходится с реальным состоянием control-plane.
- Heartbeat остаётся лёгким и не превращает RTC runtime в polling-heavy UI.

### Отрицательные

- В web появляется дополнительный периодический control-plane запрос для локально joined call.
- Слишком агрессивный stale timeout мог бы убивать живой звонок, поэтому значение приходится держать консервативным.
- Cleanup после crash остаётся не мгновенным fallback path: authoritative eviction происходит по timeout, если `pagehide` cleanup не дошёл.

## Что сознательно не делается

- cluster-wide scheduler или отдельный cleanup worker;
- новый durable audit/history слой для heartbeat events;
- device-level multi-tab arbitration beyond current one-active-call-per-user policy;
- новый transport для media health metrics;
- group/video-specific stale policy.

## Альтернативы

### 1. Оставить только browser `beforeunload` / `pagehide` cleanup

Не выбрано, потому что жёсткое закрытие браузера, crash процесса и tab discard не гарантируют delivery `LeaveCall`.

### 2. Делать stale cleanup только через клиентский polling

Не выбрано, потому что stale tabs и несколько клиентов не могут быть authoritative source of truth для active participant lifecycle.

### 3. Ввести отдельный background sweeper сразу

Не выбрано, потому что текущему single-server runtime достаточно opportunistic eviction на уже существующих RTC operations, а отдельный scheduler увеличил бы scope PR.

### 4. Добавить отдельную новую БД-колонку только для heartbeat timestamp

Не выбрано, потому что в текущем slice authoritative participant activity уже можно выразить через существующий touch/update path без расширения schema и без новой domain сущности.
