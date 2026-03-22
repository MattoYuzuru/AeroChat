# ADR-056: Crypto device registry, public bundles и linked-device ceremony foundation

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-006`, `ADR-018` и `ADR-055` в репозитории уже существуют:

- account/password auth в `aero-identity`;
- `user_devices` и `user_sessions` как текущая account/auth inventory model;
- web UI управления устройствами и сессиями через `aero-gateway`;
- `key_backup_status` только как foundation-поле профиля без реальной recovery implementation;
- high-level direction для E2EE, multi-device trust, encrypted media и future RTC.

Одновременно `ADR-055` намеренно оставил абстрактными несколько критичных вопросов первого implementation slice:

- что именно считается `crypto device` в терминах текущего репозитория;
- как `crypto device` соотносится с текущими `user_devices` и `user_sessions`;
- какой точный server-visible public material должен хранить `aero-identity`;
- где проходят ownership boundaries между registry, linked-device ceremony, recovery и будущим client runtime;
- какой exact scope должен получить первый implementation PR, чтобы не начать message/media/MLS/RTC crypto раньше времени.

Этот ADR закрывает именно этот gap.

Он остаётся docs-only решением:

- не добавляет code, proto, schema или generated artifacts;
- не меняет текущее поведение продукта;
- не объявляет реализованной криптографию;
- не вводит custom crypto protocol.

## Текущее состояние репозитория

### 1. Что есть сейчас

Текущий `aero-identity` уже хранит:

- `users`;
- `user_devices`;
- `user_sessions`;
- `key_backup_status`.

Текущая auth semantics такова:

- `Register` создаёт аккаунт, `user_device` и `user_session`;
- `Login` создаёт новый `user_device` и новый `user_session`;
- `session token` аутентифицирует пользователя;
- revoke device/session относится только к account access surface.

Это означает, что текущий `user_device`:

- создаётся вокруг login/session flow;
- может пересоздаваться при новом входе;
- не является стабильной crypto identity;
- не может считаться source of truth для trust continuity.

### 2. Что ещё не существует

В репозитории пока отсутствуют:

- отдельный registry для crypto devices;
- server-owned public bundle contract;
- linked-device ceremony с trust continuity;
- recovery flow поверх encrypted backup;
- разделение auth inventory и crypto trust inventory в transport/runtime semantics.

## Решение

### 1. Определение crypto device

`Crypto device` в AeroChat — это отдельная долгоживущая crypto identity аккаунта, у которой есть:

- стабильный `crypto_device_id`;
- device-bound private key material, которое остаётся только на клиенте;
- server-visible public bundle;
- trust state внутри account-owned registry;
- отдельный lifecycle: `pending_link`, `active`, `revoked`.

`Crypto device` не равен текущему auth device и не равен session token.

Выбирается **layered model**, а не 1:1 merge:

- `password login` даёт account authentication;
- `session token` даёт право вызывать server API от имени аккаунта;
- `auth device` остаётся inventory-объектом для login/session UX;
- `crypto device` остаётся trust-объектом для E2EE.

Целевая связь фиксируется так:

- у одного `crypto device` может быть много auth sessions за время жизни;
- один auth session работает в контексте не более одного local crypto device runtime;
- у аккаунта может быть auth session без активного crypto device;
- `crypto device` никогда не должен пересоздаваться только потому, что сервер выдал новый session token.

Для первого implementation slice текущие `user_devices` не переиспользуются как crypto registry source of truth.

Они остаются отдельным auth layer, потому что их текущая semantics создаётся вокруг login flow и не даёт стабильной trust continuity.

### 2. Инварианты crypto device registry

Для `crypto device` фиксируются обязательные инварианты:

- `crypto_device_id` стабилен на всём жизненном цикле устройства и не меняется при bundle rotation.
- Один `crypto device` принадлежит ровно одному `user_id`.
- Приватный ключевой material никогда не попадает на сервер.
- Новый password login сам по себе не может silently создать trusted `crypto device`.
- Если у аккаунта уже есть хотя бы один `active` crypto device, новый device сначала попадает только в `pending_link`.
- `revoked` crypto device не возвращается обратно в `active`; вместо этого регистрируется новый `crypto_device_id`.
- Bundle update разрешён только для уже существующего device и не должен менять владельца device.
- Trust continuity строится через already trusted device или recovery material, но не через auth session как таковую.

### 3. Что сервер хранит как public registry material

`Aero-identity` становится source of truth для server-visible crypto-device registry.

Для каждого `crypto device` сервер хранит отдельный registry record со следующими полями:

- `crypto_device_id`;
- `user_id`;
- user-facing label или display name устройства;
- `status`;
- `created_at`;
- `activated_at`;
- `revoked_at`;
- `revocation_reason`;
- `linked_by_crypto_device_id`, если device был одобрен уже доверенным устройством;
- `last_bundle_version`;
- `last_bundle_published_at`.

Для каждого активного device сервер хранит versioned public bundle:

- `bundle_version`;
- `crypto_suite` или algorithm identifier;
- `identity_public_key`;
- `signed_prekey_public`;
- `signed_prekey_id`;
- `signed_prekey_signature`;
- если выбранный suite этого требует, дополнительный public KEM/PQ prekey material и его signature metadata;
- набор one-time prekeys или last-resort prekey records в виде server-visible public material с отдельными идентификаторами;
- `published_at`;
- `expires_at` или explicit freshness metadata, если это требуется для rotation policy;
- `superseded_at`, когда bundle или prekey набор заменён новым;
- digest или equivalent immutable reference на опубликованный bundle, пригодный для link approval и update verification.

Для revoke и audit сервер хранит только необходимый минимум metadata:

- `revoked_at`;
- `revocation_reason`;
- actor metadata уровня `self`, `linked_device`, `recovery`, `account_reset`, если такой actor явно известен;
- ссылку на связанный link intent или recovery event при наличии.

Отдельный account-level trust key в `ADR-056` **не вводится**.

Причины:

- у `ADR-055` уже есть first-device trust root direction;
- отдельный account root key сейчас создал бы второй trust root до решения по web keystore и recovery UX;
- для первого registry slice достаточно device-level trust chain и account-owned registry state.

Следовательно, на этом этапе source of server-tracked trust state для аккаунта:

- набор `active` crypto devices;
- first-device bootstrap rule;
- device-signed link approvals и server-tracked revoke state.

### 4. Что сервер хранить не должен

Серверу запрещено хранить внутри registry или рядом с ним:

- private keys любого device;
- seed material;
- decrypted backup contents;
- recovery key, recovery passphrase или её plaintext derivative;
- plaintext сообщений;
- plaintext вложений;
- plaintext history export;
- любые “временные” симметричные ключи, которых сервер не должен видеть;
- локальные trust decisions пользователя о чужих контактах, если они не нужны server ownership model;
- фейковый `is_trusted = true` без реального link/recovery основания.

### 5. Что именно owns crypto-device registry

`Crypto-device registry` относится к bounded context `aero-identity`.

Он owns:

- регистрацию нового `crypto device`;
- first-device bootstrap rule;
- хранение и выдачу public bundles;
- bundle publish/update lifecycle;
- список собственных crypto devices аккаунта;
- revoke/deactivate device;
- pending link intents и их state machine;
- server-side ownership checks;
- recovery-related registry metadata, достаточный для future backup/recovery layer.

`Aero-identity` должен принимать и проверять только такие server responsibilities:

- какой аккаунт владеет device;
- существует ли device;
- в каком состоянии device находится;
- подписан ли bundle update уже известной device identity;
- подписан ли link approval уже доверенным device того же аккаунта;
- не истёк ли pending intent;
- не был ли device уже revoked;
- не пытается ли один пользователь читать или отзывать registry другого пользователя.

`Aero-identity` сознательно не owns:

- генерацию ключей;
- локальное хранение private key material;
- UI linked-device ceremony;
- QR flow, numeric code flow или другое client UX представление link process;
- direct message encryption;
- media encryption;
- backup blob contents;
- MLS group runtime;
- RTC signaling decisions;
- trust decisions о чужих устройствах на клиенте.

Эти части принадлежат будущему client runtime и отдельным ADR/implementation slices.

### 6. Архитектурная модель linked-device ceremony

#### 6.1. First trusted device

Если у аккаунта нет активных crypto devices, первый успешно зарегистрированный device может стать `active` без existing-device approval.

Это единственное допустимое исключение из общего правила linked-device approval.

Такой device становится первым trust root аккаунта в рамках текущего registry state.

Это не отдельный account master key и не вечная глобальная роль.

Это просто первый `active` `crypto device`, от которого дальше разрешено продолжать trust continuity.

#### 6.2. Как новый device становится trusted

Если у аккаунта уже есть хотя бы один `active` crypto device, новый device проходит только такой путь:

1. Пользователь получает обычную auth session через password login.
2. Новый клиентский runtime генерирует локальный key material и отправляет на сервер initial public bundle.
3. Сервер создаёт `crypto device` в состоянии `pending_link`.
4. Сервер создаёт short-lived link intent, привязанный к:
   - `user_id`;
   - `pending crypto_device_id`;
   - digest опубликованного bundle;
   - времени истечения.
5. Уже доверенное `active` устройство того же аккаунта получает link intent через server relay или server fetch.
6. Доверенное устройство выпускает approval artifact, который подтверждает именно этот `pending crypto_device_id` и именно этот bundle digest.
7. Сервер проверяет approval artifact относительно уже известного `active` device public identity.
8. Только после успешной проверки сервер переводит новый device в `active`.

Минимальное безопасное правило для первой версии:

- достаточно одобрения от одного уже `active` crypto device;
- approval должен быть одноразовым и short-lived;
- approval всегда привязан к конкретному bundle digest;
- password login без approval не даёт trusted status;
- для собственных устройств TOFU не используется.

#### 6.3. Что сервер может и чего не может решать

Серверу разрешено:

- аутентифицировать пользователя через текущую session model;
- хранить pending device и public bundle;
- выдавать pending intents уже доверенным устройствам того же аккаунта;
- валидировать structural correctness и signature correctness для registry transitions;
- делать state transition `pending_link -> active` только после валидного approval;
- записывать audit metadata.

Серверу запрещено:

- auto-trust новый device только по факту login/password;
- подменять bundle между registration и approval;
- silently добавлять device без proof от already trusted device или recovery path;
- решать, что device “наверное тот же самый браузер”, если это не доказано локальным runtime;
- скрывать revoke от клиента и продолжать раздавать revoked bundle как active.

#### 6.4. Minimum safe first version

Первая безопасная linked-device версия intentionally остаётся узкой:

- один аккаунт;
- один pending device;
- одно одобрение от одного active device;
- серверный relay/fetch канал для link intent;
- без proximity-specific guarantees;
- без mandatory QR UX;
- без cross-signing graph между всеми устройствами;
- без safety-number UI для собственных устройств.

Этого достаточно, чтобы:

- не смешать linking с password login;
- не отдать trust decision серверу;
- дать будущему web runtime ясный backend contract.

#### 6.5. Что ждёт следующих ADR

После `ADR-056` отдельно остаются:

- конкретный web UX linked-device ceremony;
- QR / code / deep-link presentation layer;
- локальный keystore и worker boundary;
- multi-approver policy;
- device fingerprint UX;
- manual verification flows;
- hardware-backed or platform-attested enhancements.

### 7. Recovery boundary

Recovery и linking — это разные доменные события.

`Linking` означает:

- у пользователя уже есть хотя бы один trusted `crypto device`;
- continuity подтверждается этим устройством;
- recovery material не требуется.

`Recovery` означает:

- trusted device может быть недоступен;
- continuity восстанавливается через отдельно подготовленный recovery path;
- password login сам по себе всё ещё недостаточен.

Для future server-hosted encrypted backup registry layer должен уметь дать только следующие опоры:

- stable `crypto_device_id`;
- список `active` и `revoked` devices;
- history-safe distinction между `linked`, `recovered` и `revoked` transitions;
- `key_backup_status` как coarse account-level indicator;
- owner-scoped registry read/write API;
- возможность создать новый device через отдельный recovery activation path, а не через обычный linked-device approval.

`ADR-056` сознательно не определяет:

- формат backup blob;
- recovery key/passphrase derivation;
- upload/download/export semantics backup blob;
- client UX для backup setup;
- account crypto reset UX;
- правила re-encrypt истории после recovery.

Но фиксирует важную границу:

- recovery не должен выглядеть как “обычный login на новом устройстве”;
- server-hosted backup не должен требовать server-visible plaintext keys;
- registry должен различать `linked new device` и `recovered new device` как разные основания для trust transition.

### 8. Эволюция текущих auth devices и sessions

Текущая repo semantics создаёт device вокруг login/session flow.

Это остаётся корректным для account access, но недостаточно для crypto trust.

Поэтому принимается такая layering model:

- password login подтверждает право войти в аккаунт;
- session token подтверждает право вызывать authenticated backend APIs;
- auth device описывает текущий login/runtime surface для UX “устройства и сессии”;
- crypto device описывает долгоживущую E2EE identity.

Явные правила эволюции:

- новый login больше не должен означать новый trusted `crypto device`;
- revoke auth session завершает только session access;
- revoke auth device закрывает связанные auth sessions, но не эквивалентен crypto revoke;
- revoke crypto device исключает устройство из future trust set, но не обязан закрывать все auth sessions автоматически;
- один аккаунт может временно иметь auth sessions без привязанного active crypto device;
- later web runtime должен переиспользовать уже существующий local `crypto device`, если локальный keystore сохранился;
- до такого runtime reuse `aero-identity` не должен пытаться угадывать crypto continuity по `user_device` record.

Для первой implementation фазы это означает:

- crypto registry реализуется отдельным storage model;
- `user_devices` и `user_sessions` не перепрофилируются в crypto registry;
- существующий web devices/sessions UI остаётся auth UI;
- различение auth device и crypto device станет отдельным later product slice.

### 9. Что должен включать первый implementation PR в `aero-identity`

Следующий implementation PR должен оставаться узким и backend-only по смыслу.

Он должен включать:

- storage model для crypto-device registry отдельно от `user_devices` и `user_sessions`;
- registry model для device states `pending_link`, `active`, `revoked`;
- storage для versioned public bundles;
- storage для one-time prekey или last-resort prekey inventory как public material без message-consumption logic;
- register/create flow для first device и pending linked device;
- list flow для собственных crypto devices аккаунта;
- read path для active public bundles по account/device identity, пригодный для следующих E2EE slices;
- publish/update bundle lifecycle;
- revoke/deactivate crypto device;
- ownership и state-transition checks;
- link intent creation/approval/expiry semantics;
- tests на first-device bootstrap, linked-device approval, list/revoke ownership, revoked-state behavior и bundle update rules.

Этот PR не должен включать:

- message encryption;
- media encryption;
- prekey consumption для реального message bootstrap;
- client keystore;
- browser crypto worker;
- backup blob storage;
- recovery UX;
- MLS;
- RTC;
- gateway/web UI redesign.

### 10. Что намеренно откладывается после ADR-056

Этот ADR и следующий registry implementation slice не должны тянуть за собой:

- direct message encryption;
- opaque message envelope migration;
- encrypted media relay;
- encrypted attachment metadata redesign;
- backup blob implementation;
- key export/import UX;
- MLS group crypto;
- RTC signaling или call device model;
- push notifications;
- PWA/offline worker semantics;
- settings UI для crypto devices;
- contact safety numbers;
- custom crypto inventions;
- server-side escrow любых plaintext keys.

## Последствия

### Положительные

- `Aero-identity` получает точную ownership boundary для первого crypto implementation slice.
- Разделение `auth device/session` и `crypto device` становится явным и больше не зависит от догадок.
- Linked-device ceremony перестаёт быть абстрактной идеей и получает минимально безопасный server contract.
- Future DM, media, recovery и RTC slices получают общий source of truth по device registry.

### Отрицательные

- Модель аккаунта становится сложнее: теперь у пользователя есть два разных device слоя.
- До отдельного web runtime и UI slice пользователь не увидит product-level различение auth и crypto devices.
- Recovery всё ещё остаётся намеренно неполным, пока не появятся отдельные ADR и implementation slices.

### Ограничения

- Нельзя объявлять после этого ADR реализованным E2EE.
- Нельзя auto-link новый device только через password login.
- Нельзя использовать `user_devices` как скрытый crypto registry shortcut.
- Нельзя добавлять account-level trust key “заодно”, пока не будет отдельной причины и ADR.

## Альтернативы

### 1. Переиспользовать текущие `user_devices` как crypto devices

Не выбрано, потому что текущая semantics `Login` создаёт новый `user_device`,
а значит ломает требование стабильной crypto identity.

### 2. Считать password login достаточным для auto-link нового trusted device

Не выбрано, потому что это разрушает границу между account authentication и crypto trust,
которую `ADR-055` зафиксировал как фундаментальную.

### 3. Ввести отдельный account-level trust key уже в первом registry slice

Не выбрано, потому что это преждевременно создаёт второй trust root
до решения по web keystore, recovery UX и backup semantics.

### 4. Ждать полного client runtime и не делать server registry заранее

Не выбрано, потому что тогда web/runtime, DM, media и RTC slices начнут проектировать device trust
без закреплённого backend source of truth.
