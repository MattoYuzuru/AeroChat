# ADR-066: MLS foundation для encrypted group messaging

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-030` по `ADR-034`, `ADR-047`, `ADR-048`, `ADR-049`, `ADR-050` и `ADR-055` по `ADR-065`
в репозитории уже существуют:

- canonical group entity, primary thread, invite links, ownership transfer и bounded membership management внутри `aero-chat`;
- role/policy model `owner` / `admin` / `member` / `reader` и durable write restriction;
- plaintext group messages, replies, edit, unread/read, search и group realtime через `aero-gateway`;
- `crypto-device registry`, linked-device trust continuity и web crypto runtime boundary;
- encrypted direct-message v2 с opaque storage, device-aware delivery, local decrypt/render и outbound send;
- encrypted media relay v1, который уже спроектирован как общий ciphertext relay для direct chats и будущих groups.

Одновременно encrypted group messaging в репозитории всё ещё отсутствует:

- `group_messages` и текущие `GroupMessage` snapshots остаются plaintext-first;
- `group.message.updated` публикует full server-prepared snapshot;
- `SearchMessages` для groups опирается на server-readable plaintext history;
- роль и membership policy уже существуют на user-level, но device-level crypto membership для groups ещё не определена;
- `ADR-055` зафиксировал только высокоуровневое направление `MLS`, но не определил репозиторно-специфичную storage/transport,
  coexistence и migration model для groups.

Нужен следующий docs-only slice, который:

- станет source of truth для MLS-based encrypted groups в AeroChat;
- жёстко reuse’ит уже существующие trust/device/runtime/media foundations;
- не добавляет code, proto, schema, generated artifacts и placeholder implementation stubs;
- не объявляет реализованным group E2EE в этом PR;
- не вводит custom crypto protocol.

Этот ADR не меняет текущее поведение продукта в данном PR.

## Решение

### 1. Почему groups не могут просто скопировать текущую encrypted direct-message модель

#### 1.1. Per-device fanout для DM и group state решают разные задачи

`ADR-060` по `ADR-064` зафиксировали для direct chats модель:

- один logical message;
- набор per-device opaque deliveries;
- roster, вычисляемый из active devices двух пользователей;
- storage/fetch/realtime, привязанные к `viewer_crypto_device_id`.

Для 1:1 это работает, потому что participant set узкий и почти статичный:

- есть только два пользователя;
- send roster строится заново на каждый send;
- sender и recipient set понятны без отдельного group state machine.

Для groups этого недостаточно, потому что group crypto зависит не только от конкретного сообщения,
а от длительно живущего общего состояния группы:

- состав участников меняется;
- у каждого участника несколько устройств;
- device roster должен сходиться между всеми отправителями и получателями;
- один и тот же отправитель не должен каждый раз заново “изобретать” group membership на момент send.

#### 1.2. Membership changes требуют общей crypto-state эволюции, а не только нового fanout

В group path значимы не только новые сообщения, но и сами изменения membership:

- join;
- add нового устройства участника;
- remove участника;
- leave;
- revoke устройства;
- ownership/admin-driven membership actions.

Если копировать DM-модель буквально,
каждый новый group message стал бы отдельным per-device fanout по текущему server roster.
Это не даёт общей и проверяемой crypto-state timeline:

- кто именно уже исключён из future decrypt set;
- какой device roster был актуален на момент сообщения;
- какой membership transition сделал прошлый roster устаревшим.

Для long-lived group нужен общий crypto state с явными add/remove/update/commit переходами,
а не только много ciphertext-копий одного текста.

#### 1.3. Post-removal confidentiality нельзя честно получить direct bootstrap codec’ом

Для groups требуется явное правило:

- после `remove` или `leave` все устройства удалённого пользователя должны потерять доступ к будущим encrypted group сообщениям.

В DM v2 bootstrap lane removal достигается только тем,
что следующий sender больше не включит device в новый per-message roster.
Для группы этого недостаточно, потому что нужен единый и проверяемый момент отсечения:

- future сообщения должны идти уже из нового group state;
- stale roster не должен оставаться допустимым “по привычке” у разных отправителей;
- серверный remove/leave event сам по себе не равен crypto eviction.

Следовательно, post-removal confidentiality для groups требует group rekey/state transition,
а не только очередной send с другим fanout списком.

#### 1.4. Sender/recipient set в group меняется во времени и не является pairwise постоянным

В encrypted direct chat sender знает:

- одного собеседника;
- свои secondary devices;
- originating sender device.

В группе recipient set:

- зависит от текущего membership;
- зависит от текущего набора active crypto devices у каждого участника;
- меняется при linked-device approve/revoke;
- меняется при invite/join/remove/leave;
- должен оставаться согласованным между всеми членами группы.

Это уже не pairwise delivery problem.
Это проблема общего group membership state.

#### 1.5. Direct bootstrap codec недостаточен для long-lived groups

Текущий encrypted DM v2 bootstrap codec полезен как узкий transport/decrypt foundation для 1:1.
Он не должен становиться hidden group protocol по следующим причинам:

- он не задаёт group epoch/state;
- он не задаёт стандартную модель add/remove/update/commit;
- он не задаёт правила device-leaf membership внутри группы;
- он не решает post-removal confidentiality как group transition;
- он не предназначен быть канонической моделью для долгоживущей группы с меняющимся составом.

Следовательно, для AeroChat группы не получают “многоадресный DM v2”.
Им нужен отдельный standards-based group crypto direction.

### 2. Почему MLS является выбранной архитектурой

#### 2.1. MLS уже является зафиксированным intended direction для groups

`ADR-055` уже закрепил,
что groups в AeroChat должны идти в сторону `MLS`,
а не в сторону самодельного group ratchet или sender-key scheme.

`ADR-066` делает этот выбор репозиторно-специфичным и операционным:

- user-level group policy остаётся в `aero-chat`;
- device-level encrypted group membership строится через `MLS`;
- transport/storage/realtime проектируются сразу под эту модель.

#### 2.2. Почему не custom sender-key и не ad hoc group crypto

Для AeroChat запрещено строить custom sender-key / ad hoc group crypto,
потому что такой путь заставил бы проект самостоятельно придумывать:

- как добавлять новые устройства в уже существующую группу;
- как удалять участника и отрезать future decrypt;
- как делать device update/rekey;
- как кодировать membership changes;
- как держать state согласованным у нескольких устройств пользователя;
- как разделить user policy и device membership without hidden edge cases.

Это прямо противоречит `AGENTS.md` и `ADR-055`:

- криптография не импровизируется;
- pseudo-E2EE недопустим;
- group protocol не должен вырастать из случайного bootstrap codec.

#### 2.3. Server policy source of truth и crypto reality остаются разными слоями

В AeroChat сохраняется два уровня истины:

- **server-side product policy**
  - `groups`;
  - `group_memberships`;
  - роли `owner` / `admin` / `member` / `reader`;
  - invite links;
  - moderation state;
  - ownership transfer;
  - unread/read и прочий control-plane;
- **device-level crypto reality**
  - какие `crypto_device_id` сейчас действительно входят в MLS roster этой группы;
  - какой group state/epoch у них актуален;
  - какие encrypted group envelopes они могут расшифровать.

Server policy отвечает на вопрос:
кто продуктово имеет право читать, писать, приглашать, удалять и ограничивать.

MLS отвечает на вопрос:
какие конкретные trusted devices сейчас являются членами encrypted group state.

Эти два слоя не сливаются в один объект.
Сервер не становится владельцем group plaintext.
Клиент не становится владельцем product policy.

### 3. Repo-specific MLS group model для AeroChat

#### 3.1. User-level membership и device-level MLS membership фиксируются отдельно

В репозитории сохраняются уже существующие user-level сущности:

- `group`;
- `group_membership`;
- primary thread;
- invite links;
- moderation state.

Для encrypted group path поверх этого вводится device-level MLS membership:

- каждая group encrypted lane имеет свой MLS group state;
- в этот state входят не пользователи, а конкретные active trusted `crypto_device_id`;
- один пользователь может иметь несколько device leaves;
- `pending_link`, revoked и auth-only devices никогда не входят в MLS membership.

#### 3.2. Кто считается читающим участником encrypted group

Для encrypted groups читающим участником считается любой current member,
который по server-side policy имеет read access к группе:

- `owner`;
- `admin`;
- `member`;
- `reader`;
- write-restricted `member` или `reader`, потому что restriction запрещает write, но не чтение.

Следствия:

- write restriction не удаляет device из MLS roster;
- remove и leave удаляют все active device leaves этого пользователя из MLS roster;
- ownership transfer сам по себе не удаляет leaves, а только меняет policy authority;
- invite link ещё не означает MLS membership, пока у вошедшего пользователя нет активного trusted crypto device.

#### 3.3. Активные crypto devices участвуют как first-class leaves

Для current readable member в MLS membership должны участвовать его active trusted crypto devices.

Практические правила:

- первое active trusted device пользователя может участвовать в encrypted group lane;
- linked new device после `pending_link -> active` становится eligible leaf для тех групп,
  где пользователь сейчас состоит и имеет read access;
- revoke/remove crypto device удаляет только этот device leaf, а не всё user membership целиком;
- auth session без active local crypto device не считается group crypto participant.

Для первой encrypted group activation выбирается консервативное правило:

- группа не должна переключаться на encrypted lane,
  пока у каждого current readable member нет хотя бы одного active trusted crypto device.

Это нужно, чтобы server-side read membership не расходился с crypto reality уже в момент включения шифрования.

После активации допустима временная деградация,
если у участника позже временно не осталось ни одного active device:

- его server-side membership сохраняется;
- plaintext fallback не появляется;
- доступ к future encrypted history возвращается только после добавления нового active device leaf.

#### 3.4. Mapping ролей на право add/remove/update device leaves

В AeroChat право управлять group device leaves подчиняется уже существующей role/policy matrix,
а не вводится как отдельная “crypto admin role”.

Фиксируются следующие правила:

- `owner`
  - может инициировать или подтверждать add/remove/update leaves для собственных устройств;
  - может инициировать или подтверждать add/remove/update leaves для любого current readable участника группы;
  - остаётся единственным actor, который может менять owner-level product policy;
- `admin`
  - может инициировать или подтверждать add/remove/update leaves для собственных устройств;
  - может инициировать или подтверждать add/remove/update leaves только для пользователей с ролями `member` и `reader`;
  - не может управлять owner leaves;
  - не получает скрытого права управлять leaves других `admin`, кроме случаев собственных устройств;
- `member`
  - может инициировать add/update/remove только для собственных active devices,
    пока его membership остаётся текущим и читающим;
  - не может управлять leaves других пользователей;
- `reader`
  - может инициировать add/update/remove только для собственных active devices,
    потому что read access требует device participation;
  - не может управлять leaves других пользователей.

Такой mapping нужен, чтобы:

- новые linked devices обычного участника могли реально появляться в encrypted group;
- owner/admin policy не ломалась;
- `reader` не превращался в product member без decrypt-capable device path.

#### 3.5. Как server control-plane остаётся видимым

Серверу остаются видимыми только те group metadata,
которые нужны для product policy, transport и lifecycle:

- `group_id`;
- `thread_id`;
- стабильный logical `message_id`;
- `sender_user_id`;
- `sender_crypto_device_id`;
- operation/control kind;
- `target_message_id`, если он нужен для edit/reply/pin jump semantics;
- group state reference:
  - `mls_group_id`;
  - epoch/commit reference;
  - roster version или эквивалентный control-plane marker;
- membership/invite/moderation/ownership state;
- unread/read progression;
- attachment ids и relay schema;
- ciphertext size, timestamps, ordering metadata;
- device authorization metadata, достаточный для fetch/realtime gating.

Серверу не разрешается превращать эти поля в скрытый plaintext projection layer.

### 4. Как текущие group features должны пережить encrypted transition

#### 4.1. Group messages

Group messages становятся encrypted MLS application messages:

- сервер хранит opaque envelope;
- renderable body появляется только после client-side decrypt;
- `GroupMessage.text` и server-prepared plaintext snapshot не остаются source of truth для encrypted lane.

Это **client-side after decrypt**.

#### 4.2. Typing

Group typing остаётся ephemeral control-plane signal:

- server-visible;
- bounded;
- role-aware;
- без plaintext message body.

Typing не требует server-readable content и может остаться текущим server-side ephemeral layer.

Это **control-plane**.

#### 4.3. Moderation и restriction

Moderation остаётся server-side policy source of truth:

- remove;
- restrict/unrestrict;
- role updates;
- ownership transfer.

При этом encrypted group lane обязана уважать эти решения так:

- `restrict` блокирует send/typing, но не удаляет leaves читающего участника;
- `remove` и `leave` обязаны инициировать MLS removal для всех active devices пользователя;
- future encrypted content после remove/leave должно идти уже из нового group state.

Это **control-plane**, который приводит к crypto-state transitions там, где это требуется.

#### 4.4. Invite links и join

Invite links и join остаются server-side capability/control-plane моделью.

После successful join:

- пользователь становится product member группы;
- его active trusted devices должны быть добавлены в MLS membership;
- только после этого encrypted group lane становится реально доступной на этих устройствах.

Invite link secret сам по себе не является crypto group secret.

Это **control-plane** с последующей crypto roster синхронизацией.

#### 4.5. Ownership transfer

Ownership transfer остаётся server-visible product event.
Он меняет:

- кто может управлять roles;
- кто может authorise broader membership/device transitions.

Ownership transfer не означает автоматический plaintext fallback
и не делает сервер владельцем group content.

Это **control-plane**.

#### 4.6. Removal и leave

Removal и leave остаются server-visible commands,
но для encrypted groups всегда имеют и crypto consequence:

- удаляются все active device leaves пользователя;
- future encrypted content должно идти только после нового valid group state;
- removed user не должен получать future encrypted group envelopes на старом device roster.

Это **control-plane + mandatory crypto transition**.

#### 4.7. Pins

В репозитории сейчас нет отдельного group pin foundation,
но для будущего encrypted group path уже фиксируется правило:

- pin/unpin, если и когда появится для groups,
  остаётся server-visible control-plane поверх stable opaque `message_id`;
- pin никогда не должен требовать server-readable body;
- server не строит pin preview из plaintext.

Это **control-plane**.

#### 4.8. Unread/read

Unread/read для groups может сохраниться как server-visible модель:

- stable logical `message_id`;
- ordering timestamps;
- user-level read progression.

Серверу не нужно знать plaintext,
чтобы считать progression по opaque logical messages.

Это **control-plane**.

#### 4.9. Search

Текущий server-side plaintext search не переживает encrypted lane.

Для encrypted group messages фиксируется направление:

- search выполняется по локально расшифрованной истории на клиенте;
- сервер не строит searchable ciphertext и не индексирует plaintext новых encrypted group messages;
- legacy plaintext group history может оставаться searchable только внутри legacy path.

Это **client-side after decrypt**.

#### 4.10. Replies и edits

Replies и edits должны эволюционировать так:

- stable target identifiers могут оставаться минимальным control-plane metadata,
  если они нужны для ordering/jump/reconciliation;
- quoted preview text не должен строиться сервером;
- reply preview строится локально из decrypted history;
- edit становится новой encrypted revision/control operation,
  а не server-side plaintext mutation строки.

Это **минимальный control-plane для ids** и **client-side after decrypt для user-visible content**.

### 5. Направление для encrypted group message/storage

#### 5.1. Для groups выбирается opaque group envelope model

Encrypted groups в AeroChat не должны использовать текущие plaintext `group_messages` как hybrid rows.

Для encrypted lane выбирается отдельная opaque storage direction:

- group-scoped logical encrypted message/control record;
- opaque ciphertext envelope;
- group state / epoch reference;
- control-plane metadata, достаточный для product/runtime orchestration.

#### 5.2. Что сервер хранит

Для encrypted group messages сервер хранит только минимум:

- `group_id`;
- `thread_id`;
- `message_id`;
- `sender_user_id`;
- `sender_crypto_device_id`;
- operation/control kind;
- `target_message_id`, если он нужен для control-plane linkage;
- epoch/commit reference;
- ciphertext bytes;
- ciphertext size;
- created/stored timestamps;
- ordering metadata;
- attachment ids и relay schema, если сообщение ссылается на encrypted media relay;
- fetch/realtime authorization metadata.

Нормальный group content path должен быть **group-scoped**,
а не per-device fanout как в DM v2.

Исключение допускается только для MLS bootstrap artifacts уровня join/add-device,
если runtime later потребует device-targeted welcome material.
Но это не должно становиться основной моделью group history.

#### 5.3. Что обязано оставаться только в ciphertext

В ciphertext обязано находиться всё user-visible содержимое encrypted group lane:

- текст;
- markdown/body payload;
- quoted preview data;
- reply display metadata;
- edit payload/revision body;
- attachment descriptors;
- file keys и decrypt parameters;
- любые будущие renderable extensions.

#### 5.4. Что нельзя rebuild’ить как server plaintext projection

Для encrypted group lane серверу запрещено строить новый plaintext stack наподобие текущего:

- `GroupMessage.text`;
- server-generated `reply_preview`;
- `search_vector` и `match_fragment`;
- plaintext attachment display metadata;
- full realtime snapshots, которые выглядят как нынешний `group.message.updated`.

Это особенно важно,
чтобы encrypted groups не превратились в “MLS рядом с тем же plaintext backend model”.

#### 5.5. Как это связано с direct-message v2

Encrypted groups и encrypted DM v2 имеют общие принципы:

- opaque envelopes;
- client-side decrypt/render;
- gateway-only edge;
- stable logical ids;
- separate control-plane metadata;
- отсутствие server-readable projection.

Но storage model различается принципиально:

- direct-message v2 хранит per-device deliveries;
- encrypted group lane хранит group-scoped encrypted history, привязанную к общему MLS state,
  а не копию ciphertext на каждое устройство для каждого сообщения.

### 6. Realtime и transport direction для encrypted groups

#### 6.1. Plaintext-style full snapshots запрещаются

Текущая family `group.message.updated` с full `GroupMessage` snapshot не подходит для encrypted lane,
потому что сервер не должен знать:

- текст;
- reply preview;
- display-ready attachment metadata.

Кроме того, encrypted group delivery зависит не только от user membership,
но и от конкретного bound crypto device и его membership в текущем MLS state.

#### 6.2. Для encrypted groups нужен отдельный realtime family

Encrypted group lane должна получить отдельный realtime family,
отделённый от legacy plaintext groups.

В рамках этого ADR фиксируется направление:

- legacy plaintext groups продолжают использовать существующие group event families;
- encrypted groups используют отдельный family наподобие `encrypted_group_message_v1.delivery`.

Его payload должен содержать только:

- `group_id`;
- `thread_id`;
- `message_id`;
- `sender_user_id`;
- `sender_crypto_device_id`;
- operation/control kind;
- `target_message_id`, если есть;
- epoch/commit reference;
- ciphertext;
- ciphertext size;
- created/stored timestamps.

#### 6.3. Что может остаться server-visible в realtime/control plane

Server-visible и realtime-visible metadata допускаются только там,
где они реально нужны transport/policy слоям:

- membership/invite/moderation/ownership events;
- unread/read progression;
- typing;
- stable ids;
- timestamps;
- epoch/commit references;
- attachment relay ids;
- viewer/device authorization metadata.

#### 6.4. Gateway-only edge сохраняется, но delivery становится group-aware и device-aware

`Aero-gateway` остаётся единственной публичной realtime edge-точкой.
Для encrypted groups он должен reuse’ить device-binding discipline из `ADR-061`:

- websocket session сначала проходит обычную auth;
- затем явно bind’ится к active `crypto_device_id`;
- encrypted group delivery допускается только bound sessions тех devices,
  которые сейчас имеют право участвовать в encrypted group state.

Следствия:

- user-scoped broadcast “на все сессии пользователя” для encrypted group lane недостаточен;
- gateway должен учитывать и user membership, и device membership;
- server-visible control-plane events могут оставаться user-scoped,
  а encrypted group message delivery должен быть device-aware.

### 7. Переиспользование encrypted media relay из ADR-065

#### 7.1. Для groups не появляется вторая media architecture

`ADR-065` уже зафиксировал,
что encrypted media relay v1 является общей foundation для direct chats и будущих groups.

Это решение сохраняется жёстко:

- те же `attachment` сущности;
- тот же presigned ciphertext-only relay;
- тот же `relay_schema = encrypted_blob_v1`;
- те же lifecycle/quota/retention semantics;
- тот же split между server-visible relay metadata и encrypted descriptor.

#### 7.2. Что остаётся тем же самым

Для encrypted group media остаются теми же:

- ciphertext-only object relay в object storage;
- `CreateAttachmentUploadIntent` / `CompleteAttachmentUpload` / `GetAttachment`;
- relay metadata уровня `attachment_id`, `bucket/object_key`, `size_bytes`, `relay_schema`;
- cleanup, quota и retention на основе ciphertext-visible bytes и backend state.

#### 7.3. Что меняется только на message/descriptor/group-key уровне

Для groups меняется не storage relay,
а только то, как descriptor попадает к участникам:

- encrypted attachment descriptor встраивается в MLS-protected group message payload;
- file key/decrypt metadata распространяются через encrypted group content,
  а не через DM per-device envelope;
- attachment остаётся тем же ciphertext relay object,
  но descriptor теперь связан с group state и group message lineage.

Следовательно:

- не вводится второй media transport для groups;
- не вводятся group-only attachment tables;
- не вводится server-side plaintext preview path ради encrypted groups.

### 8. Coexistence и migration strategy

#### 8.1. Legacy plaintext group history сохраняется как отдельный path

Текущая plaintext group history остаётся существовать в своём нынешнем виде:

- `group_messages`;
- current replies/edit/search projections;
- current plaintext realtime families;
- current plaintext group attachments.

Этот ADR не переписывает и не “перешифровывает” уже существующую историю.

#### 8.2. Encrypted group path должен быть только forward-only

Для MLS groups выбирается forward-only migration model:

- encrypted lane начинается с явного encrypted bootstrap/cutover;
- новые encrypted сообщения живут только в opaque group path;
- старые plaintext group messages не переносятся в encrypted storage задним числом;
- сервер не делает historical re-encryption.

#### 8.3. Что не нужно пытаться сделать на первом этапе

На первом encrypted group этапе не нужно пытаться:

- объединить old plaintext и new encrypted history в “магически единый” server-readable timeline;
- dual-write один и тот же logical message и в plaintext, и в encrypted lane;
- backfill старые reply previews, search index и attachment projections в новый encrypted path;
- обещать cross-lane full feature parity уже в первом implementation slice.

#### 8.4. Mixed-mode coexistence допустим только в явных границах

Mixed-mode coexistence допустим в двух формах:

- на уровне разных групп:
  - одни группы могут оставаться legacy plaintext;
  - другие могут перейти в encrypted lane;
- внутри одной группы:
  - legacy plaintext history остаётся только до явной границы cutover;
  - дальше история становится forward-only encrypted.

Что запрещено:

- писать новые encrypted group messages в plaintext fallback path;
- скрывать от пользователя границу между legacy plaintext history и encrypted future;
- считать old plaintext history “защищённой постфактум”.

### 9. Non-goals ADR-066

Этот ADR сознательно не определяет и не реализует:

- actual MLS implementation code;
- group encrypted message code;
- group encrypted media code;
- group call crypto;
- encrypted media thumbnails, posters, transcoding и preview pipeline;
- backup/recovery implementation;
- full encrypted feature parity c legacy group UX;
- push/PWA work;
- RTC/signaling implementation;
- contact verification UX и broad trust-center redesign;
- server-side searchable encryption.

### 10. Рекомендуемая последовательность следующих implementation PR

#### 10.1. Первый PR

`feat(group): add MLS control-plane and opaque encrypted group envelope foundation`

Порядок выбран первым, потому что без него нет стабильной базы для всего остального:

- device-level group roster;
- group-scoped opaque storage;
- epoch/control metadata;
- fetch/realtime contracts;
- coexistence boundary с legacy plaintext groups.

#### 10.2. Второй PR

`feat(web): add MLS encrypted group runtime, local projection and outbound text bootstrap`

Он должен идти вторым,
потому что только после server-backed control-plane/storage можно честно делать:

- web join/sync runtime;
- local decrypt/render projection;
- outbound text-only encrypted group send;
- explicit coexistence UI с legacy plaintext history.

#### 10.3. Третий PR

`feat(group): integrate ADR-065 encrypted media relay into MLS group lane`

Он должен идти третьим,
потому что encrypted media для groups должно подключаться уже к существующему:

- MLS group message path;
- local decrypt/render runtime;
- opaque attachment descriptor handling;
- established coexistence model.

Именно поэтому media идёт после text/control-plane,
а не раньше.

### 11. Лучший immediate next implementation PR

Рекомендуется ровно один следующий PR:

- branch name: `feat/group-mls-control-plane-and-opaque-envelope-bootstrap`
- PR title: `feat(group): add MLS control-plane and opaque encrypted group envelope foundation`

Почему именно он должен идти первым:

- без него невозможно зафиксировать authoritative device-level group roster;
- без него нельзя честно задать group-scoped opaque storage и realtime contracts;
- без него любые попытки делать encrypted replies/edits/search/unread parity будут строиться поверх ещё неустойчивой модели;
- он отделяет product policy, crypto membership и transport до того,
  как фронтенд начнёт восстанавливать feature surface.

Почему он должен reuse’ить `ADR-065`, а не придумывать новый media path:

- group encrypted architecture уже обязана считаться с тем,
  что encrypted attachments будут ссылаться на тот же `attachment` relay contract;
- если в первом group PR заложить другой media direction,
  later encrypted media integration сломает storage/lifecycle/quota consistency;
- reuse `ADR-065` позволяет оставить media relay вне первого PR по коду,
  но не потерять совместимость envelope/control-plane модели с будущими group attachment descriptors.

## Последствия

### Положительные

- В репозитории появляется конкретная, а не абстрактная MLS-spec foundation для groups.
- Group E2EE direction reuse’ит уже существующие trust/device/runtime/media решения,
  а не начинает новый параллельный стек.
- Чётко разделяются product policy, device-level crypto membership и opaque message/storage model.
- Legacy plaintext groups и future encrypted groups получают ясную coexistence boundary без security theater.

### Отрицательные

- Архитектура groups становится двухслойной:
  server product policy и device-level crypto reality придётся держать согласованными.
- Первая encrypted activation группы потребует device readiness всех current readable members.
- Search и часть render-ready server conveniences для encrypted lane больше не смогут опираться на plaintext backend projection.

### Ограничения

- Этот ADR не делает groups encrypted “готовыми”.
- Он не разрешает смешивать current plaintext group messages и future encrypted group messages в один hidden hybrid model.
- Он не разрешает строить group E2EE поверх direct bootstrap codec или нового ad hoc sender-key design.
- Он не разрешает invent’ить отдельный media architecture для groups.

## Альтернативы

### 1. Копировать current encrypted direct-message v2 модель почти без изменений

Не выбрано,
потому что per-device fanout для 1:1 не задаёт общую long-lived group membership state machine
и не даёт честной модели remove/leave/update для groups.

### 2. Построить custom sender-key или ad hoc group ratchet

Не выбрано,
потому что это заставило бы репозиторий самостоятельно придумывать group crypto protocol,
что прямо противоречит уже зафиксированным инвариантам.

### 3. Оставить groups plaintext, а зашифровать только attachments

Не выбрано,
потому что это сохранило бы главный confidentiality gap:
server-readable plaintext group message history.

### 4. Сразу пытаться объединить historical plaintext groups и future encrypted groups в один transparent timeline

Не выбрано,
потому что это раздувает scope, маскирует границу безопасности
и почти гарантированно тащит обратно server-readable fallback semantics.
