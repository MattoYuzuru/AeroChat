# ADR-059: Proof-bound crypto bundle update и rotation hardening

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-055`, `ADR-056`, `ADR-057` и `ADR-058` в репозитории уже существуют:

- `crypto-device registry` c `active` / `pending_link` / `revoked`;
- immutable `crypto_device_id` и device-level identity key внутри current bundle model;
- web crypto runtime с persistent local identity private key;
- proof-bound linked-device approval для `pending_link -> active`;
- gateway-only внешний transport surface для crypto-device operations.

При этом publish/update уже существующего `active` crypto device bundle всё ещё имеет remaining auth-only gap:

- same-account session всё ещё может инициировать bundle rotation как обычную server-owned mutation;
- backend не требует отдельный device-held proof от самого target active crypto device;
- public bundle update не привязан к explicit freshness material;
- bundle supersede/version bump пока не зависят от подтверждения со стороны локального identity private key устройства.

Такое состояние уже не соответствует разделению `account auth != crypto trust`, зафиксированному в `ADR-055` и `ADR-056`.

После `ADR-058` linking уже proof-bound.
Следующий логический узкий slice должен так же убрать auth-only gap для уже active bundle publish/update,
не начиная direct-message encryption, MLS, recovery или broad trust-management UX.

## Решение

### 1. Active bundle publish становится proof-bound mutation

`PublishCryptoDeviceBundle` для уже `active` crypto device больше не считается валидным только потому, что:

- пользователь аутентифицирован;
- `crypto_device_id` принадлежит этому аккаунту;
- payload bundle structurally корректен.

Для `active` device publish/update теперь требует **signed bundle publish proof**, выпущенный самим target device.

Proof выпускается локальным identity private key этого же устройства и проверяется по уже stored immutable `identity_public_key`.

### 2. Нужен отдельный narrow publish challenge

Для bundle publish выбирается отдельный узкий freshness path:

- сервер создаёт short-lived `bundle publish challenge`;
- challenge привязан к конкретному `crypto_device_id`;
- challenge привязан к текущему server-known current bundle state:
  - `current_bundle_version`;
  - `current_bundle_digest`;
- challenge возвращается через отдельный narrow API, а не через generic signing platform;
- challenge перестаёт быть валиден после expiry или после успешного publish.

Это решение выбрано вместо generic challenge framework,
потому что оно минимально закрывает replay/staleness именно для active bundle rotation.

### 3. Что именно подписывается

Минимальный payload версии `v1` обязан включать:

- `crypto_device_id`;
- `previous_bundle_version`;
- `previous_bundle_digest`;
- `new_bundle_digest`;
- `publish_challenge`;
- `challenge_expires_at`;
- `issued_at`;
- `version`.

Такой payload даёт:

- привязку proof к конкретному device;
- привязку proof к конкретному current bundle state;
- привязку proof к конкретному новому bundle digest;
- bounded freshness;
- deterministic backend validation.

Proof не является generic “подпиши произвольную server mutation”.

### 4. Trust anchor для publish proof

Trust anchor для publish/update остаётся прежним:

- immutable device identity public key уже established внутри registry model.

Следовательно, backend проверяет:

- что target device всё ещё `active`;
- что device не revoked;
- что `identity_public_key` в новом bundle совпадает с immutable identity key этого device;
- что signature корректна именно относительно этого stored public key.

Тем самым bundle rotation не может silently подменить сам identity root устройства.

### 5. Bounded self-consistency checks для bundle material

Этот slice добавляет только practical bounded validation,
а не делает вид, что `PQXDH`, one-time prekeys или full future rotation policy уже реализованы.

Допустимые и обязательные проверки:

- `identity_public_key` присутствует и для existing active device совпадает с immutable stored identity key;
- `signed_prekey_public`, `signed_prekey_id`, `signed_prekey_signature` обязательны и non-empty;
- `signed_prekey_signature` должна реально верифицироваться identity public key текущего device для current browser foundation suite;
- `bundle_digest` должен совпадать с канонически вычисленным digest этого bundle payload;
- optional `kem_*` triplet остаётся только в bounded coherence semantics:
  - либо все три поля отсутствуют;
  - либо все три поля присутствуют.

Этот ADR сознательно не вводит:

- full future PQ material verification;
- one-time prekey inventory protocol;
- universal algorithm-agility platform.

### 6. Семантика для `pending_link`

Этот PR harden’ит именно **active-device bundle rotation**.

Для `pending_link` device:

- publish/update может оставаться существующей auth-owned mutation;
- потому что device ещё не является trusted active member набора устройств;
- и его bundle state всё равно уже привязывается к later link approval через `ADR-058`.

При этом общие structural/self-consistency checks bundle payload применимы и к `pending_link`, если они не требуют active-only trust semantics.

Таким образом, hardening scope intentionally остаётся узким:

- `active` publish/update требует proof;
- `pending_link` publish не получает новый ceremony в этом PR.

### 7. Backend verification boundary

`Aero-identity` обязан выполнять до supersede/version bump следующие проверки для `active` publish:

1. auth session принадлежит владельцу registry;
2. target `crypto_device_id` существует и принадлежит этому аккаунту;
3. device остаётся `active`;
4. device не revoked;
5. существует current bundle этого device;
6. publish challenge существует, не истёк и относится к текущему current bundle state;
7. proof structurally корректен;
8. proof payload совпадает с server-known values;
9. `new_bundle_digest` совпадает с digest реально публикуемого нового bundle payload;
10. `identity_public_key` нового bundle совпадает с immutable device identity key;
11. signature корректна относительно stored identity public key;
12. только после этого происходит supersede current bundle, version bump и invalidation used challenge.

Same-account auth остаётся necessary ownership check, но становится insufficient без device-held proof.

### 8. Web runtime boundary

Bundle publish proof создаётся только внутри уже существующего crypto worker/runtime boundary:

- worker собирает новый public bundle;
- worker получает narrow publish challenge через gateway;
- worker строит canonical publish-proof payload;
- worker подписывает payload локальным `identityPrivateKey`;
- gateway получает bundle + proof;
- React/UI layer не получает raw private key material.

UI остаётся минимальным:

- existing action “повторно опубликовать current bundle” может сохраниться;
- trust-management redesign не требуется.

### 9. Честная security boundary

Этот slice **решает только**:

- active bundle publish/update больше не является plain auth mutation;
- backend теперь требует device-held proof от самого target active device;
- bundle rotation привязывается к immutable device identity key и текущему server-known bundle state.

Этот slice **не решает**:

- direct-message encryption;
- media encryption;
- contact verification;
- cross-signing;
- backup/recovery;
- MLS;
- full future key-rotation strategy для всех алгоритмов;
- malicious origin, который выдаёт модифицированный web bundle.

Следовательно, после этого PR AeroChat всё ещё не должен называться завершённым E2EE messenger.

## Последствия

### Положительные

- Remaining auth-only gap для active bundle rotation закрывается.
- Bundle update начинает реально зависеть от device-held identity private key.
- Backend получает deterministic validation path для stale/replay/ownership/signature failures.
- Следующий DM E2EE slice получает более честный public-bundle lifecycle foundation.

### Отрицательные

- Bundle publish path становится сложнее из-за challenge/proof verification.
- Web runtime получает ещё один narrow orchestration шаг.
- Появляется дополнительная short-lived registry metadata для publish challenge.

### Ограничения

- Pending-link publish не получает новый proof requirement в этом PR.
- Не вводится universal rotation policy engine.
- Не вводится generic sign-anything transport surface.
- Не делается полный future KEM/prekey validation beyond bounded consistency checks.

## Альтернативы

### 1. Оставить active bundle publish plain auth mutation

Не выбрано, потому что это сохраняет remaining auth-only mutation на критичном crypto state.

### 2. Использовать только previous version/digest без server challenge

Не выбрано, потому что узкий explicit challenge даёт более явную freshness boundary и проще документируется как anti-replay механизм.

### 3. Harden’ить одновременно active и pending publish одинаковым ceremony

Не выбрано, потому что это расширяет scope и смешивает active-device rotation hardening с pending-link lifecycle.
