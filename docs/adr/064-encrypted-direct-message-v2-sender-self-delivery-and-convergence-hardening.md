# ADR-064: Encrypted direct-message v2 sender self-delivery and convergence hardening

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-060`, `ADR-061`, `ADR-062` и `ADR-063` в репозитории уже существуют:

- opaque storage path для encrypted direct-message v2 в `aero-chat`;
- device-aware realtime delivery через `aero-gateway`;
- web local decrypt/render projection внутри crypto runtime boundary;
- первый outbound bootstrap send path для text-only encrypted direct messages.

Одновременно `ADR-063` сознательно оставил узкий и честный gap:

- originating sender device не входил в server-backed per-device delivery roster;
- web runtime показывал только bounded local optimistic projection для этого устройства;
- после reload/reconnect history отправителя зависела от того, сохранился ли локальный optimistic buffer;
- realtime/storage convergence для recipient devices и sender secondary devices уже существовала,
  но originating sender device оставался частичным исключением.

Такое состояние было допустимо как narrow bootstrap send slice,
но больше не подходит как следующий source of truth для encrypted DM v2:

- originating sender device должен сходиться к той же server-backed opaque модели,
  что и остальные устройства;
- convergence не должна возвращать plaintext shadow writes или synthetic plaintext snapshots;
- scope PR при этом должен остаться узким:
  без encrypted media relay, без group E2EE, без MLS, без backup/recovery
  и без claims о полном parity c legacy plaintext direct chat.

## Решение

### 1. Originating sender device становится обычным server-backed delivery target

Для encrypted direct-message v2 originating sender crypto device больше не считается special-case,
живущим только на local optimistic projection.

Новый инвариант:

- `SendEncryptedDirectMessageV2` обязан сохранять per-device opaque delivery
  для всех active devices получателя;
- `SendEncryptedDirectMessageV2` обязан сохранять per-device opaque delivery
  для всех active devices отправителя;
- originating sender device теперь тоже входит в этот persisted delivery roster.

Это не отдельная synthetic self-copy semantics
и не plaintext fallback.

Это тот же самый opaque per-device delivery model из `ADR-060`,
распространённый и на current sending device.

### 2. Self-delivery собирается внутри local crypto runtime, а не через новый plaintext path

Для этого slice не вводится новый server-side self-copy builder
и не вводится отдельный plaintext persistence hack.

Web/runtime делает следующее:

1. использует current active local crypto-device material;
2. собирает self-delivery ciphertext для originating sender device;
3. отправляет этот delivery вместе с recipient deliveries и sender secondary deliveries
   через существующий `SendEncryptedDirectMessageV2`.

Это сохраняет текущие границы:

- private key material не выходит из worker/runtime boundary;
- сервер не шифрует за клиента;
- storage model остаётся opaque и per-device;
- originating sender device получает durable server-backed envelope,
  а не отдельную клиентскую “особую историю”.

### 3. Send bootstrap read model остаётся узким

Для этого PR не вводится новый широкий crypto roster browser
и не расширяется send bootstrap до полного device inventory sentry.

`GetEncryptedDirectMessageV2SendBootstrap` по-прежнему нужен для:

- active devices получателя;
- other active devices отправителя;
- current public bundles этих remote targets.

Originating sender device не обязан дублироваться в bootstrap response,
потому что его self-delivery собирается из уже доступного local active material.

Тем самым bootstrap API остаётся narrow chat-scoped lookup,
а source of truth для sender self-delivery переносится в persisted delivery roster,
а не в ещё один read-side contract.

### 4. Storage/fetch convergence не получает отдельный special-case API

Для originating sender device не вводится новый “self history” endpoint.

Convergence происходит через уже существующую viewer-device-scoped поверхность:

- `ListEncryptedDirectMessageV2(chat_id, viewer_crypto_device_id)`;
- `GetEncryptedDirectMessageV2(chat_id, message_id, viewer_crypto_device_id)`.

Если viewer device является originating sender device
и для него был сохранён persisted self-delivery,
existing opaque fetch/list path обязан вернуть этот envelope.

Следствия:

- reload отправляющего устройства больше не теряет encrypted history только потому,
  что local optimistic buffer исчез;
- sender current device читает своё отправленное сообщение тем же opaque fetch path,
  что и recipient/sender secondary devices;
- storage metadata остаётся минимальной и control-plane-only.

### 5. Realtime semantics остаётся прежним family, но становится полной и для sender origin

Для этого PR не вводится новый realtime family.

Encrypted direct-message v2 по-прежнему использует только:

- `encrypted_direct_message_v2.delivery`

Новая server-backed semantics означает:

- gateway публикует originating sender device его viewer-scoped self-delivery,
  если этот device bound к realtime session;
- payload shape остаётся opaque и viewer-relative;
- plaintext snapshots не возвращаются;
- device-aware semantics не расходится между sender origin, sender secondary и recipient devices.

Realtime остаётся transport supplement,
а storage-backed fetch остаётся source of truth для durable history.

### 6. Local optimistic projection остаётся bounded, но подчиняется authoritative server-backed copy

Bounded optimistic UI для originating sender device остаётся допустимым:

- он даёт immediate feedback после send;
- не пишет plaintext на сервер;
- не создаёт новый storage source of truth.

Но теперь optimistic projection обязана детерминированно уступать authoritative server-backed copy:

- reconcile выполняется по stable logical `message_id` и `revision`;
- при появлении server-backed self-delivery optimistic buffered entry удаляется или игнорируется;
- authoritative decrypt failure не маскируется старой optimistic записью;
- duplicate rendering одного logical encrypted message не допускается.

Следовательно, local optimistic projection становится только временным UX-слоем,
а не длительным substitute для server-backed convergence.

### 7. Coexistence с legacy plaintext direct chat остаётся явным

Этот PR не завершает unified direct-chat timeline.

Сохраняются прежние границы:

- legacy plaintext history остаётся в existing plaintext model;
- encrypted direct-message v2 остаётся отдельной opaque lane;
- один logical message не dual-write’ится как plaintext и ciphertext;
- sender self-delivery hardening не переоткрывает plaintext fallback.

### 8. Честная граница этого slice

Этот PR **решает только**:

- sender-origin server-backed self-delivery для encrypted DM v2;
- durable fetch/reload convergence для current sending device;
- coherent realtime convergence для bound sender device session;
- deterministic merge local optimistic -> authoritative server-backed copy.

Этот PR **не решает**:

- encrypted media relay;
- encrypted reply/edit/search/pin parity;
- encrypted unread/read parity;
- group E2EE / MLS;
- backup/recovery;
- push/PWA;
- RTC;
- full UX parity c legacy plaintext direct chat;
- malicious origin threat.

Следовательно, после `ADR-064` AeroChat всё ещё не должен называться завершённым encrypted messenger.

## Последствия

### Положительные

- Originating sender device больше не зависит только от локального optimistic buffer.
- Encrypted DM v2 convergence становится симметричнее между sender и recipient devices.
- Existing storage/fetch/realtime contracts переиспользуются без plaintext regressions.
- Local optimistic lane остаётся честной и bounded вместо скрытого durable substitute.

### Отрицательные

- Outbound runtime обязан собирать ещё один per-device ciphertext для self-delivery.
- Roster validation в `aero-chat` становится строже: originating sender device теперь обязателен.
- Во frontend требуется явный reconciliation path, чтобы optimistic item не регрессировал более новую server-backed state.

### Ограничения

- Self-delivery всё ещё опирается на текущий bootstrap codec, а не на completed `PQXDH` / `Double Ratchet`.
- Encrypted lane по-прежнему остаётся отдельной от legacy plaintext timeline.
- Авторитетным остаётся только opaque server-backed delivery; это не даёт feature parity для encrypted replies, edits, search или media.

## Альтернативы

### 1. Оставить originating sender device только на local optimistic projection

Не выбрано, потому что это сохраняет remaining convergence gap
и делает reload/reconnect history отправителя зависимой от эфемерного client buffer.

### 2. Добавить отдельный server-side plaintext shadow write для sender history

Не выбрано, потому что это прямо нарушает opaque storage direction `ADR-060`
и возвращает server-readable fallback semantics.

### 3. Ввести новый special-case self-history API

Не выбрано, потому что existing viewer-device-scoped list/get path уже покрывает нужную fetch semantics,
если self-delivery становится persisted first-class delivery record.
