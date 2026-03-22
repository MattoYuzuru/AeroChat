# ADR-057: Web secure key storage и crypto worker foundation

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-055` и `ADR-056` в репозитории уже существуют:

- backend registry для `crypto devices`, public bundles и `pending_link` lifecycle;
- gateway-only внешний contract для registry methods;
- web runtime, где обычная auth session хранится в `sessionStorage`;
- отсутствие browser-side keystore для долгоживущих crypto-device private keys;
- отсутствие изолированной runtime boundary между React/UI state и будущей client-side cryptography.

Следующий implementation slice должен дать минимально пригодный foundation для web-клиента,
не начиная message/media encryption раньше времени.

Этот slice обязан:

- отделить long-lived crypto material от обычного UI state;
- дать browser-persistent keystore для local crypto-device continuity;
- встроить first-device bootstrap и pending linked-device registration в текущий gateway-only flow;
- не делать вид, что trust verification, backup/recovery и E2EE уже завершены.

## Решение

### 1. Граница web crypto runtime

В `apps/web` вводится отдельный `crypto runtime`, который:

- owns browser keystore;
- owns local key generation;
- owns public bundle assembly;
- owns registry bootstrap/orchestration calls;
- не раскрывает raw private key material в React components, hooks и обычный app state.

Для web implementation принимается worker-owned направление:

- browser main thread общается с runtime через узкий command surface;
- отдельный worker выполняет key generation, keystore access и registry orchestration;
- UI получает только runtime snapshot, status и явные action results.

Минимальный surface этого slice:

- `bootstrapSession`;
- `createPendingLinkedDevice`;
- `publishCurrentBundle`;
- `approveLinkIntent`.

Этот surface intentionally остаётся маленьким, чтобы later DM/media crypto не разрастались в UI thread.

### 2. Persistent keystore model

Для long-lived crypto-device keys выбирается browser-persistent storage на базе `IndexedDB`.

Решение фиксируется так:

- local auth session token остаётся в `sessionStorage`;
- local crypto-device key material живёт отдельно в versioned `IndexedDB` store;
- keystore хранит metadata записи и persistent `CryptoKey` objects;
- локальная модель keyed по account/user identity, а не по вкладке и не по текущей auth session.

Первая версия keystore содержит:

- metadata локального `crypto device`;
- identity key pair;
- signed prekey pair;
- bundle-related metadata вроде `crypto_suite`, `signed_prekey_id`, published digest/version snapshot.

Если браузер не поддерживает нужный набор `IndexedDB` + `WebCrypto`, runtime:

- не деградирует в `sessionStorage` или другой небезопасный fallback;
- возвращает явную ошибку foundation;
- не объявляет устройство “созданным”, пока persistent path недоступен.

### 3. Algorithm/material boundary этой foundation-версии

`ADR-055` фиксирует целевое направление `PQXDH`, `Double Ratchet` и later `MLS`,
но этот slice ещё не внедряет полноценный async session bootstrap protocol.

Поэтому первая web foundation-реализация делает только следующее:

- генерирует долгоживущую identity signing key pair;
- генерирует signed prekey pair;
- подписывает public signed prekey через локальную identity key;
- публикует versioned public bundle в существующий registry contract;
- сохраняет private key material только локально.

Для первого web runtime slice допускается временный foundation suite,
явно помеченный как preparatory browser bundle format, а не как завершённый `PQXDH`.

Это сделано сознательно, потому что:

- registry contract уже умеет хранить suite-tagged opaque public bundle material;
- web keystore/runtime можно внедрить раньше полного DM protocol slice;
- проект не должен делать ложный claim, что `PQXDH` уже полностью реализован.

Полноценный `KEM/PQ` material и message-session semantics остаются отдельным later slice.

### 4. Bootstrap semantics

После успешного auth session bootstrap web runtime выполняет owner-scoped registry sync:

1. Читает local keystore для текущего аккаунта.
2. Читает server registry state через `aero-gateway`.
3. Выбирает одно из явных состояний:
   - reuse уже существующего local crypto device;
   - first-device bootstrap, если registry пуст;
   - explicit pending-link bootstrap, если registry уже содержит active device, а local keystore ещё пуст;
   - pending approval wait для уже созданного local pending device;
   - conservative error, если local и remote state конфликтуют.

Обязательные правила:

- password login сам по себе не mint’ит новый trusted crypto device на каждом входе;
- существующий local keystore должен переиспользоваться;
- pending linked device не auto-trust’ится только по auth session;
- если trusted local device уже есть, он может участвовать в approve path через текущий backend control-plane API.

### 5. Publish/update semantics

Web runtime получает право:

- публиковать first bundle при initial registration;
- публиковать bundle для pending linked device;
- повторно публиковать current local bundle для уже существующего local device, если registry требует resync.

При этом bundle publish/update всё ещё остаётся server-visible public-material operation.
Этот ADR не объявляет реализованными:

- one-time prekey consumption;
- полноценную rotation policy;
- session bootstrap для сообщений.

### 6. UX boundary

В этом slice допускается только минимальная product integration:

- bootstrap после authenticated session start;
- bounded status/error surface;
- небольшой settings/debug-oriented section без полного crypto-device management UI.

Не допускается:

- “secure messaging ready” UX;
- QR/SAS verification ceremony UI;
- backup/recovery UX;
- contact trust UX;
- redesign existing Settings page под полноценный trust center.

### 7. Честная граница безопасности

Этот slice даёт:

- persistent local storage для long-lived crypto-device keys;
- separated runtime boundary;
- first-device и pending-link control-plane participation;
- public bundle publication через gateway.

Этот slice **не** решает:

- cryptographic proof binding для linked-device approval;
- message encryption;
- media encryption;
- backup/recovery;
- MLS group crypto;
- защиту от malicious origin, который выдал модифицированный web bundle.

Следовательно, после этого slice AeroChat всё ещё не должен называться завершённым E2EE messenger.

## Последствия

### Положительные

- Web client получает реальную device continuity для future E2EE instead of tab-scoped auth storage.
- Crypto orchestration перестаёт расползаться по React/UI layer.
- First-device и pending-link backend foundation становятся реально используемыми из web runtime.
- Появляется явная, testable точка для следующих slices: direct-message E2EE, encrypted media и recovery.

### Отрицательные

- Веб-клиент становится сложнее из-за отдельного worker/runtime и keystore lifecycle.
- Некоторые браузерные ограничения теперь проявятся как явные runtime errors, а не как “тихая деградация”.
- Без proof binding и recovery UX pending-link flow остаётся намеренно неполным.

### Ограничения

- Нельзя использовать этот slice как claim о готовом `PQXDH`.
- Нельзя выносить private keys в обычный app state, logs или transport payloads.
- Нельзя auto-link device только по login/password.
- Нельзя подменять persistent keystore на менее устойчивое local/session storage “ради совместимости”.

## Альтернативы

### 1. Хранить crypto-device keys в `sessionStorage` рядом с auth token

Не выбрано, потому что это ломает device continuity и делает long-lived private keys tab-scoped.

### 2. Держать весь crypto runtime в React hooks на main thread

Не выбрано, потому что это повышает риск утечки key material в обычный UI state,
усложняет дальнейший DM/media runtime и ухудшает boundary discipline.

### 3. Ждать полного DM encryption slice и не делать web keystore заранее

Не выбрано, потому что тогда direct-message implementation снова начнёт придумывать runtime/storage model одновременно с message protocol.
