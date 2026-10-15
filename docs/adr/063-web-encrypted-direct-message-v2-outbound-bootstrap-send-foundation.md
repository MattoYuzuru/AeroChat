# ADR-063: Web encrypted direct-message v2 outbound bootstrap send foundation

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-060`, `ADR-061` и `ADR-062` в репозитории уже существуют:

- opaque storage path для encrypted direct-message v2 в `aero-chat`;
- device-aware realtime delivery через `aero-gateway`;
- web crypto runtime с worker boundary и local decrypt/render projection;
- отдельная локальная encrypted lane в web direct chat без скрытого merge с legacy plaintext history.

Одновременно encrypted direct-message v2 всё ещё оставался read-only foundation:

- web-клиент умел получать и локально расшифровывать opaque envelopes;
- но не умел сам собирать outbound encrypted payload внутри crypto runtime;
- не имел минимального chat-scoped lookup для active target crypto devices и их public bundles;
- не мог отправить реальное encrypted DM v2 через уже существующий `SendEncryptedDirectMessageV2`.

Следующий slice должен закрыть только этот gap:

- дать первый реальный outbound encrypted DM v2 send path в web-клиенте;
- не возвращать server-side plaintext projection;
- не делать ложный claim о завершённом `PQXDH` / `Double Ratchet`;
- не смешивать текстовый bootstrap send с encrypted media relay, group E2EE, MLS, backup/recovery или полной parity c legacy composer.

## Решение

### 1. Outbound assembly остаётся внутри crypto runtime boundary

Web-клиент больше не собирает encrypted DM v2 payload в обычном React/UI state.

Outbound flow фиксируется так:

1. UI передаёт в worker только узкий send intent: `chat_id` и text payload.
2. Crypto runtime внутри worker:
   - проверяет наличие active local crypto device;
   - получает минимальный send bootstrap roster/public bundles;
   - генерирует stable logical `message_id`;
   - собирает versioned bootstrap payload;
   - шифрует per-target-device opaque deliveries;
   - отправляет их через существующий `SendEncryptedDirectMessageV2`.
3. Main thread получает только result/projection формы без raw private key material.

Private key material не выходит из runtime boundary.

### 2. Для этого PR send path остаётся text-only bootstrap slice

Первая outbound реализация intentionally ограничивается только:

- `operation_kind = content`;
- text payload;
- `MARKDOWN_POLICY_SAFE_SUBSET_V1`.

Этот PR сознательно не добавляет outbound support для:

- encrypted attachments/media;
- encrypted reply send;
- encrypted edit/tombstone send;
- unified encrypted composer parity.

Такой scope выбран, чтобы получить маленький, честный и реально работающий outbound slice вместо размытой “почти полной” реализации.

### 3. Target roster остаётся явным и согласованным с storage foundation

Outbound encrypted DM v2 обязан таргетировать:

- все active crypto devices получателя;
- все other active crypto devices отправителя.

При этом originating sender device сохраняет уже зафиксированную semantics:

- сервер не создаёт для него synthetic self-delivery copy;
- server-backed target roster по-прежнему исключает device, с которого инициирован send.

Это сохраняет совместимость с `ADR-060` и `ADR-061` и не меняет storage contract “по дороге”.

### 4. Нужен отдельный narrow send-bootstrap lookup

Если клиент должен сам собрать per-device ciphertext, ему нужен явный read model с:

- active target crypto devices;
- current public bundle material этих устройств.

Для этого вводится отдельный chat-scoped send-bootstrap API, который:

- работает только в контексте существующего direct chat;
- возвращает только public bundle material;
- не становится общим crypto directory browser;
- не открывает произвольный roster lookup вне реального peer relationship и own-account device set.

Lookup обязан возвращать именно тот roster, который потом ожидает `SendEncryptedDirectMessageV2`,
чтобы web runtime не собирал envelope для “примерно похожего” набора устройств.

### 5. Bootstrap codec остаётся честным промежуточным слоем

Outbound send использует текущий versioned bootstrap codec:

- versioned transport header;
- versioned payload schema;
- per-target-device asymmetric bootstrap encryption;
- явный AAD с message/chat/device metadata.

Этот codec предназначен только для bounded outbound/inbound compatibility текущих slices.

Он **не** объявляется:

- полноценным `PQXDH`;
- полноценным `Double Ratchet`;
- финальной multi-device session management implementation.

### 6. Originating sender device получает local optimistic projection

Так как originating sender device не входит в server-side delivery roster,
он не может ждать собственного server-delivered ciphertext для показа только что отправленного сообщения.

Поэтому для текущего slice вводится честное правило:

- server-backed storage/realtime остаются source of truth для recipient devices и sender secondary devices;
- originating sender device публикует только bounded local optimistic projection из того же payload, который был собран внутри worker;
- это не является plaintext shadow write и не создаёт server-readable fallback.

Тем самым UI получает immediate local result без нарушения storage semantics.

### 7. Coexistence с legacy plaintext direct chat остаётся явным

Legacy plaintext direct chat flow сохраняется как отдельный path:

- обычный `sendTextMessage` не удаляется;
- encrypted DM v2 send остаётся отдельным explicit action;
- один logical message не dual-write’ится как plaintext и ciphertext;
- encrypted lane и legacy timeline продолжают жить раздельно.

## Уточнение 12 октября 2026: совместимость timestamp в AAD

Статус уточнения: Accepted — координатор проверил границы совместимости до реализации
по [#178](https://github.com/MattoYuzuru/AeroChat/issues/178).
Уточнение сохраняет local projection из [ADR-062](062-web-encrypted-direct-message-v2-local-projection-foundation.md)
и серверный порядок из [ADR-096](096-encrypted-conversation-server-sequence.md).

### Контекст и подтверждённая граница

Исторический web sender передаёт `createdAt` в UTC ISO-форме с тремя цифрами
миллисекунд и включает эту строку в AAD. Timestamp transport сохраняет момент
времени, но его строковые представления могут различаться. На integration
`9e43df6` отдельная проверка двух реальных аккаунтов `check-maef1px9` сохранила
один message witness: request и HTTP envelope содержали `.170Z`, realtime envelope —
`.17Z`. Receiver показал integrity error; один UI reload с HTTP representation
восстановил projection. Проверка не меняла ключи или ciphertext.

Полная browser core04 остаётся FAIL на изображении после 15 успешных этапов.
Исходный realtime envelope этого изображения не сохранён: controlled witness
подтверждает причину отдельного воспроизведения, а не успешное прохождение core04.
Одно исправление realtime formatter не покрывает history HTTP representation
whole-second timestamp без `.000`.

### Принятое правило декодирования

1. Existing raw metadata AAD authentication выполняется первым без изменений.
   Успех raw attempt не запускает совместимость. Ошибка payload/schema/recipient
   validation или ошибка другого вида не запускает дополнительный attempt.
2. Только после `DOMException` с именем `OperationError` допускается не более
   одного distinct candidate для `createdAt`, восстанавливающего историческую
   UTC ISO-форму web sender с тремя цифрами миллисекунд. Каждый attempt выполняет
   полную существующую AES-GCM authentication; plaintext fallback не вводится.
3. Candidate допустим только для точного формата
   `YYYY-MM-DDTHH:mm:ss[.fraction]Z`: четыре цифры года `0001`–`9999`, корректная
   григорианская дата, часы `00`–`23`, минуты/секунды `00`–`59`, uppercase `Z`,
   fraction отсутствует либо содержит от одной до девяти decimal digits.
   Offset, leap second, year `0000`, extended year, calendar rollover,
   whitespace и иная syntax не создают candidate.
4. Instant должен быть точно представим миллисекундами: все fractional digits
   после первых трёх должны быть нулевыми. Fraction дополняется справа до трёх
   цифр или удаляет только лишние нули: `.12` → `.120`, `Z` → `.000Z`,
   `.120000` → `.120`. Nonzero sub-millisecond digits не округляются и не
   отбрасываются. Если candidate равен raw, второго attempt нет.
5. Все остальные AAD fields и порядок JSON сохраняются. Исходный envelope не
   мутируется; ready projection сохраняет received metadata, а descriptor callback
   вызывается только после полного success и ровно один раз. Timestamp instant,
   message/chat/sender/device/recipient/operation/target/revision bindings нельзя
   заменить другим значением для успешной расшифровки.
6. Неуспех обоих attempts возвращает существующее статическое integrity/decrypt
   failure. Alternate keys/devices, persisted plaintext retry state и raw crypto
   logging не добавляются. Верхняя граница — два codec attempts на envelope.

Это правило не меняет sender encoding, алгоритмы, ключи, AAD fields, payload или
transport schema, backend, storage и sequence. Helper не является новым общим
timestamp validator: прежний raw путь сохраняется, а invalid input не получает
нового compatibility acceptance. Существующие whole-second или sub-millisecond
ciphertexts, которые успешно проходят raw authentication, продолжают работать.

### Последствия и обязательная проверка

Совместимость ограничена известной исторической web representation того же
authenticated millisecond instant. Общий claim о полном encrypted messenger,
ratchet или MLS не меняется. Additive raw timestamp field и миграция ciphertext
не входят в этот slice.

До приёмки требуются production codec regressions для direct и group, включая
raw success, `.120Z` → `.12Z`, `.000Z` → `Z`, coherent group unwrap/payload,
изменённый instant/context/ciphertext, strict calendar/sub-millisecond matrix,
attempt bound и callback once. Transport regression использует actual gateway
formatter и ProtoJSON marshal, а не их handwritten imitation. Fresh frozen web
gates и новый exact-runtime browser core/media run подтверждаются отдельно;
принятие этого уточнения не является implementation или PASS.

## Последствия

### Положительные

- Web-клиент впервые получает реальный outbound encrypted DM v2 send path.
- Message assembly и per-device encryption остаются внутри crypto runtime boundary.
- Target roster и public bundles становятся явно доступными ровно в том объёме, который нужен для direct-message outbound.
- Existing opaque intake/storage/realtime foundation начинает использоваться end-to-end.

### Отрицательные

- Во frontend появляется ещё один bounded path: local optimistic projection для originating sender device.
- Composer semantics временно расходятся: legacy plaintext path шире, encrypted path уже и честнее.
- Public send-bootstrap lookup добавляет ещё один explicit read model в chat surface.

### Ограничения

- Этот PR не добавляет encrypted media relay.
- Этот PR не восстанавливает encrypted reply/edit/pin/search parity.
- Этот PR не добавляет unread/read parity для encrypted lane.
- Этот PR не делает group E2EE / MLS.
- Этот PR не делает backup/recovery.
- Этот PR не защищает от malicious origin, который отдаёт подменённый web bundle.

Следовательно, после `ADR-063` AeroChat всё ещё не должен называться завершённым encrypted messenger.

## Альтернативы

### 1. Подождать полного protocol completion и не делать outbound send сейчас

Не выбрано, потому что тогда уже реализованные storage/realtime/projection slices оставались бы без real send path и без end-to-end проверки web runtime assembly.

### 2. Добавить server-side self-copy для originating sender device

Не выбрано, потому что это меняло бы уже зафиксированную storage/realtime semantics и расширяло бы scope beyond narrow outbound bootstrap slice.

### 3. Сразу пытаться дать feature parity с legacy plaintext composer

Не выбрано, потому что это смешало бы text send, reply, edit, attachments/media и UX merge в одном PR,
что противоречит требованию держать slice изолированным и честным.
