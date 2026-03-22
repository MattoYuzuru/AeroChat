# ADR-061: Device-aware gateway transport для encrypted direct-message v2

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-055`, `ADR-056`, `ADR-057`, `ADR-058`, `ADR-059` и `ADR-060` в репозитории уже существуют:

- `crypto-device registry` и proof-bound lifecycle в `aero-identity`;
- web runtime с persistent local `crypto_device_id`;
- encrypted direct-message v2 intake и opaque storage foundation в `aero-chat`;
- gateway-only внешний realtime edge, который до этого PR оставался только user-scoped;
- legacy plaintext realtime families для direct chats и groups.

Одновременно encrypted direct-message v2 всё ещё не имел честного live transport слоя:

- websocket-сессия знала только account auth, но не конкретный local `crypto_device_id`;
- gateway не мог различать несколько active crypto devices одного аккаунта;
- `direct_chat.message.updated` публиковал plaintext-style snapshot и не подходил для device-targeted ciphertext;
- `SendEncryptedDirectMessageV2` сохранял opaque deliveries, но не имел device-aware realtime fanout;
- web runtime не умел явно привязывать realtime transport к active local crypto device.

Нужен следующий узкий implementation slice, который:

- остаётся backend-first;
- не внедряет decrypt/render UX;
- не смешивает encrypted DM transport с media relay, MLS, recovery или unread parity;
- честно отделяет device-scoped ciphertext delivery от legacy plaintext realtime.

## Решение

### 1. Realtime session binding становится явным шагом

Аутентифицированная websocket-сессия через `aero-gateway` больше не считается достаточной для encrypted direct-message v2 transport.

Для участия в encrypted DM v2 realtime session обязана пройти отдельный explicit bind шаг:

1. websocket проходит обычную account authentication;
2. клиент получает `connection.ready`;
3. клиент отправляет узкий control event `connection.bind_crypto_device`;
4. gateway проверяет через `aero-identity`, что:
   - `crypto_device_id` принадлежит текущему аккаунту;
   - `crypto_device_id` имеет статус `active`;
5. только после этого websocket-сессия попадает в device-scoped bucket для encrypted DM v2 delivery.

Binding intentionally остаётся отдельным и явным.
Не вводится скрытая автоматическая связь `auth session -> crypto device`.

### 2. Gateway realtime остаётся gateway-only, но становится device-aware

`Aero-gateway` остаётся единственным публичным realtime edge.

При этом transport для encrypted direct-message v2 больше не строится только на `PublishToUser`.

Внутри realtime hub вводятся две разные области доставки:

- `user-scoped` buckets для legacy plaintext direct/group событий и control-plane сигналов;
- `crypto-device-scoped` buckets для encrypted direct-message v2 envelope delivery.

Это позволяет сохранить текущую topology без отдельного публичного сервиса и без user-level ciphertext fanout.

### 3. Для encrypted DM v2 вводится отдельный realtime family

Encrypted direct-message v2 использует отдельный narrow realtime family:

- `encrypted_direct_message_v2.delivery`

Этот family доставляет только opaque/control-plane payload:

- `message_id`;
- `chat_id`;
- `sender_user_id`;
- `sender_crypto_device_id`;
- `operation_kind`;
- `target_message_id`;
- `revision`;
- `created_at`;
- `stored_at`;
- viewer-relative delivery payload:
  - `recipient_crypto_device_id`;
  - `transport_header`;
  - `ciphertext`;
  - `ciphertext_size_bytes`;
  - `stored_at`.

Gateway не публикует для encrypted path:

- plaintext body;
- `reply_preview`;
- render-ready attachment metadata;
- legacy `direct_chat.message.updated` snapshot.

### 4. Live delivery использует already accepted opaque payload, а storage остаётся source of truth

После успешного `SendEncryptedDirectMessageV2` gateway публикует realtime delivery только для тех `recipient_crypto_device_id`,
которые уже сохранены как accepted per-device opaque deliveries в `aero-chat`.

Практически это означает:

- authoritative write остаётся в `aero-chat`;
- gateway публикует envelope только после успешного downstream `SendEncryptedDirectMessageV2`;
- routing идёт по exact requested per-device deliveries, которые уже прошли downstream validation и storage write;
- offline delivery продолжает оставаться storage-backed, а не обещается как fully reliable realtime retry system.

Для storage-backed чтения encrypted DM v2 сохраняется отдельный explicit fetch surface:

- list path по `viewer_crypto_device_id`;
- narrow get path по `chat_id + message_id + viewer_crypto_device_id`.

Тем самым gateway может работать как thin transport/router и не превращается в новый source of truth для encrypted history.

### 5. Fanout semantics фиксируются узко и честно

Минимальные realtime guarantees этого slice:

- target recipient devices с active bound websocket session получают свои opaque deliveries без polling;
- другие active devices отправителя тоже получают свои targeted copies, если для них есть bound websocket session;
- originating sender device не получает synthetic server-delivery copy, если она не была частью v2 roster;
- offline устройства читают envelope позже через storage-backed fetch/list path.

Этот slice не объявляет завершёнными:

- guaranteed retry/ack convergence;
- unread/read parity для encrypted path;
- decrypt/render consistency;
- history recovery после reconnect beyond explicit fetch path.

### 6. Minimal web compatibility ограничивается runtime orchestration

В `apps/web` добавляется только минимальная совместимость:

- после `connection.ready` runtime пытается явно bind’ить active local `crypto_device_id`;
- runtime принимает `encrypted_direct_message_v2.delivery`;
- opaque events складываются в bounded runtime buffer для later decrypt/render bootstrap.

Этот slice сознательно не добавляет:

- conversation UI для encrypted DM;
- client decrypt/render;
- local decrypted projection;
- encrypted reply/edit/search UX.

### 7. Coexistence с legacy plaintext transport сохраняется

Legacy plaintext direct-chat realtime сохраняется без архитектурного смешения:

- legacy plaintext direct messages продолжают использовать `direct_chat.message.updated`;
- encrypted DM v2 использует только новый device-aware family;
- gateway не dual-write’ит один и тот же logical message как plaintext snapshot и encrypted envelope;
- существующий plaintext chat UX не ломается.

## Последствия

### Положительные

- Realtime transport впервые становится совместимым с multi-device encrypted DM v2 моделью.
- Gateway перестаёт делать вид, что user-scoped snapshot подходит для ciphertext delivery.
- Web runtime получает явную точку связки `active local crypto_device_id <-> websocket session`.
- Legacy plaintext realtime и encrypted DM v2 transport остаются честно разделёнными.

### Отрицательные

- Realtime hub усложняется из-за явного bind шага и device-scoped routing buckets.
- У encrypted DM v2 появляется ещё один orchestration step, который нужно пройти после websocket connect.
- Storage-backed fetch и live realtime пока остаются узкими и не дают полной post-reconnect convergence story.

### Ограничения

- Этот slice не делает AeroChat “готовым encrypted messenger”.
- Gateway transport по-прежнему не решает decrypt/render и local projection.
- Realtime binding зависит от того, что local crypto runtime уже знает свой active `crypto_device_id`.
- Cross-user live delivery не становится универсальным internal event bus; gateway остаётся thin edge transport.

## Non-goals ADR-061

Этот ADR сознательно не определяет и не реализует:

- client-side decrypt/render conversation UX;
- encrypted unread/read parity;
- encrypted reply/edit/pin/search recovery;
- encrypted media relay;
- MLS / group E2EE;
- backup/recovery;
- push/PWA;
- RTC signaling.

## Альтернативы

### 1. Не вводить отдельный bind шаг и implicitly связывать websocket с auth session

Не выбрано, потому что это ломает инвариант `account auth != crypto trust/device context`
и делает device routing неявным и нетестируемым.

### 2. Перегрузить `direct_chat.message.updated` и передавать туда ciphertext

Не выбрано, потому что это смешивает legacy plaintext snapshot semantics с новым opaque encrypted path.

### 3. Считать transport завершённым без minimal web/runtime bind и buffer path

Не выбрано, потому что тогда backend slice не имел бы честной точки интеграции с local `crypto_device_id`
и всё равно потребовал бы later hidden compatibility hacks.
