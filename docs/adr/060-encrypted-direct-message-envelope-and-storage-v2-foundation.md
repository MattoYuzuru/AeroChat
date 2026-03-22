# ADR-060: Encrypted direct-message envelope and storage v2 foundation

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-055`, `ADR-056`, `ADR-057`, `ADR-058` и `ADR-059` в репозитории уже существуют:

- high-level направление для `PQXDH`, `Double Ratchet` и multi-device direct messaging;
- отдельный `crypto-device registry` в `aero-identity`;
- public bundles, `pending_link -> active` lifecycle и proof-bound hardening;
- web crypto runtime с persistent local crypto-device keys и worker boundary;
- gateway-only внешний edge и текущий bounded realtime transport.

Одновременно реальная direct-message модель в репозитории остаётся plaintext-first:

- `services/aero-chat/db/schema/000001_direct_chat_foundation.sql` хранит `direct_chat_messages.text_content`;
- `services/aero-chat/db/schema/000008_message_edit_foundation.sql` и текущие queries делают edit как in-place mutation этого текста;
- `services/aero-chat/db/schema/000009_reply_foundation.sql`, `docs/adr/044-*` и текущий domain/service слой строят `reply_preview` из server-readable текста;
- `services/aero-chat/db/schema/000010_message_search_foundation.sql`, `docs/adr/045-*` и `SearchMessages` завязаны на PostgreSQL full-text index по plaintext;
- `proto/aerochat/chat/v1/chat_service.proto` и `aero-gateway` публикуют full message snapshot c `text`, `reply_preview`, attachment metadata и `message_updated` причинами;
- web runtime и reducers ожидают, что сервер вернёт уже готовую user-visible message projection.

`ADR-055` намеренно оставил этот слой на более высоком уровне.
Он зафиксировал направление opaque envelopes и device fanout,
но не определил repo-specific direct-message envelope,
не отделил server-visible control-plane metadata от client-only ciphertext payload
и не ответил, как именно `aero-chat` должен сосуществовать с уже накопленной plaintext history.

Нужен следующий docs-only slice, который:

- станет source of truth для первой implementation-фазы encrypted direct messages;
- зафиксирует storage v2 direction без внедрения crypto/message/media кода;
- не объявит server-visible plaintext “временно допустимым”;
- не введёт custom crypto protocol;
- не смешает direct-message foundation с MLS, encrypted media relay, recovery, PWA/push или RTC.

Этот ADR не меняет текущее поведение продукта в данном PR.

## Решение

### 1. Почему текущая direct-message модель несовместима с сильным E2EE

Текущая direct-message модель несовместима с сильным E2EE не из-за одного поля,
а из-за целого server-readable стека.

#### 1.1. `text_content` является текущим source of truth

Сейчас канонический direct message body хранится в:

- `direct_chat_messages.text_content`;
- `markdown_policy`;
- transport projection `DirectChatMessage.text`.

Это означает:

- сервер хранит открытый текст как основную версию сообщения;
- `aero-chat` и `aero-gateway` опираются на него для list/get/search/realtime;
- потеря сервера или БД раскрывает содержимое сообщений без участия клиента.

Для сильного E2EE такое состояние неприемлемо.

#### 1.2. Server-side `reply_preview` опирается на открытый текст

Текущая reply semantics требует:

- `reply_to_message_id` в message row;
- server-built `reply_preview`;
- `text_preview`, derived author summary и `attachment_count` внутри обычного snapshot.

Такой preview сейчас собирается из server-readable target message.

При сильном E2EE сервер не должен:

- видеть quoted text;
- строить preview фрагмент;
- оставаться source of truth для quoted renderable content.

#### 1.3. Server-side search зависит от plaintext index

`SearchMessages` и `search_vector` работают только потому, что сервер знает:

- полный `text_content`;
- searchable lexemes;
- `ts_headline` fragments.

Это прямо противоречит opaque encrypted model.
Серверный full-text search по новым encrypted direct messages не может сохраниться без отдельного searchable-encryption решения,
которое в этом репозитории сейчас сознательно не выбирается.

#### 1.4. Текущая edit semantics мутирует plaintext строку

Сейчас direct-message edit:

- изменяет `text_content` in-place;
- выставляет `edited_at`;
- публикует уже обновлённый plaintext snapshot через существующий realtime family.

Для E2EE это неприемлемо, потому что:

- сервер не должен получать новый plaintext edit payload;
- edit больше не может быть “заменой текста в БД” как основная модель;
- revision semantics должна работать поверх opaque encrypted payload, а не поверх server-readable текста.

#### 1.5. Current realtime публикует полный user-visible message snapshot

`aero-gateway` сейчас публикует `direct_chat.message.updated` c:

- `chat`;
- `message`;
- `text`;
- `reply_preview`;
- attachments;
- `message_created` / `message_edited` / `message_deleted_for_everyone` / `message_pinned` / `message_unpinned`.

Это полный server-prepared snapshot для всех websocket-сессий участника.

При encrypted direct messages такой подход должен прекратиться:

- сервер больше не должен публиковать display-ready body;
- одинаковый payload больше не подходит всем устройствам пользователя;
- device-targeted ciphertext нельзя разослать как один user-scoped snapshot.

#### 1.6. Current attachment/media assumptions тоже plaintext-oriented

Текущий direct-message path исходит из того, что сервер знает attachment display metadata:

- `file_name`;
- `mime_type`;
- `size_bytes`;
- linkage message <-> attachment;
- current preview/open/download path.

Даже если encrypted media relay появится позже,
текущий direct message snapshot уже сейчас предполагает server-readable attachment projection.

Следовательно, encrypted direct-message v2 не может опираться на эту же renderable attachment semantics как на default.
Для первого encrypted DM slice attachment/media path не расширяется.

#### 1.7. Почему “просто добавить `encrypted_text` в текущие таблицы” нельзя

Подход “добавим `encrypted_text`, а остальное пока оставим” отвергается.

Причины:

- `text_content` останется вторым plaintext source of truth ради preview/search/realtime, а значит E2EE не будет честным;
- если `text_content` обнулить, текущие `reply_preview`, `SearchMessages`, generated `search_vector`, web reducers и proto snapshots перестанут соответствовать данным;
- один message row не покрывает per-device fanout:
  - у получателя несколько active crypto devices;
  - у отправителя тоже есть другие trusted devices;
  - один ciphertext не подходит всем target devices;
- текущий user-scoped realtime не знает, какой ciphertext какому устройству доставлять;
- смешение plaintext и ciphertext в одной canonical row создаёт dual model, которую позже всё равно придётся разрывать.

Следовательно, для AeroChat нужен отдельный encrypted direct-message v2 path,
а не косметическое поле рядом с уже существующей plaintext моделью.

### 2. Новая модель encrypted direct-message envelope

Для encrypted direct chats в AeroChat вводится **versioned opaque direct-message envelope v2**.

Это не отдельный custom crypto protocol.
Это репозиторная storage/transport модель поверх уже выбранного направления:

- bundle/bootstrap через `aero-identity`;
- asynchronous session establishment в духе `PQXDH`;
- message encryption и session evolution в духе `Double Ratchet`;
- multi-device orchestration в духе `Sesame-like` device fanout.

#### 2.1. Базовая структура модели

Один логический encrypted direct message состоит из двух слоёв:

1. **logical message record**
2. **device-targeted delivery envelopes**

`Logical message record` задаёт стабильную message identity внутри `direct_chat_id`.

`Device-targeted delivery envelope` хранит конкретный opaque payload для одного target crypto device.

Эта модель нужна, потому что:

- одно логическое сообщение должно иметь один stable `message_id` для read/pin/edit/delete;
- но ciphertext должен быть разным для разных target devices.

#### 2.2. Обязательные поля envelope-модели

Минимальная encrypted DM v2 модель обязана покрывать:

- `envelope_schema` или `envelope_version`;
- стабильный `message_id` логического сообщения;
- `direct_chat_id`;
- `sender_user_id`;
- `sender_crypto_device_id`;
- `recipient_user_id`;
- `recipient_crypto_device_id`;
- `operation_kind`;
- `revision`;
- opaque transport/session header;
- ciphertext bytes;
- metadata, достаточный для safe routing/store/retry.

`Operation_kind` в рамках архитектуры допустим как control-plane metadata.
Для первой волны direct-message v2 релевантны:

- `content`;
- `edit`;
- `tombstone`.

`Pin` не обязан быть частью ciphertext envelope и может остаться отдельной control-plane mutation.

#### 2.3. Что остаётся server-visible metadata

Серверно-видимым минимумом для encrypted DM v2 считаются только данные,
без которых `aero-chat` и `aero-gateway` не смогут:

- проверить принадлежность direct chat;
- определить sender/recipient ownership;
- выбрать target devices;
- сохранить order/idempotency/retry state;
- хранить user-level control-plane state.

В server-visible metadata допустимы:

- `message_id`;
- `direct_chat_id`;
- `sender_user_id`;
- `sender_crypto_device_id`;
- `recipient_user_id`;
- `recipient_crypto_device_id`;
- `operation_kind`;
- `target_message_id` для `edit` и `tombstone`;
- `revision`;
- `ciphertext_size_bytes`;
- `created_at`, `stored_at`, delivery timestamps;
- delivery status / retry counters / idempotency key;
- stable ordering metadata.

Серверу **не** разрешается трактовать эту metadata как право знать content semantics глубже нужного control-plane.

#### 2.4. Что обязано находиться внутри ciphertext

В ciphertext обязано находиться всё user-visible message content:

- текст сообщения;
- markdown/body payload;
- reply relation, если она нужна для UX;
- quoted preview text;
- client-rendered display metadata;
- любые attachment/media references, нужные для UI;
- edit payload новой ревизии;
- future content extensions, которые пользователь видит после расшифровки.

Сервер не должен видеть:

- plaintext text;
- renderable quoted preview;
- searchable fragments;
- display-ready attachment metadata для encrypted DM path;
- synthetic fallback preview ради совместимости с current UI.

#### 2.5. Клиент назначает stable logical message id заранее

Для encrypted DM v2 stable `message_id` должен появляться **до** device fanout.

Это фиксируется как client-assigned logical message identifier,
потому что:

- он нужен всем per-device ciphertext deliveries одного и того же logical message;
- он нужен для local optimistic state, edit/tombstone lineage и multi-device convergence;
- серверно-назначаемый ID после encrypt/fanout создавал бы лишний round-trip и ломал бы чистую envelope model.

`Message_id` должен быть opaque collision-resistant identifier.
Он не должен кодировать plaintext content.

### 3. Что означает storage v2 в этом репозитории

#### 3.1. Это параллельный v2 path, а не мутация legacy plaintext rows

Для AeroChat выбирается **parallel direct-message storage v2 path**.

Это означает:

- текущие `direct_chat_messages` и связанный вокруг них plaintext stack не становятся encrypted source of truth;
- encrypted direct messages получают отдельную persistence model;
- legacy plaintext rows не переписываются “на месте” и не становятся hybrid rows.

Причина выбора:

- так проще честно отделить plaintext history от opaque encrypted future;
- так не приходится поддерживать dual semantics в одной и той же таблице;
- так direct-message v2 может получить device fanout storage без искажения legacy schema.

#### 3.2. Storage v2 состоит из logical records и device-delivery records

На уровне направления репозитория storage v2 должен содержать:

- logical encrypted direct-message records;
- per-device encrypted delivery envelopes;
- control-plane state для revisions, tombstones, read progression и delivery lifecycle.

Точный schema design будет отдельным implementation detail,
но архитектурный инвариант уже фиксируется:

- хранение ciphertext и хранение логического message lifecycle разделяются;
- сервер не делает render-ready message projection из ciphertext;
- per-device delivery является first-class storage reality, а не эфемерной реализационной деталью.

#### 3.3. Что может оставаться server-visible в storage v2

Для encrypted direct messages сервер может оставлять видимыми только поля уровня control-plane:

- `direct_chat_id`;
- `message_id`;
- sender/recipient user ids;
- sender/recipient crypto device ids;
- stable ordering fields;
- delivery state и retry state;
- `edited_at` / revision metadata, если это нужно как control-plane;
- `tombstoned_at`, если delete-for-everyone фиксируется сервером;
- pin state;
- user-level read positions;
- unread counters;
- typing/presence state.

#### 3.4. Что обязано уйти из server-readable storage

Из server-readable storage обязаны уйти:

- plaintext body;
- server-rendered `TextMessageContent`;
- `reply_preview.text_preview`;
- server search fragments и `search_vector`;
- direct encrypted-message attachment preview metadata;
- любая display-ready message snapshot projection для encrypted path.

### 4. Device fanout model

#### 4.1. Target — это crypto devices, а не абстрактный пользователь

Для encrypted direct-message v2 delivery target определяется на уровне active crypto devices.

Это означает:

- сообщение отправляется не “пользователю как одному ящику”;
- сообщение fan-out’ится по device roster;
- delivery correctness оценивается по тому, какие crypto devices были active на момент отправки.

#### 4.2. Fanout обязательно включает другие trusted devices отправителя

При отправке encrypted direct message sender-side target set обязан включать:

- все active crypto devices получателя;
- все другие active crypto devices отправителя.

Это нужно, чтобы:

- multi-device history отправителя не зависела от server-side plaintext copy;
- новое сообщение появлялось на других устройствах отправителя через тот же encrypted delivery path.

Originating sending device может не требовать отдельную server-delivery копию самому себе,
потому что уже владеет локальным plaintext и local encrypted state.
Но остальные active devices отправителя обязаны получать свои device-targeted envelopes.

#### 4.3. Server role в device fanout

Роль сервера ограничивается следующим:

- получить target device roster через crypto-device registry;
- принять набор per-device envelopes;
- сохранить one-delivery-per-target-device;
- маршрутизировать delivery к соответствующему target device;
- держать retry/ack/offline-delivery metadata;
- не интерпретировать содержимое ciphertext.

Сервер не должен:

- раскрывать один device ciphertext другим устройствам;
- повторно шифровать payload за клиента;
- собирать universal plaintext snapshot “для удобства”;
- скрытно сводить device-targeted storage обратно к user-level plaintext projection.

#### 4.4. Что хранится для доставки, но не может интерпретироваться сервером

Сервер хранит для доставки:

- opaque transport/session header;
- ciphertext bytes;
- size/timestamp/status metadata;
- target device binding;
- retry state.

Сервер не может интерпретировать:

- body text;
- reply preview;
- attachment/media UI metadata;
- edit payload;
- client-visible content kind beyond bounded control-plane operation type.

### 5. Семантика функций при encrypted direct messages

#### 5.1. Replies и quoted previews

Для encrypted direct-message phase:

- quoted preview текст и user-visible author/content summary переходят в client-side decrypted semantics;
- server-side `reply_preview` перестаёт быть source of truth;
- reply relation для encrypted message path не должна требовать server-generated preview.

В этом ADR reply target для encrypted direct messages не фиксируется как обязательное server-visible поле.
Базовое правило:

- reply content и quoted preview должны быть восстановимы клиентом после расшифровки;
- если позже проекту понадобится server-visible reply jump reference для encrypted path,
  это потребует отдельного явно задокументированного решения.

#### 5.2. Edits

Для encrypted direct-message phase:

- stable logical `message_id` сохраняется;
- edit становится новой encrypted revision того же logical message;
- сервер видит только control-plane metadata:
  - `target_message_id`;
  - `revision`;
  - timestamps;
- edited text остаётся только в ciphertext.

Server-side plaintext row mutation больше не является моделью для encrypted path.

#### 5.3. Pins

`Pin/unpin` может остаться server-side control-plane функцией,
потому что для неё достаточно:

- `direct_chat_id`;
- `message_id`;
- actor identity;
- timestamps.

Но server-rendered pinned preview больше недопустим.
Клиент после decrypt должен сам показать текст/attachment summary pinned message.

#### 5.4. Unread/read

Для первой encrypted DM phase unread/read остаётся **user-level control-plane semantics**.

Это означает:

- сервер продолжает хранить user-scoped read progression по `direct_chat_id`;
- read position для encrypted path ссылается на logical encrypted `message_id`, а не на per-device envelope id;
- client отправляет read update после того, как нужный logical message реально получен и дешифрован.

Таким образом не вводится отдельная product-semantic “per-device unread” в этом ADR.

#### 5.5. Typing/presence

Typing и presence могут остаться server-side control-plane сигналами,
потому что они:

- не раскрывают message body;
- уже являются ephemeral viewer-relative metadata;
- не требуют plaintext message storage.

Для encrypted direct-message phase их не нужно переводить в ciphertext.

#### 5.6. Search

Search разделяется жёстко:

- legacy plaintext direct history остаётся searchable текущим server-side `SearchMessages`;
- encrypted direct messages не участвуют в server-side plaintext search;
- поиск по encrypted direct messages должен стать client-side local decrypted search,
  когда такой slice дойдёт до реализации.

Server-side encrypted search в этом ADR сознательно не вводится.

#### 5.7. Tombstone delete

`Delete for everyone` для encrypted direct-message phase остаётся server-side control-plane mutation по stable `message_id`.

Сервер может хранить:

- `tombstoned_at`;
- `deleted_by_user_id`;
- target logical message id.

Но сервер не должен:

- знать прошлый plaintext body;
- генерировать display-ready tombstone preview;
- обещать cryptographic erasure с уже доставленных устройств.

UI tombstone semantics после decrypt остаётся client-side render concern.

### 6. Realtime implications для текущего gateway

#### 6.1. Full message snapshot behavior должен прекратиться для encrypted path

Для encrypted direct-message v2 `aero-gateway` больше не должен публиковать `direct_chat.message.updated`
как full plaintext snapshot с:

- `text`;
- `reply_preview`;
- renderable attachment metadata.

Именно это поведение должно остановиться для encrypted path.

#### 6.2. Что gateway ещё может публиковать

Gateway может публиковать только:

- device-targeted encrypted envelope payloads;
- bounded control metadata, не раскрывающую body content;
- user-scoped control-plane события:
  - read/unread;
  - typing;
  - presence;
  - pin/unpin;
  - tombstone/edit revision metadata без plaintext body.

Минимально допустимая message-update metadata для encrypted path:

- `direct_chat_id`;
- `message_id`;
- `sender_user_id`;
- `sender_crypto_device_id`;
- `operation_kind`;
- `revision`;
- timestamps;
- при необходимости delivery identifiers.

#### 6.3. Device-scoped fanout внутри gateway-only edge

Текущий realtime hub в `aero-gateway` user-scoped.
Для encrypted DM v2 этого недостаточно.

Новый инвариант:

- websocket/session, участвующий в encrypted direct-message delivery, должен быть привязан к конкретному local `crypto_device_id`;
- gateway остаётся единственным публичным edge;
- но routing encrypted envelopes должен стать device-aware, а не просто `PublishToUser`.

Следовательно, encrypted direct-message realtime для AeroChat должен эволюционировать от:

- user-scoped full snapshot fanout

к следующему разделению:

- **device-scoped envelope delivery** для ciphertext;
- **user-scoped control-plane delivery** для тех событий, где payload одинаков для всех устройств пользователя.

Это укладывается в текущий gateway-only edge.
Менять внешний публичный topology не требуется.

### 7. Coexistence и migration strategy

#### 7.1. Старый plaintext history остаётся legacy data

Текущая plaintext direct-message history:

- остаётся в existing `direct_chat_messages` и связанных таблицах;
- не переобъявляется задним числом как “зашифрованная”;
- не конвертируется в background magic migration;
- не переписывается поверх encrypted v2 rows.

Это legacy data.

#### 7.2. Новые encrypted direct messages идут через отдельный v2 path

Все новые encrypted direct messages обязаны идти через:

- отдельный storage v2 path;
- отдельный realtime payload shape;
- отдельную message projection semantics.

Current plaintext path и encrypted v2 path не должны dual-write’иться в один и тот же canonical message row.

#### 7.3. Mixed-mode допускается только как forward coexistence, а не как hybrid row

Для AeroChat допускается только один вид mixed-mode:

- direct chat может иметь legacy plaintext history;
- позже тот же `direct_chat_id` может начать получать новые encrypted v2 messages;
- но каждый logical message принадлежит **ровно одному** mode.

Запрещается:

- один message одновременно как plaintext snapshot и как encrypted envelope;
- server fallback к plaintext copy ради encrypted UI;
- попытка держать `text_content` “на всякий случай” рядом с v2 ciphertext.

#### 7.4. Cross-mode semantics ограничиваются явно

Для coexistence path фиксируются жёсткие ограничения:

- encrypted v2 replies не должны зависеть от server-side preview legacy path;
- cross-mode edit не делается;
- server-side search распространяется только на legacy plaintext segment;
- encrypted segment не должен silently попадать в legacy `SearchMessages`;
- retro-encrypting старых plaintext сообщений не предпринимается;
- existing legacy history может оставаться доступной как legacy projection до отдельного migration/archival решения.

#### 7.5. Что специально не делается на этом этапе

На этом этапе прямо запрещается пытаться:

- retro-encrypt all plaintext direct history;
- задним числом fan-out’ить всю старую историю на все active devices;
- хранить временную server-readable plaintext копию новых encrypted messages;
- объединять encrypted DM migration с encrypted media relay;
- одновременно решать MLS groups.

### 8. Non-goals ADR-060

Этот ADR сознательно **не** определяет:

- group `MLS`;
- encrypted media relay implementation;
- recovery / backup implementation;
- QR / SAS verification UX;
- server-side encrypted search;
- push notifications или PWA work;
- RTC signaling/call implementation;
- полный trust-management UX;
- schema/proto/generated artifacts конкретной реализации.

### 9. Рекомендуемая последовательность следующих implementation PR

#### PR 1. Encrypted direct-message v2 envelope intake и opaque storage foundation

Первым должен идти PR, который:

- вводит новый proto/transport surface только для encrypted direct-message v2 create/list/fetch foundation;
- добавляет parallel storage v2 path в `aero-chat`;
- делает message bodies opaque для сервера;
- создаёт per-device delivery records;
- не трогает encrypted media и MLS.

Почему первым:

- без него нет канонического message/storage shape;
- без него невозможно честно доставлять encrypted DM даже polling/fetch path;
- encrypted media и MLS иначе будут проектироваться без settled direct-message opaque foundation.

#### PR 2. Gateway device-scoped realtime fanout для encrypted direct-message envelopes

Вторым должен идти PR, который:

- делает `aero-gateway` device-aware для encrypted DM sessions;
- заменяет full snapshot fanout на device-targeted envelope delivery;
- сохраняет user-scoped control-plane events для read/typing/presence/pin.

Почему вторым:

- realtime должен опираться на уже существующий storage/transport contract;
- иначе gateway будет пытаться пушить события без settled envelope model.

#### PR 3. Web encrypted direct-message rendering и local decrypted semantics foundation

Третьим должен идти PR, который:

- добавляет в `apps/web` encrypted direct-message inbox/outbox integration;
- строит local decrypted projection;
- переносит reply preview, edit rendering и encrypted search direction в client-derived model;
- не начинает encrypted media relay и MLS.

Почему третьим:

- после появления storage и realtime client уже может собирать честную local projection;
- до этого UI неминуемо скатится в temporary plaintext fallback или pseudo-E2EE.

### 10. Лучший immediate next implementation PR

Рекомендуемый следующий PR после `ADR-060`:

- Branch: `feat/chat-encrypted-dm-v2-envelope-storage-foundation`
- PR title: `feat(chat): add encrypted direct-message v2 envelope intake and opaque storage foundation`

Почему именно он должен быть следующим и почему раньше encrypted media и MLS:

- он создаёт первый реальный content-carrying E2EE path в репозитории;
- он закрепляет stable `message_id`, device fanout storage и opaque body model для direct chats;
- encrypted media relay без такого direct-message foundation рискует снова завязаться на plaintext message semantics;
- MLS для групп ещё шире по scope и должен опираться на уже честную repo-specific envelope/storage discipline, а не наоборот.

## Последствия

### Положительные

- У репозитория появляется конкретный source of truth для первой encrypted DM implementation wave.
- Становится явно запрещённой идея “временного plaintext рядом с ciphertext”.
- Device fanout и gateway realtime получают честную target model до начала кодовой реализации.
- Сосуществование legacy plaintext history и new encrypted path формулируется без retro-encryption обещаний.

### Отрицательные

- Direct-message implementation станет сложнее из-за parallel storage path и device-targeted deliveries.
- Current server-side conveniences вроде reply preview и search для encrypted path исчезают и должны переехать на клиента.
- Gateway realtime больше не сможет жить только user-scoped message snapshot model.

### Ограничения

- Этот ADR не считается реализацией E2EE.
- Он не даёт server-side encrypted search.
- Он не решает media encryption.
- Он не решает group crypto.
- Он не вводит recovery UX или QR/SAS verification.

## Альтернативы

### 1. Добавить `encrypted_text` в существующую plaintext row

Не выбрано, потому что это сохраняет dual model,
не решает per-device fanout
и почти наверняка оставляет server-readable content ради search/preview/realtime.

### 2. Полностью перевести direct chats на encrypted v2 in-place без legacy coexistence

Не выбрано, потому что это подталкивает к опасной попытке retro-migrate history,
ломает текущие plaintext flows одним шагом
и расширяет scope сильнее первого implementation slice.

### 3. Сначала делать encrypted media relay, а direct-message storage решить позже

Не выбрано, потому что media path тогда будет опираться на незафиксированную message envelope/storage model,
что снова смешает несколько фундаментальных доменов в одном шаге.
