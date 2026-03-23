# ADR-075: Web audio-only direct-call bootstrap поверх существующего RTC control plane

- Статус: Accepted
- Дата: 2026-03-23

## Контекст

После `ADR-074` в репозитории уже существуют:

- `aero-rtc-control` как серверный owner call lifecycle и bounded signal relay;
- `aero-gateway` как единственная внешняя backend edge-точка;
- realtime события `rtc.call.updated`, `rtc.participant.updated`, `rtc.signal.received`;
- рабочий web direct-chat surface в `apps/web`.

Следующий изолированный slice должен дать первый реальный browser call UX, но не раздувать PR до:

- group calls;
- video;
- device picker и output controls;
- push / missed-call / ringing platform;
- SFU, media relay backend и TURN/STUN orchestration platform;
- ложных claims про finished call subsystem или final call security model.

Нужно одновременно соблюсти уже принятые инварианты:

- direct chats остаются отдельным narrow product surface;
- source of truth для call lifecycle остаётся у `RtcControlService`, а не у browser-local state;
- browser использует стандартный WebRTC transport без самодельной криптографии;
- web UI не должен ломать существующий direct chat flow и не должен превращаться в telephony platform.

## Решение

### 1. Первый web call slice фиксируется как direct-only и audio-only

В этом PR web-клиент поддерживает только:

- direct chats;
- 1:1 calls;
- microphone capture;
- browser peer-to-peer audio transport.

Сознательно не реализуются:

- group call UI и group join flow;
- video capture/send;
- screen share;
- device picker;
- output gain/mute/camera platform;
- missed-call history и notifications;
- global one-active-call-per-user policy.

Это минимальный usable продуктовый slice без размытия scope.

### 2. Web reuse'ит существующий RTC control plane без нового backend слоя

Web-клиент использует уже существующие RPC:

- `GetActiveCall`;
- `StartCall`;
- `JoinCall`;
- `LeaveCall`;
- `EndCall`;
- `ListCallParticipants`;
- `SendSignal`.

И уже существующие realtime события:

- `rtc.call.updated`;
- `rtc.participant.updated`;
- `rtc.signal.received`.

Новый frontend не вводит parallel fetch contract, не создаёт второй signaling transport и не переносит lifecycle ownership в browser.

### 3. UI surface остаётся компактным внутри текущего direct chat

Выбранный продуктовый surface:

- compact call card в hero area текущего direct thread;
- явная кнопка `Позвонить`, если active call отсутствует;
- `Присоединиться` / `Вернуться в звонок`, если active call уже существует;
- compact in-call status, peer presence, bounded error state и `Покинуть` / `Завершить звонок`;
- скрытый `audio` element для remote playback.

Выбор сделан потому, что:

- direct chat уже является естественным conversation scope для 1:1 call;
- пользователю не нужен отдельный тяжёлый call screen для первого slice;
- chat timeline и composer остаются usable во время звонка.

### 4. Peer-connection model остаётся page-scoped и односессионным

Для active joined direct call в текущей странице создаётся:

- один `RTCPeerConnection`;
- один local `MediaStream` только с audio tracks;
- один remote `MediaStream` для playback.

Поведение:

- local audio track добавляется через `addTrack()`;
- remote audio рендерится через реальный `HTMLAudioElement`;
- при уходе peer'а peer connection закрывается, но lifecycle сервера остаётся source of truth;
- при уходе пользователя из текущего direct-chat scope page-scoped session покидает call best-effort через `LeaveCall`.

Это сознательно page-scoped bootstrap, а не глобальная multi-call telephony subsystem.

### 5. Signaling flow остаётся простым и server-backed

Принят следующий flow:

- инициатор делает `StartCall`;
- joiner делает `JoinCall`;
- browser создаёт `offer` только когда второй participant уже активен серверно;
- `offer`, `answer` и `ice_candidate` сериализуются в opaque JSON-over-bytes payload и уходят через `SendSignal`;
- входящий signaling приходит только через `rtc.signal.received`;
- server-backed `call` и `participants` регулярно re-sync'ятся через realtime-triggered refresh и bounded polling, чтобы browser не жил в fantasy state.

Для первого slice creator call выступает designated offerer, чтобы избежать лишней browser-side glare-логики.

### 6. Permission и failure handling фиксируются как bounded degradation

Перед `StartCall` / `JoinCall` web-клиент сначала проверяет browser capability и пытается получить:

```ts
navigator.mediaDevices.getUserMedia({ audio: true })
```

Если это не удалось, UI показывает bounded ошибку и не оставляет server-backed join/start side effects.

Явно обрабатываются:

- неподдерживаемый browser API;
- insecure context;
- permission denied;
- отсутствие microphone device;
- gateway/RPC failure;
- signaling apply/send failure;
- peer connection failure;
- server-ended call;
- realtime reconnect через bounded resync.

### 7. Что остаётся отложенным

Этот ADR сознательно не объявляет реализованными:

- full call subsystem;
- durable call recovery across reloads;
- NAT traversal platform;
- TURN/STUN operator model;
- background ringing semantics;
- push notifications;
- call history в chat;
- device controls;
- group/video call UX;
- любые claims про full E2EE call semantics.

Текущий slice честно означает только:

- web direct chat может стартовать или join'ить active audio call;
- браузер поднимает реальный 1:1 WebRTC audio peer connection там, где ICE может сойтись в текущих сетевых условиях;
- call lifecycle продолжает сходиться через текущий RTC control plane.

## Последствия

### Положительные

- У проекта появляется первый реальный user-facing RTC slice без нового backend scope.
- Direct chats получают usable audio-call bootstrap поверх уже готового control plane.
- Архитектура остаётся future-compatible для later group/video/device work.
- UI остаётся компактным и не ломает основной chat workflow.

### Отрицательные

- Page-scoped session сознательно не даёт seamless continuity при navigation/reload.
- Signaling остаётся без durable replay и зависит от bounded realtime transport.
- Без отдельной NAT traversal platform не обещается одинаковая успешность звонка во всех сетях.

## Альтернативы

### 1. Сразу строить отдельный полноэкранный call UI subsystem

Не выбрано, потому что это резко расширяет scope и смешивает первый usable slice с полировкой.

### 2. Сразу включить group calls и video в тот же PR

Не выбрано, потому что это нарушает правило одного изолированного slice и усложняет state model, UI и тестирование.

### 3. Добавить новый backend media/signaling слой специально для web

Не выбрано, потому что нужный control plane уже существует, а media plane в этом этапе не нужен.

### 4. Объявить calls “готовыми” после первого browser bootstrap

Не выбрано, потому что это было бы ложным claim'ом: отсутствуют policy, recovery, notifications, device controls и дальнейшая media/network hardening.
