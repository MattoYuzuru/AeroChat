# ADR-062: Web encrypted direct-message v2 local projection foundation

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-057`, `ADR-060` и `ADR-061` в репозитории уже существуют:

- web crypto runtime с worker boundary и persistent local crypto-device material;
- opaque storage/fetch path для encrypted direct-message v2;
- device-aware realtime delivery для encrypted direct-message v2;
- legacy plaintext direct-chat UX, который по-прежнему живёт отдельной server-readable моделью;
- только raw web buffer для opaque encrypted realtime events, но без client-side decrypt/render и без bounded local projection.

Следующий изолированный slice должен впервые сделать encrypted direct-message v2 видимым в web-клиенте,
не разрушая архитектурные границы и не притворяясь готовым encrypted messenger parity.

Этот slice обязан:

- расшифровывать encrypted direct-message v2 только внутри crypto runtime boundary;
- строить bounded local decrypted projection только на клиенте;
- использовать existing storage fetch и device-aware realtime delivery;
- честно сосуществовать с legacy plaintext direct chat;
- явно зафиксировать, что media, group E2EE, search, reply/edit/pin parity и backup/recovery ещё не восстановлены.

## Решение

### 1. Веб-клиент получает отдельную local decrypted projection для encrypted DM v2

Для encrypted direct-message v2 вводится отдельная **chat-scoped local projection** в `apps/web`.

Она:

- собирается из opaque encrypted envelopes, полученных через fetch или realtime;
- существует только в памяти клиента;
- не становится частью legacy direct-chat state;
- ограничивается bounded per-chat window;
- хранит только minimum render-ready projection, а не бесконтрольный plaintext cache.

Первая версия projection хранит только то, что нужно для минимального render:

- `message_id`, `chat_id`, `sender_user_id`, `sender_crypto_device_id`;
- `revision`, `created_at`, `stored_at`;
- status `ready` или `decrypt_failed`;
- для `ready`:
  - text payload;
  - markdown policy;
  - edited marker;
  - tombstone marker.

### 2. Decrypt остаётся только внутри crypto runtime / worker boundary

UI thread не расшифровывает encrypted direct-message v2 payload напрямую.

Поток данных фиксируется так:

1. UI получает opaque envelope через gateway fetch или realtime.
2. Envelope целиком передаётся в crypto runtime worker.
3. Worker читает local device material из browser keystore.
4. Worker расшифровывает payload и возвращает только bounded projection result.
5. React/UI state хранит уже projection-форму, но не raw private keys и не decrypt logic.

Если decrypt не удался, UI получает явный `decrypt_failed` entry и показывает честное состояние без фальшивого plaintext fallback.

### 3. Для этого slice вводится explicit bootstrap codec, а не claim о полном message protocol

`ADR-060` зафиксировал направление `PQXDH` + `Double Ratchet`, но этот PR реализует только local projection foundation.

Поэтому для первого web decrypt/render slice выбирается узкий **bootstrap envelope codec**:

- versioned transport header;
- versioned payload schema;
- per-envelope decrypt inside worker;
- support только для минимального text payload и базовых операций:
  - `content`;
  - `edit`;
  - `tombstone`.

Этот codec нужен, чтобы:

- не расшифровывать opaque storage прямо в UI;
- получить реальный testable decrypt path;
- не притворяться, что full session management и future ratchet уже готовы.

Ограничение фиксируется явно:

- этот codec не объявляется завершённой реализацией `PQXDH` или `Double Ratchet`;
- sender trust verification, reply preview recovery, encrypted search и media relay остаются later slices;
- bootstrap codec служит только foundation для client-side local projection.

### 4. Storage fetch и realtime merge остаются узкими и честными

Для выбранного direct chat web-клиент:

- вызывает raw `ListEncryptedDirectMessageV2(chat_id, viewer_crypto_device_id)`;
- передаёт opaque envelopes в worker;
- строит bounded local projection;
- отдельно слушает `encrypted_direct_message_v2.delivery`;
- для realtime delivery снова использует worker decrypt и вливает результат в ту же bounded projection.

Гарантии остаются минимальными:

- storage fetch остаётся source of truth для текущего окна истории;
- realtime только дополняет это окно live-delivery событиями;
- full reconnect/offline convergence не считается завершённой.

### 5. Coexistence с legacy plaintext direct chat остаётся явным

Legacy plaintext direct chat не удаляется и не подменяется.

В web UI encrypted direct-message v2 показывается отдельной секцией:

- без притворной unified timeline;
- без server-side plaintext projection;
- без claims о полной feature parity.

Если в одном direct chat видны и plaintext history, и encrypted local projection,
они остаются визуально разделёнными и архитектурно независимыми.

### 6. Честная граница этого slice

Этот PR **решает только**:

- first client-side decrypt/render foundation для encrypted direct-message v2;
- bounded local projection;
- storage fetch integration;
- realtime delivery integration;
- honest coexistence с legacy plaintext thread.

Этот PR **не решает**:

- encrypted media relay;
- group E2EE / MLS;
- backup/recovery;
- encrypted reply preview recovery;
- encrypted edit/pin/search parity;
- encrypted unread/read parity;
- full reconnect/offline convergence;
- send flow parity из legacy composer;
- malicious origin threat.

Следовательно, после `ADR-062` AeroChat всё ещё не должен называться завершённым encrypted messenger.

## Последствия

### Положительные

- Web-клиент впервые получает честный decrypt/render путь для encrypted direct-message v2.
- Plaintext direct chat state не загрязняется opaque encrypted transport logic.
- Crypto runtime boundary становится реально полезной для message path, а не только для registry orchestration.
- Появляется testable foundation для следующих узких PR: sender-side encrypted bootstrap, encrypted reply/edit recovery, media relay.

### Отрицательные

- Во фронтенде появляется дополнительный projection layer и ещё один bounded local state.
- Encrypted and plaintext direct-chat UX временно остаются раздвоенными.
- Bootstrap codec добавляет deliberate временную ступень до полноценного future session protocol.

### Ограничения

- Projection bounded только текущим chat window и текущим local crypto-device.
- Decrypt failures не скрываются и не auto-heal’ятся без нового fetch/retry.
- Mutation application ограничена текущим локальным окном и может честно деградировать в `decrypt_failed` / `unresolved_target`.

## Альтернативы

### 1. Встроить encrypted direct-message v2 в текущий legacy direct chat state

Не выбрано, потому что это смешивает plaintext и encrypted semantics,
размывает границу worker decrypt и создаёт неконтролируемый plaintext cache.

### 2. Оставить worker только для keys/registry, а decrypt делать в React hooks

Не выбрано, потому что это нарушает runtime boundary и повышает риск утечки crypto logic в обычный UI state.

### 3. Ждать полного encrypted feature parity и не показывать ничего до unified timeline

Не выбрано, потому что тогда raw opaque transport снова останется без реальной client-side проверки,
а следующий PR будет вынужден одновременно решать decrypt, projection, fetch, realtime и UX merge.
