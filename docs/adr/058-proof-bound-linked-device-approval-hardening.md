# ADR-058: Proof-bound linked-device approval hardening

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-055`, `ADR-056` и `ADR-057` в репозитории уже существуют:

- `crypto_device` registry в `aero-identity`;
- `pending_link -> active` state machine;
- public bundles и `bundle_digest`;
- web crypto runtime с persistent local key storage и worker boundary;
- gateway-only внешний contract для crypto-device registry.

Одновременно текущий linked-device approval всё ещё слишком слаб:

- новый `pending_link` device можно активировать через same-account auth session без device-held proof;
- backend проверяет ownership и lifecycle state, но не проверяет, что approval действительно выпустил уже активный trusted crypto-device;
- approval не привязан к отдельному server-issued challenge;
- approval не оставляет явной cryptographic boundary между account auth и crypto trust continuity.

Такое состояние противоречит базовому инварианту `ADR-055` и `ADR-056`:

- password login и server session не должны сами по себе решать вопрос crypto trust;
- already active device должен действительно подтверждать linking;
- approval должен быть привязан к конкретному link intent и конкретному pending bundle state.

Следующий slice должен устранить именно этот gap, не начиная message encryption, media encryption, recovery, QR/SAS UX, MLS или RTC.

## Решение

### 1. Approval становится signed proof, а не plain auth action

`ApproveCryptoDeviceLinkIntent` больше не считается валидным только потому, что:

- пользователь аутентифицирован;
- `approver_crypto_device_id` принадлежит тому же аккаунту;
- backend видит `pending` link intent.

Теперь approval требует **конкретный signed approval proof**, выпущенный уже `active` crypto-device.

Этот proof содержит structured payload и signature.

Минимальный payload версии `v1` обязан включать:

- `link_intent_id`;
- `approver_crypto_device_id`;
- `pending_crypto_device_id`;
- `pending_bundle_digest`;
- `approval_challenge`;
- `challenge_expires_at`;
- `issued_at`;
- `version`.

Signature проверяется по уже опубликованному `identity_public_key` approving device.

### 2. Approval challenge принадлежит link intent

Для минимальной безопасной версии не вводится отдельная generic challenge platform.

Вместо этого каждый `crypto_device_link_intent` получает свой server-issued `approval_challenge`, который:

- генерируется при создании intent;
- хранится рядом с intent;
- возвращается через текущий link-intent read model;
- валиден только пока сам intent остаётся `pending` и не истёк;
- не переносится между intent;
- не переживает supersede pending bundle.

`challenge_expires_at` для proof-bound approval совпадает с `link_intent.expires_at`.

Этого достаточно, чтобы:

- убрать replay одного и того же approval на другой intent;
- не позволить generic signed “approve any device for this account” артефакт;
- не строить отдельный infra-layer ради одного narrow flow.

### 3. Proof жёстко привязан к текущему pending bundle state

Approval обязан подтверждать не просто `pending_crypto_device_id`, а именно текущий intended pending state:

- конкретный `pending_crypto_device_id`;
- конкретный `bundle_digest`, который server registry считает current bundle этого pending device на момент approval;
- конкретный `link_intent_id`;
- конкретный `approval_challenge`.

Если pending device публикует новый bundle и текущий digest меняется:

- старый `link_intent` должен считаться непригодным;
- старый `approval_challenge` теряет смысл;
- старый signed approval proof не может silently активировать новый pending state.

### 4. Backend verification boundary

`Aero-identity` обязан выполнять все следующие проверки до `pending_link -> active`:

1. auth session принадлежит владельцу account registry;
2. `link_intent` существует и ещё `pending`;
3. `link_intent` не истёк;
4. pending device всё ещё `pending_link`;
5. current pending bundle digest совпадает с digest, привязанным к intent;
6. approval proof structurally корректен;
7. proof payload совпадает с текущими server-known values;
8. `approver_crypto_device_id` существует, принадлежит тому же аккаунту и остаётся `active`;
9. approver device не revoked;
10. pending device не может self-approve;
11. signature корректна относительно текущего stored approving bundle identity key;
12. после успешного approval intent больше не может быть повторно использован.

Same-account auth остаётся обязательным ownership check, но перестаёт быть достаточным.

### 5. Identity key continuity для approving device

Proof-bound approval полагается на то, что approving device имеет стабильную signing identity.

Поэтому для существующего `crypto_device` bundle publish больше не должен silently менять `identity_public_key`.

Этот slice не внедряет полный bundle attestation protocol, но фиксирует минимальный инвариант:

- bundle rotation может обновлять publish metadata и prekey material;
- stable device identity key не должна меняться в рамках того же `crypto_device_id`.

Это нужно именно для того, чтобы approval proof проверялся относительно уже известной device identity, а не относительно ключа, который сервер только что позволил подменить через обычную auth session.

### 6. Web runtime boundary

В `apps/web` approval proof создаётся только внутри существующего crypto worker/runtime boundary:

- UI не получает raw private key material;
- main thread не подписывает approval payload;
- worker собирает canonical approval payload из link intent и local active device state;
- worker подписывает payload `identityPrivateKey`;
- gateway получает уже готовый proof artifact.

UI может оставаться минимальным:

- список pending link intents;
- action “Одобрить”.

Но backend approval больше не должен происходить как plain button -> session action без локальной подписи.

### 7. Честная security boundary

Этот slice **решает только** следующее:

- `pending_link -> active` теперь требует device-held cryptographic proof от already active device;
- approval становится привязан к intent, pending bundle digest и challenge;
- same-account auth становится недостаточным без device proof.

Этот slice **не решает**:

- message encryption;
- media encryption;
- recovery / backup restore;
- cross-signing hierarchy;
- contact verification UX;
- QR / SAS ceremony UX;
- MLS;
- RTC;
- защиту от malicious origin, который отдаёт подменённый web bundle.

Следовательно, после этого PR AeroChat всё ещё не должен называться завершённым E2EE messenger.

## Последствия

### Положительные

- Linked-device approval перестаёт быть чисто backend control-plane действием.
- Trust continuity для собственных устройств начинает реально зависеть от already active device key.
- Approval становится детерминированным, testable и привязанным к exact pending state.
- Следующий DM E2EE slice получает честную базу без auto-trust по auth session.

### Отрицательные

- Backend и web runtime становятся чуть сложнее из-за challenge/proof model.
- Approval теперь зависит от того, что active local device действительно доступен и хранит нужный private key.
- Legacy pending intents после миграции должны считаться устаревшими и должны создаваться заново уже с proof-bound challenge.

### Ограничения

- Один `active` approver по-прежнему достаточен для approval.
- Не вводится multi-approver policy.
- Не вводится отдельный account root key.
- Не вводится generic challenge refresh API, пока это не требуется отдельным ADR.

## Альтернативы

### 1. Оставить approval plain auth action

Не выбрано, потому что это сохраняет разрыв между account auth и crypto trust continuity.

### 2. Ввести отдельный account-level trust key до proof-bound approval

Не выбрано, потому что это расширяет trust model сильнее нужного и уводит slice в новый фундаментальный дизайн.

### 3. Делать полноценный QR/SAS ceremony сразу

Не выбрано, потому что это смешивает cryptographic hardening и UX ceremony в одном PR.
