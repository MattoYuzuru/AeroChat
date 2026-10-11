# ADR-097: Trusted authorization contract для group media admission

- Статус: Accepted — architecture/model review координатором 2026-10-11; runtime enforcement ещё не реализован
- Дата: 2026-10-11
- Задача: [#176](https://github.com/MattoYuzuru/AeroChat/issues/176)
- Предпосылка: принятый [ADR-089](089-group-audio-sfu-and-admission-boundary.md)

## Контекст

`aero-rtc-control` сегодня проверяет bearer через Identity `GetCurrentProfile` и получает только user ID. Проверка Chat использует bearer текущего пользователя. Эти публичные операции достаточны для lobby, но не дают независимую проверку исходной auth session при reconnect по SFU JWT или reconcile после logout. Сохранять пользовательский bearer и выдавать его за target user запрещено. Доверять session ID или membership, которые прислал browser, также нельзя.

ADR-089 требует отзыва initial и refreshed SFU token, ограничения другого tab/device и подтверждённого teardown до успешного terminal результата. Текущие CallStatus ACTIVE/ENDED и синхронный lobby End не моделируют отказ SFU. Этот PR задаёт prerequisite contracts; он не меняет эти production paths.

## Решение

Identity владеет user/device/session source of truth, Chat — текущим membership/role, RTC — call/participant/media generation и revoke state. Выделить proto-first **internal-only** методы проверки:

| Проверка | Вход после server authentication | Авторитетный результат |
| --- | --- | --- |
| Resolve текущего bearer при подготовке grant | bearer в существующем request context; он не сохраняется | user ID, session ID, device ID, session/device active |
| Identity session lookup при admission/reconcile | ожидаемые user/session/device IDs из registry RTC | та же связка активна либо revoked/not found |
| Chat subject eligibility | group ID + user ID из registry RTC | текущий owner/admin/member либо reader/removed/not found |

Внутренние проверки не выдают bearer и не создают target-user session. Caller identity выдаёт deployment authority; browser не может выбирать service identity. Нужны отдельный private listener/network policy и проверяемая service authentication (mTLS service identities с отдельными сертификатами Identity/Chat/RTC/admission). Обычный публичный gateway, browser bearer, SFU JWT и произвольный заголовок caller не открывают эти methods. Ключи/certificates и rotation принадлежат runtime owner. Пока этот transport contract не принят и negative tests публичного доступа не проходят, новые методы, media grants и feature flag не включаются.

Proto service/method names ниже задают будущие отдельные internal services, которые не регистрируются в public gateway. Проверки certificate chain/expiry/client-auth usage и точного service principal дополняются **method allowlist**; наличие любого сертификата этой CA не даёт все права.

| Future method | Единственный разрешённый caller principal | Результат/ограничение |
| --- | --- | --- |
| IdentityInternalAuthorization.ResolveSessionBearer | rtc-control | Bearer только в protected request header; user/session/device IDs + active state + authorization revision, без profile/key/token в result |
| IdentityInternalAuthorization.CheckBoundSession | rtc-control | Lookup exact registry user/session/device binding; active/revoked/not-found + revision |
| ChatInternalAuthorization.CheckGroupSubject | rtc-control | Exact group/user binding; current eligible role/state + membership revision |
| RtcMediaAdmission.ValidateAndRegisterConnection | media-admission | Проверенный SDK token key → atomic grant/connection lease + fresh Identity/Chat checks; subject IDs не выбирает proxy |
| RtcMediaAdmission.CloseConnection | media-admission | Только owner connection ID и matching grant key; stale close не снимает replacement lease |
| RtcMediaRevocation.ApplyIdentityEvent | identity | Только Identity outbox domain, собственная session/device revision и subject binding |
| RtcMediaRevocation.ApplyChatEvent | chat | Только Chat outbox domain, membership revision и group/user binding |
| RtcMediaRevocation.GetIdentityEventReceipt | identity | Только свой canonical event ID; generic subject/operation lookup отсутствует |
| RtcMediaRevocation.GetChatEventReceipt | chat | Только свой canonical event ID; current receipt без browser capability |
| RtcMediaAdmission.RegisterInstance (later) | media-admission | Verified unique leaf fingerprint; server выдаёт instance UUID/global persisted fence |
| RtcMediaAdmission.AcknowledgeProxyCleanup (later) | media-admission | Matching operation/full key/lease/owner fence и реальное closure proof; не WS close boolean |

Admission proxy не получает broad subject lookup в Identity/Chat; все authority checks выполняет RTC. Identity/Chat caller не может mint/activate grant, а admission caller не может выдавать authoritative revoke event от их имени. Private SFU management API доступен только RTC с отдельной server credential; browser/admin grant его не получает. Internal service principal не подменяет пользовательскую авторизацию публичных RPC или operation status. Implementation negative fixtures должны отвергать absent/wrong certificate, сертификат допустимой CA с wrong principal, public route/browser credential, cross-domain event и spoofed caller header.

Оба lookup выполняются свежими на каждом upgrade, включая reconnect/validate routes; permission cache не разрешает доступ. Ошибка/timeout authority означает deny/degraded, но не false permanent eviction. Definitive revoke/removal вызывает RTC revoke/teardown. Между отдельными Identity/Chat lookup и фактическим upgrade остаётся race: future integration обязана сериализовать RTC grant state с admission registration, закрывать уже зарегистрированные connections по событию revoke и иметь 5s reconcile как recovery. Это не распределённая atomic transaction и не обещание мгновенной глобальной revocation при недоступной authority.

## Registry и состояния

Stable key — непрозрачная server-generated participant identity + server room + media generation. Registry дополнительно связывает grant ID, call ID, participant ID, user/session/device IDs; raw bearer, initial/refreshed JWT и token hash не хранятся как единственный ключ авторизации. SFU JWT подписывает стандартный SDK; admission проверяет signature, ожидаемый issuer, expiry/not-before и permissions этим SDK, затем authoritative binding. Generation определяется immutable registry mapping room/identity, а не произвольным custom claim browser; mapping не переиспользуется для новой generation. Refreshed JWT с той же identity не создаёт новый grant и не снимает revoke.

Одновременно разрешена одна active media generation на user во всех calls/tabs/devices. Registry reserve и atomic Join сериализуются в RTC transaction; конфликт другого device/session видим пользователю. Initial token TTL и publish budget фиксируются в implementation PR вместе с pinned SDK; срок JWT не заменяет authoritative lifetime grant. Token допускает только microphone audio, без data/video/screen/metadata/admin/recording. Один audio track и quota требует SFU-side enforcement с negative fixture.

Admission registration дополнительно сериализует один signaling connection lease на generation: новый upgrade не вытесняет ещё живой connection молча. SDK reconnect/handoff и освобождение старого connection проверяются actual pinned SDK fixture, затем допустим следующий connection той же generation. SFU JWT остаётся bearer capability: lookup сессии доказывает её активность и принадлежность выданного grant, но сам по себе не доказывает физическое устройство предъявителя украденного token. Device conflict проверяется при reservation нового grant; никакой самодельной proof-of-possession crypto в этом slice нет.

| Состояние | Admission | Дальнейшее действие |
| --- | --- | --- |
| prepared | закрыт | проверенная reservation, ещё нет mint/connection |
| active | только свежая authority + точное binding | heartbeat/reconcile; один generation |
| revoking | закрыт для initial/refreshed tokens | закрыть proxy connections + SFU disconnect/delete, bounded retry |
| revoked | закрыт | teardown подтверждён, terminal result и освобождение slot |

Begin revoke необратимо закрывает admission **до** SFU cleanup. Failed cleanup оставляет `revoking`, видимое pending/error и удерживает slot; он не переводит call в successful ENDED. Повторный запрос с тем же operation ID идемпотентен; устаревший acknowledgement другой generation не освобождает текущую. При crash durable registry/outbox восстанавливает cleanup до нового grant. Persistence, transactional outbox, RPC additive media state и изменения End/Leave реализуются отдельным PR после review; reference model не является их реализацией.

## Durable revoke и operation result

### Durable store: generation, watermark и fence

Разделить `room_generation` общей комнаты call и `grant_generation` конкретного user. Room mapping создаётся сервером и не переиспользуется для replacement room; leave/rejoin одного участника не переносит остальных в другую комнату. Grant generation монотонно выделяется на user, новый grant получает новую opaque participant identity. Stable grant key — `(room_name, participant_identity, grant_generation)`; operation/ACK дополнительно проверяет immutable room ID/room generation/call/participant/grant binding и tuple session/device revisions + Chat eligibility epoch. Generation не берётся из custom browser claim.

Persistent registry удерживает один prepared/active/revoking grant на user и один open/closing signaling lease на grant. Source inbox и deny watermarks записываются вместе с применением event под shared user mutex, даже если matching grant ещё нет. Reserve проверяет watermark под тем же mutex: event-before-reserve не теряется, а более свежий eligible epoch не отзывается старым denied event. Lock order — sorted call/room parents → user mutex → grant/lease → operation/outbox. Event сначала определяет parent set и после locks повторно читает matching grants; при появлении нового parent transaction откатывается и повторяется с расширенным sorted set, без child→parent inversion. Это local RTC atomicity, не distributed source transaction.

Admission owner/fence поступает только из trusted transport adapter. Browser/body/header не выбирает owner. Будущий deployment registration связывает unique verified admission leaf-certificate fingerprint с server-issued instance UUID и monotonic fence; generic service URI сам по себе не различает instances. Store может сохранить opaque owner/fence, но это не trusted registration/ACK proof до actual mTLS fixture. Certificate rotation и old owner cleanup требуют явного registration/recovery contract; не вводить самодельный bearer proof-of-possession.

Одна transient authority failure сохраняет active grant state, запрещает свежий admission и возвращает degraded/unavailable. Она не повышает deny watermark и не объявляет source revoked; дополнительный скрытый state не вводится. После отдельно описанного recovery exhaustion cleanup собственного grant может начаться с authority outcome UNAVAILABLE, не REVOKED; source право не отзывается навсегда. Только matching proxy/SFU cleanup acknowledgement завершает media operation и освобождает held slot.

Prepared reservation истекает через **20 секунд**. Освободить её как никогда не активированную можно только при persisted отсутствии activation intent и connection lease; это не SFU teardown ACK. Active grant не получает произвольный hard lifetime. JWT expiry/refresh10min и WS close не освобождают slot или publication budget: требуется подтверждение cleanup matching generation. Числа worker claim/retry/heartbeat tuning задаются отдельным wiring PR до flag; pending targets/outbox никогда не удаляются retention cleanup.

Dormant store source preparation — отдельный slice после reviewed foundations.
SQL schema является registered additive migration: embedded `rtcschema.Files`
автоматически применяется обычным `dbbootstrap.Apply` при startup/upgrade.
Условного migrator нет; лишь `MediaStore` пока не вызывается handlers. Он не публикует public/private RTC API, не mint JWT, не подключает SDK/proxy/SFU/worker/UI и не включает media flag. Boolean reference-model ACK не используется как production подтверждение; publication store требует свежих prerequisite и собственных source-bound native gates.

Identity/Chat записывают authority revoke и trusted outbox event в одной **своей** database transaction. Источник события не откатывает revoke и не включает доступ обратно при ошибке RTC/SFU. Event содержит opaque event ID, authority domain, server subject IDs, scope, монотонную authorization revision и reason; bearer/JWT/key/audio в нём отсутствуют. Deliver/retry с bounded backoff принадлежит outbox owner. Session/device revoke постоянен для этой связки; Chat event применяется к grant, выданному на соответствующей или более ранней membership revision. Поздний event не отзывает новый grant другой generation/revision. Конкретные revision columns и proto enums требуют отдельного migration/contract PR.

RTC владеет durable media operation: operation ID, origin event/request ID, caller user ID, affected grant keys, reason, authority outcome, media outcome, retry/deadline metadata, sanitized error code. Transaction RTC идемпотентно применяет trusted event, закрывает admission для matching grants и записывает собственный cleanup outbox. SDK RemoveParticipant/DeleteRoom и закрытие proxy connection могут повторяться; acknowledgement проверяет **полный stable key** и текущую operation, а не только user/call ID. Только подтверждение всех required actions меняет media outcome на complete и освобождает media/call slot. Crash между двумя authority transactions восстанавливается исходным outbox; crash между RPC cleanup и ack — идемпотентной повторной сверкой. Ошибка downstream остаётся pending, source authority revoke сохраняется.

| Additive result | Семантика |
| --- | --- |
| `authority_revoked + media_teardown_pending` | Доступ уже прекращён, admission закрыт; отключение SFU/proxy ещё не подтверждено. Видимая причина, operation ID и bounded retry; нельзя показать «звонок завершён». |
| `authority_revoked + media_teardown_complete` | Matching-generation trusted cleanup подтверждён; допустим terminal call result. |
| `authority_unavailable + media_teardown_pending` | Свежий lookup недоступен, новый admission закрыт; результат не объявляет permanent authority revoke. |

Request budget revoke/teardown — **5 секунд** с общим deadline на authority checks, RTC operation и первый cleanup attempt. Deadline не откатывает committed revoke: additive response возвращает pending/status либо sanitized error с operation ID, если authority caller всё ещё может видеть операцию. Retry выполняет durable worker; 5s reconcile остаётся recovery, он не является первым механизмом отзыва. Пока caller не получил durable operation receipt, UI показывает ошибку/неопределённость, а не completed media. Future transport contract обязан сохранить уже committed operation при потере response и найти её по authenticated idempotency key.

Own Logout останавливает local tracks немедленно независимо от сети; session revoke не ждёт восстановления SFU. Это завершение auth action не означает `media_teardown_complete`. После отзыва собственный bearer больше не открывает status API. Пока UI жив, он может показать полученный pending/error; повторная авторизация того же user либо явно разрешённый admin позволяет сверить operation status. Anonymous subject/status lookup не вводится. Caller other-session revoke или group remove сохраняет свою active session и может читать scoped operation status; принадлежность operation сама по себе не заменяет текущую проверку права. Group admin после потери собственного доступа не получает polling capability.

Будущие proto-first операции отделяют request/status teardown от legacy lobby result и содержат operation ID + эти два outcome. Existing End/Leave с active media grants не возвращают успешный terminal lobby response до cleanup; старый client получает pending/error с fail-closed compatibility behavior. Call/participant terminal state и unique-user slot не освобождаются обходным legacy RPC. Пока обязательные negative tests этого поведения, durable crash replay, caller status authorization и trusted acknowledgements не проходят, media flag выключен. Private source lookups реализованы отдельными slices; registered durable store
source подготовлен, а его handler integration, эти additive APIs и workers
ещё не реализованы.

### Private source receipt и последующая registration boundary

Уточнение принято координатором 2026-10-12 до receiver implementation.

Private source receiver вводит отдельный proto `rtc.revocation.v1`, вне public
mux/gateway. Fixed per-method certificate ACL: `ApplyIdentityEvent` и
`GetIdentityEventReceipt` доступны только verified single URI
`urn:aerochat:service:identity`; `ApplyChatEvent` и `GetChatEventReceipt` — только
`urn:aerochat:service:chat`. Dedicated client CA, chain/expiry/clientAuth/TLS1.3
и method allowlist обязательны вместе. Caller/domain берётся из TLS+method,
не header/body; generic subject/operation lookup не вводится.

Event DTO содержит только canonical semantic tuple, который RTC inbox сохраняет
и сравнивает: event ID, kind, exact subject/user/device IDs и положительная
revision. Identity SESSION/DEVICE сохраняет exact binding; Chat
eligibility_denied/member_removed канонически превращается в group denied pair
и resulting eligibility epoch. Original reason/occurred_at остаются source
outbox audit fields, не доставляются как ignored DTO и не объявляются RTC
verified. received_at выдаёт RTC; timestamps не определяют authority/expiry.
Changed canonical payload duplicate конфликтует; same tuple возвращает тот же
operation. Source producer получает tuple только из committed own outbox row,
не из incoming browser authorization booleans.

DURABLY_APPLIED подтверждает RTC commit inbox/watermark/operation и durable
cleanup, не SFU teardown. NO_MATCHING_REGISTRY_GRANTS — factual matching set
под registry mutex, без обещания отсутствия RTP/SFU orphan. Affected count
считает distinct full grant keys exact event scope, не action/lease rows и не
чужие targets shared operation. Nonempty target остаётся MEDIA_PENDING до
matching required proxy/SFU acknowledgement; пустое journal completion никогда
не отображается как media/SFU completion. Source callback/status actor может
читать только own-domain event receipt; public user status — поздний отдельный
fresh-authorized RPC, без anonymous/revoked-bearer polling.

Более поздняя trusted admission registration выдаёт server-global persisted
monotonic fence и instance UUID от RTC, связывает их с verified unique leaf
fingerprint. Caller-selected owner/identity/fence запрещены; overflow failclosed.
Admission-only AcknowledgeProxyCleanup — отдельный future method, не overload
обычного WS CloseConnection. Он подтверждает exact stored operation/fullkey/
lease/owner fence и фактическое закрытие соответствующих connections; boolean
body не receipt. SFU ACK поступает только от future RTC-owned pinned SDK adapter
после matching-generation absence verification. Source senders, registration,
SDK/proxy cleanup, public status/UI и feature enable — отдельные narrow slices.

До media flag обязательный compatibility slice закрывает все legacy
Start/Join/Leave/End/liveness paths: heldmedia prepared/active/revoking блокирует
новый direct/group call и не освобождается legacy participant exit до trusted
ACK. Flagoff legacy unchanged. Cleanup claim busy/notyet/fence exhaustion —
transient/pending или unavailable, не authorityrevoked/deny watermark.

### Identity source delivery journal

Identity sender — отдельный default-disabled implementation slice. Migration
добавляет delivery journal на committed source event; backfill создаёт pending
rows только для существующего outbox. Новый revoke записывает outbox и journal
в той же source transaction. Immutable outbox и receipt mapping удерживаются:
pending/claimed/quarantined rows не удаляются. DTO формируется только из claimed
outbox row; browser/body не создаёт producer authority facts.

Single-inflight worker использует общий attempt deadline **5s** для
claim→receipt lookup/apply→CAS, claim lease **15s**, recovery wake **1s** и bounded
backoff **1–30s**. Это начальные constants без capacity benchmark, не media
lifetime. Fence/attempt монотонны; CAS требует event, current owner/fence,
pending state и nonexpired DB-clock lease. Network вызов не удерживает TX lock.
Потеря ответа/crash до CAS восстанавливаются own receipt lookup и canonical
replay; RTC DURABLY_APPLIED завершает только delivery journal, не media teardown.

Permanent canonical conflict либо malformed claimed row переводится guarded
CAS в **quarantined**, static reason canonical_conflict/source_row_invalid.
Immutable row/mapping/fence сохраняются, automatic retry исключён; payload
repair/requeue не выдумывается. Stale worker не может quarantined/delivered
новый claim. Operator recovery — отдельная авторизованная процедура.

Exhausted fence/attempt row остаётся неизменной и fail closed. Claim selection
исключает exhausted counters до выбора следующего eligible due event;
bounded operator diagnosis сообщает только static exhausted_counter, без
payload IDs. Такой event не блокирует прогресс других due rows. Counter/retry
math guarded: никакого shift от unbounded attempt и timestamp из source audit.
Source revoke/public auth outcome сохраняется; sender success не является
successful media completion. Chat sender/registration/SFU/proxy ACK/media flag
остаются отдельными slices.

## Chat eligibility epoch

Chat хранит монотонную revision для допуска exact `(group_id, user_id)` к audio, отдельно от физически удаляемой membership row. Retained tombstone сохраняет счётчик после remove/leave; rejoin не возвращает revision к начальному значению. Это **eligibility epoch**, а не версия любой смены роли или timestamp. Источник текущей role остаётся Chat membership. Private lookup всегда возвращает свежую role; RTC не кеширует management privileges по одному eligibility epoch.

| Переход | Epoch | Source revoke event |
| --- | --- | --- |
| Первый membership, включая reader | 1 | Нет; reader admission запрещён |
| Owner/admin/member между собой, включая ownership transfer | Без изменения | Нет; текущий audio admission сохраняется |
| Owner/admin/member → reader | +1 | Да, resulting denied revision |
| Reader → owner/admin/member | +1 | Нет |
| Physical remove/leave | +1, retained removed tombstone | Да, resulting denied revision |
| Removed → rejoin с любой допустимой ролью | +1 | Нет; reader остаётся не eligible |
| Повтор того же state либо неуспешная операция | Без изменения | Нет |
| Message-only write restriction/unrestriction | Без изменения | Нет; отдельный audio ban потребует contract decision |

Source transition, epoch и ID-only outbox event записываются атомарно. Event применяется только к matching pair и grant на соответствующей либо более ранней revision. После denied epoch2 новый eligible grant epoch3 не отзывается задержанным event2. Переход eligible→eligible не создаёт event с текущей eligible revision: такой event неоднозначно отзывал бы уже новый допустимый grant. Unknown/missing/mismatching authority state и exhausted revision fail closed; overflow откатывает всю source transaction.

Narrow schema invariant может использовать membership trigger, чтобы событие пережило physical group/user cascade и future SQL writer не пропустил source transition. Это не переносит domain permissions в trigger и не доказывает lock order: FK cascade может взять child lock до AFTER trigger. Перед подключением нужны bounded native concurrent cascade/transfer/remove cases с наблюдаемыми locks; новый membership writer не должен инвертировать existing quota-user → group и group → thread ordering. Delivery/ack/retention worker и media enforcement остаются отдельными implementation slices.

## Проверки и границы slice

Private Chat source preparation slice реализует `chat.authorization.v1.InternalAuthorizationService.CheckGroupSubject` на отдельном default-disabled mTLS listener с тем же fixed RTC caller. Snapshot читается без profile/token/MLS данных; роль свежая, eligibility epoch persistent, missing/inconsistent state не объявляется permanent removal. [Chat README](../../services/aero-chat/README.md) описывает config и обязательные TLS/PG gates. Source review разрешает обратимую local подготовку API до долгоживущей shared test lease; publication требует свежих state/API native receipts, а production media flag остаётся off.

Private Identity implementation slice регистрирует отдельный `identity.authorization.v1.InternalAuthorizationService` на optional mTLS HTTPS listener с fixed rtc-control URI principal. Fresh session/device tuple lookup и exact binding проверяются отдельно от source outbox; [Identity README](../../services/aero-identity/README.md) содержит config и границы actual TLS/PG fixture. Public gateway/new grants/dispatch/SFU/browser audio этот slice не подключает. Literal `internal` segment в proto/gen Go path не используется из-за Go import rules; private доступ обеспечивает transport/caller enforcement.

Первый state implementation slice добавляет Identity persisted session/device revisions и source outbox в existing revoke transaction; [Identity README](../../services/aero-identity/README.md) описывает migration, tuple, retry и native storage checks. Доставка/ack/outbox retention, private authorization RPC и все media adapters в этот slice не входят. Implementation наличие кода и passed native source checks не заменяет future actual admission/SFU proof.

Pure reference model проверяет exact binding, revoked session/device, reader/removed, authority failure, initial/refreshed identity после revoke, old-generation acknowledgement и pending failed teardown. Это model evidence, а не proof JWT, mTLS, proxy, SFU track limits или сети. В исходном contract/model slice202 production RTC lobby, contracts/generated
code, Identity/Chat handlers, dependencies, runtime и UI не менялись. Следующие
state/private API slices описаны выше; group audio остаётся отсутствующим.

Дальше нужны узкие PR: internal authorization proto/handlers + closed listener tests; pinned SFU/proxy runtime с SDK endpoint matrix; durable grant/admission/teardown integration; lazy browser lifecycle; synthetic и отдельная real-device/NAT/TURN приёмка. Источник privacy остаётся ADR-089: transport audio доступно trusted SFU, E2EE не заявляется.

## Последствия и альтернативы

Добавляется явная service-auth boundary и отказоустойчивая media state machine. Это дороже хранения bearer, но оставляет authorization source of truth у соответствующего домена и позволяет отзыв при reconnect/reconcile. Проверка только user ID через публичный GetCurrentProfile не связывает первоначальную session. Проверка только JWT expiry допускает replay после remove и не удовлетворяет ADR-089. Общий service bearer без caller identity/rotation не выбран.

## Первичные источники

- [Go 1.25 crypto/tls Config](https://pkg.go.dev/crypto/tls@go1.25.0#Config): verified client chain и дополнительная caller identity policy нужны вместе; service certificate не открывает все внутренние методы автоматически.
- [LiveKit access tokens и refresh/revocation](https://docs.livekit.io/frontends/reference/tokens-grants/): refreshed token может жить 10 минут, self-host removal не отзывает старый JWT; room/identity должны быть непрозрачными.
- [PostgreSQL 17 trigger behavior](https://www.postgresql.org/docs/17/trigger-definition.html): trigger работает в source transaction; FK cascade вызывает triggers referencing table. [Explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html): одинаковый порядок locks нужен независимо от trigger atomicity; native concurrency proof остаётся обязательным.
