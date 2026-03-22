# ADR-055: E2EE, multi-device trust и encrypted media architecture foundation

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-002`, `ADR-004`, `ADR-006`, `ADR-018`, `ADR-029`, `ADR-030`, `ADR-031`, `ADR-035`, `ADR-039`, `ADR-042`,
`ADR-043`, `ADR-044`, `ADR-045`, `ADR-047`, `ADR-050`, `ADR-051`, `ADR-052`, `ADR-053` и `ADR-054`
в AeroChat уже существуют:

- account/password auth, `user_devices`, `user_sessions` и UI управления устройствами/сессиями;
- gateway-only edge и bounded realtime через `aero-gateway`;
- direct chats, groups, роли, membership policy, unread/read, edit, replies и server-side message search;
- attachment upload/download через presigned URLs и S3-compatible object storage;
- attachment lifecycle, quotas, retention и текущий media rendering path;
- web runtime, где bearer session token хранится в `sessionStorage`;
- только foundation-поле `key_backup_status`, но без реальной crypto/trust implementation.

Одновременно в репозитории всё ещё сохраняется текущая plaintext-first реальность:

- `direct_chat_messages.text_content` и `group_messages.text_content` остаются server-readable;
- `SearchMessages` опирается на PostgreSQL full-text index по plaintext;
- `reply_preview` и message snapshots собираются сервером из открытого содержимого;
- attachment metadata сейчас остаётся plaintext-oriented для UI и preview flow;
- current auth device/session model не является crypto device model;
- `aero-rtc-control` пока не содержит реального signaling/call contract.

Следующий архитектурный slice должен превратить завершённый security audit в конкретное,
репозиторно-специфичное решение, которое:

- станет source of truth для будущих E2EE PR;
- зафиксирует trust/device model до encrypted relay и RTC;
- явно разделит account authentication, crypto trust и browser runtime concerns;
- опишет, какие текущие chat/media semantics должны мигрировать;
- не будет внедрять реализацию, placeholder crypto code, fake schema/proto stubs и pseudo-E2EE.

Этот ADR является архитектурной спецификацией.
Он не меняет текущее поведение продукта в данном PR.

## Решение

### 1. Threat model и реалистичные границы защиты

AeroChat целится в модель, где E2EE должен защищать пользователя от:

- утечки PostgreSQL, object storage или backup-файлов сервера;
- любопытного или частично скомпрометированного relay/storage слоя;
- перехвата внутреннего backend/storage трафика;
- чтения message/media plaintext оператором через обычные server-side API, логи и БД;
- delayed/offline delivery через сервер без раскрытия server-readable content.

При этом сервер всё равно неизбежно будет знать:

- факт существования аккаунта, его login и account-level profile metadata;
- факт существования direct chat, группы и membership/role policy;
- список активных auth sessions и список зарегистрированных crypto devices;
- timestamps, порядок, размеры и частоту отправки сообщений;
- message ids, conversation ids и relay lifecycle metadata;
- attachment/object ids, ciphertext byte size, quota/retention state;
- viewer-relative policy state вроде membership, unread/read progression и moderation state;
- сетевые метаданные edge-уровня вроде IP, User-Agent, времени логина и websocket presence.

Для self-hosted web-first messenger фиксируется жёсткая граница:

- честный клиентский runtime может скрыть content от сервера;
- сервер не становится доверенной стороной для расшифровки истории;
- но malicious self-host operator, который контролирует доставку web bundle, может:
  - выдать модифицированный JavaScript;
  - отключить/suppress trust warnings;
  - украсть plaintext до шифрования и после расшифровки;
  - подменить linked-device ceremony;
  - выманить recovery key или backup passphrase;
  - selectively deny/delay/drop messages.

Следовательно, AeroChat в web-first self-host режиме может обещать:

- защиту от server-side plaintext storage и honest-but-curious operator;
- защиту от storage/relay compromise при честном клиентском коде;
- но не защиту от origin-level compromise самого web bundle.

Это ограничение не маскируется и не называется “полной безопасностью”.

### 2. Trust model: account auth не равен crypto trust

В AeroChat фиксируются две разные плоскости доверия:

- **account authentication**: сервер проверяет login/password и выдаёт session token;
- **crypto trust**: уже доверенное устройство решает, какой новый crypto device допускается к истории и future E2EE state.

Из этого следуют обязательные правила:

- password login на новом устройстве не должен автоматически давать доступ к старой E2EE history;
- server-issued auth session не должна считаться доказательством, что новый browser/device можно silently добавить в trusted crypto set;
- компрометация пароля или сервера не должна автоматически означать компрометацию всех прошлых сообщений.

Первое успешно инициализированное crypto device становится **first-device trust root** аккаунта,
пока пользователь не настроит recovery path или не свяжет второе доверенное устройство.

Добавление нового устройства должно происходить только через один из доверенных путей:

1. подтверждение с уже доверенного устройства;
2. восстановление через recovery key / encrypted backup;
3. отдельный явно задокументированный account reset flow с потерей старой crypto history.

На уровне UX это означает linked-device ceremony:

- новый auth session может запросить linking;
- сервер может relay'ить challenge/approval traffic;
- но сервер не принимает решение о crypto trust сам по себе;
- итоговый add-device должен подтверждаться доверенным устройством или recovery material.

Для доверия к удалённым пользователям принимается практичный компромисс:

- для первого контакта и первого наблюдения device list допустим **TOFU**;
- manual verification fingerprints/safety numbers допускается как later hardening layer;
- для собственных linked devices TOFU недостаточен: новый собственный device нельзя silently auto-trust.

### 3. Device model: долгоживущая crypto identity поверх текущих auth devices

Текущие `user_devices` и `user_sessions` из `aero-identity` остаются account/auth surface,
а не источником E2EE identity.

Вводится целевая модель, где у пользователя есть отдельный набор **crypto devices**:

- каждый crypto device имеет стабильный device identifier;
- у каждого crypto device есть долгоживущая identity/signing identity;
- device identity живёт дольше auth session и не пересоздаётся на каждый login;
- device add/remove/revoke становится отдельным доменным событием.

Каждый crypto device должен публиковать server-visible **public bundle**,
достаточный для standards-based asynchronous session bootstrap:

- device identity public key / signing identity;
- signed prekey material;
- post-quantum key agreement material для PQXDH;
- one-time или last-resort prekey material в объёме, достаточном для offline bootstrap;
- bundle metadata version и timestamps.

Эволюция текущей repo model фиксируется так:

- `user_devices` продолжает отвечать за UX “устройства и сессии”, revoke и account-level inventory;
- рядом появляется отдельный crypto-device registry, а не скрытая перегрузка существующего session token model;
- `key_backup_status` из identity-profile в будущем должен отражать именно crypto recovery state, а не auth convenience flag;
- frontend settings позже должен показывать различие между auth session и crypto device, а не смешивать их.

Семантика revoke/remove:

- revoke auth session закрывает доступ конкретного session token, но сам по себе не удаляет crypto identity;
- revoke/remove crypto device исключает устройство из future DM fanout и future group crypto membership;
- remove user from group должен удалять из group crypto roster все его активные crypto devices;
- group write restriction не удаляет device из crypto membership, если участник всё ещё имеет право читать историю;
- crypto revoke не означает, что сервер может “стереть” уже украденные локальные ключи у скомпрометированного устройства.

### 4. Направление для 1:1 E2EE

Для direct messaging выбирается только standards-based direction:

- **PQXDH** как initial asynchronous key agreement;
- **Double Ratchet** как основа message-level forward secrecy и post-compromise healing;
- **Sesame-like session management** как модель multi-device session orchestration.

Это означает, что целевая 1:1 архитектура AeroChat не строится на:

- custom handshake;
- ad-hoc “encrypted payload field” поверх текущего plaintext message row;
- едином account key без device separation.

Target architecture для direct chats:

- один логический direct message сохраняет stable `message_id`, `chat_id` и ordering metadata;
- для каждого активного recipient crypto device создаётся свой device-targeted ciphertext envelope;
- sender fan-out включает и другие доверенные устройства отправителя, чтобы multi-device history не зависела от server-side plaintext copy;
- сервер хранит ciphertext envelopes и relay metadata, а не plaintext text/reply preview.

Из этого следует, что текущая direct message semantics должна измениться:

- `text_content` перестаёт быть source of truth на сервере;
- server-rendered `TextMessageContent` не может оставаться канонической моделью;
- edit/reply content и user-visible preview должны происходить из decrypted client state;
- server-side full-text search по encrypted direct messages не сохраняется.

### 5. Направление для group E2EE

Для групп фиксируется целевой standards-based direction: **MLS**,
ориентированный на актуальные `MLS` и `MLS Architecture`, а не на custom sender-key design.

MLS выбирается как intended group direction, потому что он:

- проектирован именно для asynchronous group messaging;
- работает в модели client/device membership, а не только user-level membership;
- даёт стандартную модель add/remove/update/commit для группы;
- лучше соответствует будущему multi-device и group admin lifecycle, чем самодельный group ratchet.

В AeroChat это означает явное разделение двух уровней:

- `groups`, `group_memberships`, `owner/admin/member/reader`, invite links и moderation policy в `aero-chat` остаются product/policy source of truth;
- реальная crypto membership группы становится device-level reality и строится из активных trusted crypto devices пользователей, которые сейчас имеют право читать группу.

Практические следствия для текущих ролей:

- `owner`, `admin`, `member`, `reader` и write-restricted участник остаются полноправными читателями и потому должны присутствовать в group crypto membership;
- `remove` и `leave` исключают все device clients пользователя из group crypto roster;
- `restrict/unrestrict` меняет server-side send policy, но не должен сам по себе пересобирать read membership группы;
- ownership/admin/member policy продолжает решать, кто имеет право инициировать membership change на product-уровне,
  а crypto layer исполняет это как device-level add/remove/update.

Явно запрещается делать:

- custom group sender-key protocol;
- “pseudo-MLS” поверх текущего `group_messages.text_content`;
- смешение current membership policy и crypto roster в один неявный объект.

### 6. Переход message/storage model к opaque envelopes

Текущая plaintext-first schema несовместима с сильным E2EE, потому что репозиторий сейчас опирается на server-readable:

- `text_content`;
- `reply_to_message_id` + server-computed `reply_preview`;
- `edited_at` вместе с server-controlled text mutation;
- `search_vector`;
- realtime snapshots с plaintext payload.

Для AeroChat **opaque envelope** означает:

- сервер хранит versioned ciphertext payload;
- сервер хранит только тот минимум relay metadata, который нужен для ordering, fanout, unread/read и policy enforcement;
- сервер не хранит message plaintext, rendered markdown preview, search fragment и display-ready reply preview;
- клиентский runtime после расшифровки сам строит user-visible projection.

Для этого перехода текущие функции должны мигрировать семантически:

#### Edit

- edit больше не является server-side plaintext row mutation как основная модель;
- клиент должен публиковать новую encrypted revision для существующего logical message;
- `edited` marker остаётся продуктовой семантикой, но его смысл идёт из encrypted content lineage.

#### Replies

- reply relation не должна зависеть от server-generated plaintext preview;
- если stable reply target identifier останется серверно-видимым для routing/jump, это должно быть отдельным осознанным metadata tradeoff;
- в любом случае quoted preview text и display metadata становятся client-derived.

#### Search

- текущий PostgreSQL full-text search применим только к plaintext history;
- для encrypted chats серверный поиск по plaintext перестаёт быть допустимым;
- future encrypted search direction для текущего репозитория — local decrypted search на клиенте, а не server-side searchable ciphertext.

#### Reply preview

- текущий `reply_preview` из server projection не может оставаться source of truth;
- reply preview должен строиться из локально доступной decrypted history;
- сервер может вернуть только минимальные opaque references, если они реально нужны transport-слою.

#### Realtime snapshots

- realtime event families могут остаться прежними как transport shell;
- но payload должен мигрировать от plaintext message snapshot к opaque envelope snapshot;
- gateway не должен снова становиться местом, где появляется server-readable message projection.

При этом ряд вещей может сохраниться почти без изменений:

- stable conversation/message/attachment identifiers;
- direct chat, group, membership и role policy ownership;
- unread/read model на уровне logical message ids и ordering timestamps;
- moderation/policy enforcement в `aero-chat`;
- gateway-only внешний edge contract.

### 7. Направление для encrypted attachments и media

Текущий presigned upload/download flow сохраняется как relay foundation,
но меняется его содержимое:

- upload в object storage должен идти только как ciphertext blob;
- download через presigned URL должен возвращать только ciphertext blob;
- object storage и сервер больше не должны получать display plaintext медиа.

Для этого вводится целевая split-модель:

#### Relay metadata, которое сервер может знать

- `attachment_id`, scope, owner, linkage, lifecycle state;
- `bucket/object_key`;
- ciphertext byte size;
- quota, retention и delete lifecycle;
- техническая версия envelope/descriptor.

#### Encrypted display metadata, которое сервер не должен знать

- исходное имя файла;
- точный MIME type, если он нужен только для UI;
- plaintext размер, duration, dimensions, waveform/poster hints;
- media content key / nonce / digest / chunk info;
- attachment caption или иные user-facing display attributes.

В репозитории это означает:

- текущие attachment lifecycle, quotas, retention и presigned orchestration могут остаться в целом прежними;
- `aero-chat` по-прежнему может владеть attachment entity и storage lifecycle;
- но plaintext-oriented media assumptions должны быть позже удалены из API и UI.

Явно фиксируется, что дальнейший encrypted media path не должен:

- превращать `GetAttachment` в plaintext proxy;
- сохранять server-readable file metadata “для удобства preview”;
- вводить отдельный custom encrypted relay вне уже принятого presigned flow.

### 8. Browser key storage и runtime boundary

Текущий web runtime хранит bearer session token в `sessionStorage`,
что допустимо для обычной auth session,
но недостаточно для долгоживущих приватных crypto keys.

`sessionStorage` не подходит для crypto device identity, потому что:

- он tab-scoped и очищается при закрытии вкладки;
- он не даёт устойчивого device persistence;
- он плохо подходит для нескольких связанных вкладок и reload resilience;
- хранение long-lived private keys рядом с обычным UI-state увеличивает риск случайной утечки.

Высокоуровневое направление для web:

- долгоживущие private keys должны жить в browser-persistent storage, пригодном для device lifetime;
- для web это означает отдельный key store поверх browser-persistent storage вроде `IndexedDB` и browser crypto/runtime primitives, а не reuse auth session store;
- cryptographic operations желательно изолировать в dedicated crypto worker/runtime, а не выполнять в React/UI layer;
- UI/main thread должен работать с минимальными handle/reference semantics там, где это возможно.

Crypto worker / isolated runtime нужен как желательное направление, потому что он:

- уменьшает риск случайного попадания key material в app state, devtools-friendly объекты и логи;
- отделяет crypto orchestration от обычного UI-кода;
- даёт более чистую границу для future local search/index и media decryption.

При этом этот ADR сознательно **не** фиксирует:

- точный browser API набор;
- extractable/non-extractable policy для каждого ключа;
- точную схему unlock caching;
- background sync/service worker semantics;
- passkeys integration;
- офлайн-first/PWA behavior для crypto runtime.

Это будут отдельные implementation ADR.

### 9. Backup и recovery model

AeroChat принимает, что долгоживущий E2EE без recovery делает multi-device/web UX слишком хрупким,
но recovery не должен ломать trust model.

Поэтому целевое направление фиксируется так:

- backup представляет собой **encrypted backup blob**;
- backup может храниться на сервере или экспортироваться пользователем,
  но сервер не должен иметь plaintext keys;
- восстановление допускается либо через recovery key/passphrase, либо через already trusted device transfer;
- password login сам по себе не является sufficient recovery secret для старой E2EE history.

Явно запрещается:

- server-side escrow plaintext private keys;
- “удобная” server-assisted auto-recovery, где оператор технически может расшифровать историю;
- хранение export/import материала в виде обычного profile field или debug artifact.

Неизбежная UX цена фиксируется заранее:

- потеря всех trusted devices и recovery material может означать безвозвратную потерю старой encrypted history;
- возможен отдельный account crypto reset, но он должен означать именно потерю старого trust state, а не магическое восстановление;
- пользователю придётся явно понимать разницу между password login и history recovery.

### 10. RTC boundary

RTC implementation в этот ADR не входит.

Но фиксируется важная зависимость:

- call signaling и future media-E2EE не должны проектироваться раньше, чем зафиксированы crypto device identity и trust model;
- call eligibility, device join/leave и group call membership должны опираться на ту же device/trust direction, что и messaging;
- future RTC signaling/control должен оставаться рядом с account + device identity plane,
  а не вводить параллельную “call-only device truth”.

Что RTC может получить позже отдельным ADR:

- signaling/control contract;
- call membership mapping;
- SFU/media-plane boundary;
- отдельный media-E2EE direction для calls;
- device capability negotiation и one-active-call policy.

Что RTC должен ждать:

- crypto device registry;
- linked-device и revoke semantics;
- web key/runtime direction;
- group device-membership mapping.

### 11. Рекомендуемая staged roadmap после ADR-055

#### Slice 1. ADR-056: Crypto device registry, public bundles и linked-device ceremony

- Тип: docs-only
- Почему здесь: сначала нужно зафиксировать source of truth для device trust и server-visible bundle contract, иначе direct/media/RTC slices начнут импровизировать.
- Rough scope: medium

#### Slice 2. Identity implementation: crypto device registry и bundle lifecycle foundation

- Тип: implementation
- Почему здесь: после спецификации нужно дать `aero-identity` реальный device registry, publish/list/revoke path и backend ownership, не трогая ещё message encryption.
- Rough scope: large

#### Slice 3. ADR-057: Web key store, crypto worker и backup/recovery UX foundation

- Тип: docs-only
- Почему здесь: direct E2EE не стоит внедрять, пока не зафиксирован browser runtime для долгоживущих ключей и recovery path.
- Rough scope: medium

#### Slice 4. Web implementation: persistent key runtime, trusted-device link flow и encrypted backup bootstrap

- Тип: implementation
- Почему здесь: сначала нужно сделать реальный ключевой runtime в `apps/web`, иначе device registry останется только серверной сущностью без usable trust path.
- Rough scope: large

#### Slice 5. ADR-058: Opaque direct-message envelopes и plaintext semantic migration

- Тип: docs-only
- Почему здесь: перед кодом нужно точно описать logical message vs per-device ciphertext, edit/reply/read/search migration и transport impact для direct chats.
- Rough scope: large

#### Slice 6. Direct-message implementation: PQXDH bootstrap, Double Ratchet sessions и multi-device DM fanout

- Тип: implementation
- Почему здесь: только после device trust и web key runtime direct E2EE можно внедрять без pseudo-security.
- Rough scope: x-large

#### Slice 7. ADR-059: Encrypted attachment descriptor и ciphertext media relay contract

- Тип: docs-only
- Почему здесь: media должен опираться на уже решённую key/runtime/device model и reuse existing presigned flow, а не invent'ить свой crypto path.
- Rough scope: medium

#### Slice 8. Media implementation: ciphertext-only upload/download и encrypted attachment metadata

- Тип: implementation
- Почему здесь: encrypted media должно идти после direct trust/key runtime, но до group MLS и RTC, потому что attachment model уже сейчас часть core messaging semantics.
- Rough scope: large

#### Slice 9. ADR-060: MLS group membership mapping и group message envelope architecture

- Тип: docs-only
- Почему здесь: groups в AeroChat уже имеют развитую role/membership/moderation модель, и её нужно аккуратно связать с device-level MLS reality до начала реализации.
- Rough scope: large

#### Slice 10. Group implementation: MLS-based group E2EE foundation

- Тип: implementation
- Почему здесь: только после direct E2EE, encrypted media basics и отдельного MLS mapping ADR имеет смысл переходить к group crypto.
- Rough scope: x-large

### 12. Явные non-goals и postponements

В рамках текущего этапа и до следующих отдельных slices явно нельзя делать:

- custom cryptography или самодельный handshake;
- server-side searchable encrypted chat search;
- pseudo-E2EE поверх текущей plaintext schema;
- immediate encrypted relay implementation до device trust и key runtime;
- auto-trust нового устройства только по login/password;
- server-side escrow plaintext keys;
- custom group sender-key system вместо MLS direction;
- push/PWA polish до фиксации key storage/trust model;
- RTC implementation до фиксации trust/device direction;
- смешение auth session revoke и crypto device revoke в одну неявную операцию;
- proto/schema placeholder stubs “на будущее”, которые выглядят как уже принятая реализация.

### 13. Standards-based ориентиры

Этот ADR фиксирует направление, а не буквальный API-by-copy.
В качестве криптографических и архитектурных ориентиров принимаются:

- `MLS`: [RFC 9420, The Messaging Layer Security (MLS) Protocol](https://datatracker.ietf.org/doc/html/rfc9420)
- `MLS Architecture`: [RFC 9750, The Messaging Layer Security (MLS) Architecture](https://datatracker.ietf.org/doc/html/rfc9750)
- `PQXDH`: [Signal PQXDH specification](https://signal.org/docs/specifications/pqxdh/)
- `Double Ratchet`: [Signal Double Ratchet specification](https://signal.org/docs/specifications/doubleratchet/)
- `Sesame`: [Signal Sesame specification](https://signal.org/docs/specifications/sesame/)

Эти документы используются как source of truth для направления протокола,
а repo-specific transport/storage/runtime decisions по-прежнему фиксируются отдельными ADR внутри AeroChat.

## Последствия

### Положительные

- У проекта появляется конкретный и репозиторно-специфичный E2EE source of truth вместо абстрактного “future-ready”.
- Trust model отделяется от password auth до начала risky implementation work.
- Фиксируется честная security boundary для self-hosted web-first runtime без ложных обещаний.
- Direct messages, groups, media и RTC получают согласованную последовательность дальнейших slices.
- Снижается риск того, что encrypted relay, backup, MLS или RTC будут реализованы в неправильном порядке.

### Отрицательные

- Часть уже существующих функций придётся сознательно мигрировать или ослабить на сервере, особенно search и server-rendered previews.
- Web-only self-host модель сохраняет неприятную origin compromise boundary, которую нельзя “задокументировать как несуществующую”.
- Следующие slices станут сложнее и потребуют больше docs-first discipline, чем обычные plaintext feature PR.

### Ограничения

- Этот ADR не является crypto implementation.
- Этот ADR не утверждает, что текущая система уже E2EE.
- Этот ADR не фиксирует точные proto/schema changes.
- Этот ADR не решает RTC media encryption.

## Альтернативы

### 1. Оставить current plaintext schema и позже “надеть” на неё encryption fields

Не выбрано, потому что это приводит к pseudo-E2EE:
сервер продолжает быть source of truth для plaintext message semantics,
а crypto становится декоративным слоем.

### 2. Автоматически доверять новому устройству после password login

Не выбрано, потому что это превращает компрометацию пароля или сервера в компрометацию всей history decryption,
что ломает сам смысл multi-device trust model.

### 3. Делать groups через custom sender-key system

Не выбрано, потому что это создаёт собственный protocol surface там,
где уже существует подходящий standards-based direction через MLS.

### 4. Делать encrypted media раньше device trust и web key runtime

Не выбрано, потому что тогда media encryption опиралась бы на незафиксированную модель ключей и recovery,
а значит быстро превратилась бы в ещё один несовместимый special-case.
