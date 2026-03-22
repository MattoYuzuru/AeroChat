# ADR-067: Web encrypted group local projection bootstrap

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-057`, `ADR-065` и `ADR-066` в репозитории уже существуют:

- web crypto runtime с worker boundary и persistent local crypto-device material;
- backend control-plane для encrypted groups с `mls_group_id`, `roster_version`, readable roster и group-scoped opaque storage;
- device-aware realtime family `encrypted_group_message_v1.delivery`;
- legacy plaintext group shell, который по-прежнему живёт отдельной server-readable моделью;
- отсутствие web decrypt/render path для encrypted groups и отсутствие bounded local projection для их локального показа.

При этом важно сохранить уже зафиксированные ограничения:

- encrypted group lane ещё не объявляется полной MLS client implementation;
- сервер не получает новый plaintext projection layer;
- legacy plaintext group history не переписывается и не re-encrypt'ится;
- PR не должен притворяться complete encrypted groups product parity.

Нужен следующий узкий implementation slice, который:

- впервые делает encrypted group envelopes видимыми в web-клиенте;
- оставляет decrypt строго внутри crypto runtime boundary;
- строит bounded client-side projection отдельно от legacy plaintext group state;
- reuse'ит уже существующие backend fetch/realtime contracts;
- не включает outbound encrypted group send, media send, reply/edit/search/unread parity или MLS UX completeness.

## Решение

### 1. Для encrypted groups вводится отдельная bounded local projection

В `apps/web` вводится отдельная **group-scoped local decrypted projection** для encrypted group lane.

Она:

- собирается только из opaque encrypted group envelopes;
- существует только в памяти клиента;
- не записывается в server-visible state;
- не смешивается с `GroupsSelectedState.messages`;
- ограничивается bounded окном на группу/thread;
- хранит только minimum render-ready поля.

Первая версия projection хранит:

- `message_id`, `group_id`, `thread_id`, `mls_group_id`;
- `roster_version`, `sender_user_id`, `sender_crypto_device_id`;
- `revision`, `created_at`, `stored_at`;
- `status`:
  - `ready`
  - `decrypt_failed`
- для `ready`:
  - `text`
  - `markdown_policy`
  - `edited_at`
  - `deleted_at`
  - `is_tombstone`

Эта projection остаётся отдельным local lane,
а не попыткой “незаметно подмешать” encrypted messages в legacy plaintext timeline.

### 2. Decrypt остаётся только внутри crypto runtime / worker boundary

Encrypted group envelopes не расшифровываются в React components, reducers и обычном UI state.

Поток данных фиксируется так:

1. UI получает opaque group envelope через fetch или realtime.
2. Envelope передаётся целиком в crypto runtime worker.
3. Worker использует local crypto-device material из persistent keystore.
4. Worker расшифровывает payload и возвращает только bounded projection result.
5. UI хранит уже projection entry и metadata состояния, но не raw private keys и не decrypt logic.

Если decrypt невозможен,
клиент обязан показать честное `decrypt_failed` / `unavailable` состояние без plaintext fallback.

### 3. Для первого render slice выбирается bootstrap multi-recipient codec

Этот slice **не** объявляет реализованным полноценный MLS client state machine.

Поэтому для первой web local projection foundation вводится узкий **bootstrap multi-recipient codec**:

- один group-scoped ciphertext blob остаётся server-stored opaque payload;
- внутри него хранится versioned transport envelope;
- transport envelope содержит:
  - payload schema/version;
  - общий ciphertext payload;
  - per-recipient wrapped content keys для eligible `crypto_device_id`;
- конкретный viewer device выбирает только свой key box и расшифровывает content key внутри worker boundary.

Этот codec нужен, чтобы:

- не возвращать серверу plaintext projection;
- не вводить device-specific message rows вместо already accepted group-scoped storage;
- дать реальный local decrypt path до отдельного PR с outbound encrypted group send и дальнейшим MLS state recovery.

Ограничения фиксируются явно:

- bootstrap codec не называется “полной MLS implementation”;
- он не закрывает commit engine, epoch recovery, add/remove UX или backup;
- later MLS evolution может заменить bootstrap codec на richer client state,
  но текущая local projection model и runtime boundary должны сохраниться.

### 4. Storage fetch path остаётся explicit и bounded

Для выбранной группы web-клиент делает два явных шага:

1. `GetEncryptedGroupBootstrap(group_id, viewer_crypto_device_id)`
2. `ListEncryptedGroupMessages(group_id, viewer_crypto_device_id, page_size)`

Назначение bootstrap:

- подтвердить, что encrypted lane для текущего local crypto-device materialized;
- получить `mls_group_id`, `roster_version` и readable roster metadata;
- честно отличать “encrypted lane не bootstrapped” от “lane есть, но сообщений пока нет”.

Назначение list path:

- получить opaque group envelopes для текущего viewer device;
- пропустить их через worker decrypt;
- заполнить bounded local projection.

Storage fetch остаётся source of truth для текущего окна истории.

### 5. Realtime дополняет local projection, но не заменяет storage-backed bootstrap

Encrypted groups reuse'ят уже существующий realtime family:

- `encrypted_group_message_v1.delivery`

Web-клиент:

- буферизует device-aware realtime envelopes;
- передаёт их в crypto runtime;
- merge'ит decrypted results в ту же bounded local projection.

При этом текущий slice сознательно **не** обещает:

- full reconnect convergence;
- durable replay beyond explicit fetch path;
- offline recovery без нового fetch;
- complete epoch reconciliation.

Realtime остаётся live-добавкой поверх storage-backed bootstrap.

### 6. Coexistence с legacy plaintext groups остаётся явным

Legacy plaintext group history сохраняется без изменений.

Encrypted group lane:

- показывается отдельной секцией внутри текущей group page;
- не dual-write'ит те же сообщения в plaintext model;
- не маскирует границу между legacy history и encrypted local projection.

Если в одной группе существуют оба path:

- plaintext history остаётся legacy section;
- encrypted history показывается как отдельный client-decrypted lane;
- “идеальный unified timeline” не притворяется завершённым, пока он действительно не реализован cleanly.

### 7. Reuse encrypted media relay из ADR-065 остаётся обязательным

Этот slice не внедряет encrypted group media send,
но фиксирует важную совместимость:

- future encrypted group payload может нести тот же encrypted attachment descriptor, что и direct encrypted lane;
- `attachment` relay lifecycle/quota/retention не меняются;
- для groups не появляется новая media architecture.

Следовательно,
`ADR-065` остаётся reusable foundation,
а current local projection model не должна делать direct-only assumptions про future encrypted attachment descriptor handling.

### 8. Honest boundary этого PR

Этот slice **решает только**:

- web decrypt/render foundation для encrypted groups;
- bounded local decrypted projection;
- storage bootstrap integration;
- realtime merge integration;
- honest coexistence с legacy plaintext group history.

Этот slice **не решает**:

- outbound encrypted group send;
- encrypted group media send;
- full MLS commit engine/client state UX;
- encrypted reply/edit/pin/search/unread parity;
- backup/recovery;
- RTC;
- push/PWA;
- malicious origin threat.

## Последствия

### Положительные

- Web-клиент впервые получает честный local decrypt/render path для encrypted group lane.
- Plaintext group state не загрязняется opaque encrypted transport logic.
- Crypto runtime boundary становится реальной message-path границей и для groups, а не только для direct lane.
- Появляется bounded foundation для следующего PR с outbound encrypted group text send.

### Отрицательные

- Во фронтенде появляется ещё один local projection layer и отдельный realtime buffer.
- UI groups временно остаётся split между legacy plaintext history и encrypted local lane.
- Bootstrap multi-recipient codec является промежуточной ступенью до richer MLS client state.

### Ограничения

- Projection bounded только текущим group/thread окном и текущим local crypto-device.
- Decrypt failures не скрываются и не auto-heal'ятся вне нового fetch/retry.
- Mixed-mode group UX остаётся намеренно явным, а не “магически единым”.

## Альтернативы

### 1. Встроить encrypted group messages прямо в legacy plaintext group state

Не выбрано, потому что это смешивает две разные модели хранения,
размывает runtime boundary
и провоцирует неконтролируемый plaintext cache в UI state.

### 2. Оставить decrypt на main thread и держать worker только для registry

Не выбрано, потому что тогда message-path crypto logic снова расползётся в обычный UI layer.

### 3. Ждать полного outbound send и MLS UX parity, прежде чем показывать encrypted groups

Не выбрано, потому что это оставило бы backend opaque contracts без реального web consumption
и вынудило бы следующий PR одновременно решать runtime, fetch, realtime, projection и send.
