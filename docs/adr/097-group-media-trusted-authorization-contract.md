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

### Guard foundation для legacy mic-slot

Следующий отдельный slice ограничен transactional guard. Он не инициирует
cleanup и не реализует готовый media End/Leave. Policy передаётся явно через
constructor; default off. Env activation, media flag, public operation/status
API, SDK/proxy/cleanup workers сюда не входят. Пока production policy выключена,
обычный lobby/direct lifecycle и stale eviction ADR086 сохраняются.

При opt-in policy один user mutex сериализует legacy active participation и
held media grant во всех calls/tabs/devices. Prepared/active/revoking удерживают
slot даже при уже left legacy participant или ended call. Legacy Start/Join
другого call отклоняются до mutation; group Reserve не обходит active legacy
participation другого call. Same-call Join не захватывает grant иной auth
session/device. Same-request Reserve replay сохраняет exact authority/call
binding; revoked/revoking generation не активируется повторно.

Обязательные guarded writers: CreateCallWithParticipant и JoinParticipant,
включая ended-orphan repair; LeaveParticipantAndMaybeEndCall и
EndCallWithParticipants; все callers stale conflict resolution/pruning,
public Leave/End и direct repository exit ineligible SendSignal target.
Наличие held grant не позволяет этим exits записать successful left/ended
или освободить unique user slot. Guard возвращает typed pending; public RPC
отображает его как sanitized FailedPrecondition, без fabricated terminal
response или media-complete receipt. Signal target с definitive eligibility
deny не получает сигнал даже при pending cleanup. Это не permanent source
revocation и не основание повышать deny watermark.

Lock protocol: до TX определить target и old legacy/held call/room parents,
включая active participant ended-call; затем sorted call parents → sorted
room parents → sorted user mutexes → grant/lease → operation/outbox. Для
End после target call lock повторно проверить participant/user set. Под user
mutex заново проверить parent set и full binding. Новый parent/user, которого
нет в locked set, означает rollback и bounded retry всей transaction;
добавлять parent lock после user mutex запрещено. Исчерпание retry/DB failure
возвращает unavailable, не authority revoked. Сетевых authority checks под
DB locks нет; uniqueness constraints дополняют, а не заменяют protocol.

Guard-only refusal не создаёт cleanup operation и не обещает, что Leave/End
принят к исполнению. Он лишь сохраняет slot и прежнее состояние. Existing
matching operation/ACK продолжает жить по своему immutable binding. WS close
закрывает только exact lease; mute, JWT/certificate expiry и heartbeat stale
не являются authoritative SFU ACK и не освобождают publication budget/slot.
Never-activated expiry допускается только после20s при persisted отсутствии
activation intent и любого lease; это отдельный storage fact, не media teardown.

Durable call-wide End/Leave intent, запрет новых Join и per-grant child
operations требуют отдельного accepted contract и узкого coordinator PR.
Текущий one-grant ACK finalizer нельзя скрыто расширять в multi-target End.
Только future trusted matching proxy/SFU ACK завершает media; guards и
NoMatching/empty journal completion этого не доказывают. До coordinator,
trusted admission/cleanup adapters и общей compatibility приёмки production
media policy/flag не включаются. Source preparation в отдельном worktree
допустима после review; generation/full gates/publication требуют обычного
merge generated, verified и published Identity→Chat→registration parents,
нового clean freeze и собственных fresh receipts.

### Public group Leave / End: parent control intent

Уточнение Accepted координатором 2026-10-12 для отдельного coordinator
slice; implementation ещё не начата. Docs commit предшествует коду.

Public media Leave/End вводятся как additive proto-first commands
RequestGroupMediaLeave/RequestGroupMediaEnd с call_id и canonical request_id,
а GetGroupMediaOperation читает authorized status. Контракт выделен в отдельный
unmounted GroupMediaControlService: existing RtcControlService не расширяет
gateway interface. Typed stubs возвращают Unimplemented до отдельного adapter
slice; body/model tuple не становится public capability. Старые LeaveCall/EndCall не
получают successful left/ended response с pending внутри. Request ID служит
лишь idempotency correlation; body не выбирает user/session/device, grant,
room/generation, owner/fence, child actions, authority outcome или ACK.

Own Leave допускается только для held grant exact resolved active auth
user/session/device binding, включая reader/removed Chat subject: прекращение
собственного media не даёт нового admission. End actor — immutable call
creator с active Identity и свежей eligible Chat role owner/admin/member.
Текущий GroupOwner/admin не получает End privilege автоматически; смена
eligible роли сохраняет epoch, поэтому management privilege не кешируется
по epoch. Own minimal Leave status доступен новой active session того же user
без roster/чужих bindings. End aggregate status требует свежего current End
права. Revoked bearer/anonymous status запрещён; own logout оставляет pending
до следующей authorized session либо отдельного approved admin reconcile.

Уточнение Accepted координатором 2026-10-12 до adapter implementation:
own minimal status использует отдельный typed identity-only OwnStatusSubject /
read, полученный после fresh active ResolveSessionBearer. Его разрешение —
exact persisted actor user, не current Chat role или roster. Новая active
session того же user может читать только original minimal own receipt.
Chat NOT_FOUND/unavailable не превращается в выдуманный RoleRemoved/Reader
для прохождения model Actor validator. End aggregate status сохраняет fresh
active Identity +immutable call creator +current eligible Chat role; own
identity-only read не открывает этот путь. Revoked/anonymous bearer запрещён.

Saved same-user Leave request replay из НОВОЙ active session может вернуть
original scoped minimal receipt без новых targets или mutation. Это recovery
прежнего command, не Leave текущей replacement generation. Новый Leave всё ещё
требует exact current resolved session/device held binding. Request/kind/call
изменение конфликтует, operation/request ID не является capability. Adapter
берёт auth subject из verified remote result, не body/header boolean.
Public mapping остаётся media_PENDING при UNKNOWN provider proof, даже если
model leave journal complete; model ACK/status не пересекает trusted media
completion boundary. Admission signature/proxy/ACK — отдельный SDK contract
и slice, service/runtime/media flag этим уточнением не включаются.

Coordinator сохраняет immutable parent intent/request mapping, exact per-grant
child operations и отдельные room-generation cleanup targets с guarded claims.
Leave выбирает один own exact grant; replay прежнего request не выбирает
replacement generation. End под call lock выбирает все prepared/active/revoking
grants и active legacy participant IDs этого call, все non-closed rooms этого
call и проверяет referenced rooms. Snapshot включает full grant/room/call/
participant/auth revision/eligibility epoch binding, stored lease и expected
server registration owner/fence. Browser и новый leaf не выбирают targets.
Already-revoking source child сохраняет свою operation/reason/authority outcome;
его immutable binding не переприсваивается. Один child остаётся one-grant
operation, а не скрытая multi-target замена существующего ACK finalizer.

OPEN END INTENT — durable admission И terminal barrier. Он блокирует legacy
End, last-Leave, stale prune/conflict/orphan repair от successful call ENDED /
room CLOSED даже после ВСЕХ grant REVOKED при0held/0participants, пока room ACK
pending. Start той же group не создаёт replacement call; Join/Reserve/Activate/
RegisterLease и future initial/reconnect admission закрыты. Барьер нельзя
считать исчезнувшим по отсутствию held grant, activity или истечению JWT.
Child может release свой participant/user slot лишь после полного собственного
matching ACK; parent End и selected rooms остаются pending/closing. Только
parent finalizer может завершить call/room при открытом End intent.

Parent completion требует ALL exact child actions и ALL selected room-generation
trusted teardown/absence ACK. Final transaction повторно проверяет immutable
targets, child proof/state, room proof и отсутствие неожиданных participants /
held grants/leases; затем атомарно terminal call/rooms и parent receipt.
Empty/UNKNOWN registry set не становится media complete, synthetic room ACK не
создаётся. Provider facts остаются UNKNOWN/PENDING без trusted adapter. WS close,
local tracks stop/mute/Leave action, provider HTTP200 и token/certificate expiry
не являются ACK. New leaf/same service URI не наследует predecessor targets;
rotation/takeover остаются unsupported, pending old targets neverdelete.

Fresh Identity/Chat lookup выполняется вне DB TX в общем5s budget. Внутри —
sorted call parents → rooms → users → grants/leases → intent/children/outbox,
recheck full binding/watermarks/target set; новый parent/user требует rollback
и bounded retry, не поздний parent lock. Pending group intent входит в parent
discovery даже при отсутствии participants/grants. Нет distributed atomicity
между authority lookup и RTC commit: source events и5s recovery закрывают race,
transient failure не объявляет permanent revoked и не повышает watermark.

Same authenticated actor/request/kind/call возвращает тот же durable receipt
после response loss/crash, changed duplicate конфликтует. Command/status
каждый раз заново авторизуется; operation ID не capability. Pending intents,
full targets и mappings удерживаются. Worker lease/claim owner/fence и DB clock
защищают stale CAS; busy/not-due остаётся pending, exhaustion unavailable.
Реальные sender/admission/SDK/proxy cleanup workers, public wiring/UI и media
enable — отдельные slices. Dormant coordinator preparation требует review;
generation/full gates/publication — ordinary merge generated, verified и
published parents, новый clean freeze и собственные receipts. До actual
trusted ACK acceptance public media complete не заявляется.

### Авторизация публичного media control и свежесть запроса

Уточнение Accepted координатором 2026-10-12 после review source и Go 1.25
для отдельного unmounted adapter slice. Этот docs commit предшествует коду.

Existing RTC не имеет AuthContext/JWT middleware: public handler читает bearer
из request Header, legacy GetCurrentProfile возвращает лишь user ID. Existing
opaque sessionv1 остаётся прежним; adapter принимает ровно один nonempty Bearer
через EqualFold scan ВСЕХ Header map keys/values (без Get/Values-only selector),
отвергает duplicate/casing aliases/comma/control и вызывает ResolveSessionBearer. Body
содержит только existing call/request/operation IDs, не Actor/auth/group facts.
Full active user/session/device tuple и revisions проверяются actual private
Identity; source DTO не содержит exp/crypto-device trust/source expiry timestamp.
SFU JWT/token policy и Go27/pinned SDK остаются отдельным следующим контрактом.

Typed identity-only OwnStatusSubject/read и saved same-user LEAVE replay из
новой active session используют только текущую Identity subject, без Chat calls,
без fabricated RoleRemoved/Reader и без old-target/replacement mutation. Final
CheckBoundSession проверяет текущую resolved session, не session из old receipt.
Новый LEAVE требует exact held tuple и genuine Chat PRESENT/reader или REMOVED
со своим validated group/user/epoch. NOT_FOUND/unavailable не превращаются в
REMOVED. END command/replay/status каждый раз требует immutable creator и
fresh PRESENT eligible role; GroupOwner/admin другого user это право не даёт.

Outer HTTP wrapper создаёт один child context min(incoming deadline,5s) в начале
ServeHTTP ДО Connect body decode. Actual ResponseController.SetReadDeadline(D),
SetWriteDeadline(D) и MaxBytesReader4KiB/bounded read ограничивают body/decode;
unsupported/error не допускает Connect/source/domain work. Raw header phase
уже прошла: отдельный server ReadHeaderTimeout<=5s/MaxHeaderBytes8192, без claim
охвата raw headers request D или exact8192wirecutoff с Go bufio slack. D общий
для source calls, DB wait/recheck/commit/final snapshot и response. Facts
request-local и истекают в D;
никакого source expiry/JWT поля или per-hop renewal не вводится. Последние
сетевые source checks выполняются до RTC TX/locks. Guarded writer получает
required local func(context.Context)error, сформированный AuthorizedService:
только ctx/deadline/time/immutable tuple validation, без network/DB callbacks.
Он проверяется до TX, после sorted binding recheck, до первой journal mutation
и перед ОБОИМИ commit paths (new intent/saved replay); nil/expired evidence
запрещает mutation/replay. Сетевые source callbacks под locks отсутствуют. Unguarded
model Request не становится public adapter entry. Это local freshness, не
atomic auth transaction между сервисами: source-event recovery закрывает race
после последнего lookup, а postcommit timeout/response loss остаётся uncertainty.

Constructor-only typed HTTPS clients принимают dedicated verified CA и sole RTC
leaf/clientAuth/expiry/TLS1.3/standard hostname checks; redirects/envproxy/plaintext/
caller override запрещены, exact2Identity/1Chat methods only. Секреты/body/IDs не
пишутся в logs/errors; static method/status/duration. Existing app/gateway не
mount отдельный service, oldthree typed stubs остаются Unimplemented; только
own native fixture создаёт explicit authorized factory. DTO/proto/schema и
production media flag не расширяются. Request5s inherited private caps и
bounded body/header policy подтверждаются actual owned3domain TLS/PG fixtures.
OWN read deadline очищается только full body EOF+live ctx до ServeHTTP return;
unread/error/expired body не продлевается, connection/stream не переиспользуется.
OWN write deadline сохраняется через net/http finish flush; buffered write
не доказывает delivery за5s. OWN server finite ReadTimeout/WriteTimeout<=5s
ограничивает cleanup unsupported writer/early auth reject. До error response
HTTP1 получает close-after-error; wrapper не вызывает blocking Body.Close или
unbounded drain, net/http finishRequest завершает original body под D/fallback.
HTTP2 завершает лишь own stream; Connect/source work не вызывается. Slow raw header/body/cancel/keepalive проверяются
отдельно. Gateway404 native phase только после остановки Id/Chat, max3native;
source-only gateway evidence явно static, не actual404.

До actual trusted provider proof public outcome ВСЕГДА PENDING с fixed reason,
даже если local/model journal complete/known или fixture RoomClaim ACK. Body/
header/constructor boolean не включает COMPLETE. SDK/proxy/admission token/
cleanup workers/UI/runtime и реальный group audio остаются отдельными slices.

#### Границы native-проверки адаптера

Уточнение Accepted координатором 2026-10-12 до добавления тестового хоста Chat.
Максимум три одновременных участника этой проверки: production Identity main,
Chat в отдельном test host и RTC test. Identity выдаёт настоящие opaque sessions;
Chat использует production PostgreSQL repository, domain service, публичные
group writers и private mTLS authorization listener. Роли, membership epoch и
auth facts не подменяются. Обычный запуск tests остаётся прежним; режим хоста
выбирает только явный private fixture profile, без пустых или skipped tests.

Test host допускает лишь Ping, CreateGroup, CreateGroupInviteLink,
JoinGroupByInviteLink, UpdateGroupMemberRole, TransferGroupOwnership и
RemoveGroupMember. Reader transition и remove вызывают очистку typing: для
отсутствующих в этой проверке typing entries используется отдельное пустое
in-memory test storage. Оно не участвует в авторизации; остальные typing методы
недоступны. Media, presence и notifications не используются и не открываются
через allowlist. Chat production/main/dependencies не меняются, Redis/S3 clients
и cleanup workers не запускаются. Fixture использует только собственную свежую
UUID schema, настоящие migrations, PG и TLS; source binding, лимиты и cleanup
проверяются отдельно до запуска.

Такой результат подтверждает production Chat domain/listener в тестовом хосте,
а не полный Chat main, Compose или readiness медиа. Полный production Chat с
owned Redis/S3 входит в отдельную сквозную браузерную приёмку. Счётчик вызовов
может делегировать реальному source и сохранять только числа для ZEROChat
assertions; bearer, subject IDs и source facts в артефакт счётчика не попадают.

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
Own receipt lookup по event ID не доказывает canonical tuple. Recovery после
successful lookup обязательно делает canonical Apply replay в том же общем5s
context: valid receipt должен сохранить event/operation ID. AlreadyExists
quarantined guarded CAS; transient/invalid/different operation остаются pending.
Новый proto digest или произвольное восстановление source payload не вводятся.

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

### Chat source delivery journal

Chat sender — отдельный default-disabled slice после source outbox024. Новая
migration создаёт pending journal для уже committed events и qualified SECURITY
INVOKER AFTER INSERT outbox trigger для journal в той же membership/source TX.
Исторический capture trigger024 не переписывается; новый trigger не берёт
group/user parent locks. FK RESTRICT только к immutable event, без cascade из
group/user/membership. Journal fault откатывает source transition/epoch/outbox.

Producer читает canonical tuple из claimed source row: event/group/user IDs,
source_revision→eligibility_epoch. eligibility_denied/member_removed оба
отображаются в fixed group-denied RPC. Source reason/time остаются audit и не
передаются; из отсутствующих role/removal/present/eligible fields receiver не
выводит authority. Sender не отменяет old denied event по current rejoin/role:
late epoch2/newgrant3 изолирует RTC registry.

Claim/canonical replay/CAS/quarantine и retention повторяют Identity contract:
общий5s claim→lookup/apply→CAS, lease15s, wake1s, capped1–30s backoff/singleinflight,
не benchmark. Lookup-success обязательно canonical Apply replay/same event+op;
AlreadyExists→guarded quarantine. Exhausted counters unchanged/excluded before
next eligible selection; static diagnosis и прогресс другого event. Pending/
claimed/quarantined/mapping neverdelete, no payload repair/false media complete.

Default-off typed client использует только ApplyChatEvent/GetChatEventReceipt,
sole verified URI urn:aerochat:service:chat, TLS1.3/CA/clientAuth/hostname checks,
без redirects/envproxy/caller override. Worker связан с app HTTP context и
awaited bounded shutdown; attachment cleanup/crypto/public Chat auth не меняются.
Source prep может начинаться от reviewed UNVERIFIED Identity checkout в отдельном
worktree, но full Chat gates/publication требуют ordinary merge verified
generated/published Identity parent, новый clean freeze и fresh whole receipts.
Никакого переноса parent PASS либо enable media/runtime из source prep.

### Регистрация экземпляра admission

Уточнение принято координатором 2026-10-12 до implementation этого отдельного
slice. Private `rtc.admission.v1.AdmissionRegistrationService.RegisterInstance`
принимает только canonical UUID `request_id` для идемпотентности. Verified
single URI `urn:aerochat:service:media-admission`, dedicated client CA,
chain/expiry/clientAuth/TLS1.3 и fixed method ACL обязательны. Fingerprint —
стандартный SHA256 DER фактически проверенного leaf certificate; он поступает
из trusted transport context. Body/header не выбирают fingerprint, instance
UUID или fence. Listener отдельный и default-disabled; source receiver не
расширяет Identity/Chat allowlist. Public mux/gateway этот метод не открывает.

RTC в одной PostgreSQL transaction выдаёт opaque instance UUID и положительный
server-global monotonic fence, сохраняя unique leaf fingerprint. Это sequence
регистраций, не election term: регистрация другого leaf не инвалидирует ранее
выданные instances. Overflow прекращает новую allocation без mutation; уже
сохранённый own retry остаётся доступен. Request ID scoped к verified leaf;
одинаковый request ID у другого leaf не даёт доступ к первой регистрации.

Same leaf + same request ID возвращает прежние instance/fence/state после
потери ответа или RTC restart, без повторной allocation. Same leaf + distinct
request ID конфликтует, включая draining/retired history. Retry retired state
не активирует его заново. Регистрация не освобождает grants/leases/publication
budgets и не подтверждает media cleanup; JWT/certificate expiry и WS close
не являются ACK. Новый leaf с тем же service URI не получает predecessor
ownership или права завершить old targets. Rotation/takeover/recovery old
owner — отдельный contract до media enable; pending old bindings сохраняются.

Deployment authority выдаёт unique leaf на instance. Копии одного certificate
и request ID не различают физические процессы: mTLS fingerprint не является
новым proof-of-possession протоколом. Native fixtures проверяют concurrent
identical replay/duplicate-leaf conflict, global fence/overflow, durable
response-loss/restart и retained inactive state, actual TLS/method isolation,
body/header overrides и default-off/coupled shutdown. Source-only preparation
может идти в отдельном worktree до parent gates; generation/full gates/PR
publication требуют ordinary merge verified generated/published Identity и
Chat sender parents, fresh clean freeze и собственные receipts. SDK/JWT/grant
issuance, connection admission, cleanup ACK и media flag сюда не входят.

### Readonly token candidate: PolicyV1

Уточнение Accepted координатором для отдельного docs-first readonly slice; implementation ещё не начата. Оно фиксирует узкий readonly profile; не принимает provider/admission/mint/lease/forwarding. Privacy-модель ADR-089 сохраняется: audio доступно trusted SFU, E2EE — отдельный этап.

#### Зависимости и граница результата

Первый узкий slice использует direct `github.com/livekit/protocol v1.52.2-0.20261007103317-a935cd67c29a` (schema commit `a935cd67c29a361744f7c965baaf8f904c0652fd`) и `github.com/golang-jwt/jwt/v5 v5.3.1`, Go 1.27.2. LiveKit server, server-sdk-go и browser SDK сюда не входят. Оба seed assets проверены стандартным Go/SumDB; auth/JWT public API и лицензии прочитаны. Однако exact selected MVS graph, package import closure и vulnerability/build/native gates остаются отдельными prerequisites: просмотр declared requirements или cache bytes не подтверждает closure. Общий candidate из ordinary source и auth adapter требует собственного clean freeze и fresh Go 1.27 gates. Проверка опубликованных refs и CI обязательна перед публикацией/release; локальный review её не заменяет.

Единственный успешный результат — ephemeral internal `ValidatedCandidate`: full immutable grant/room/call/participant + user/session/device/revision/eligibility tuple, verified registered admission instance/fence, checked-at и deadline. Он не является token, grant activation, reusable permit, lease, permission to forward, cleanup ACK или public response. Нет registry/slot/lease/watermark/outbox mutation, mint/refresh endpoint, новой schema/proto, service mount/main/env/feature flag. Raw JWT, decoded payload, bearer, secret и token hash не сохраняются и не логируются. Credential остаётся стандартным bearer: это не device proof-of-possession и не новая crypto scheme.

#### Точный профиль подписанного token

- Compact JWS: ровно3 непустых сегмента, ≤4096B; strict unpadded base64url, valid UTF-8 JSON object/EOF, decoded header≤512B/payload≤3072B, depth≤8. Header только canonical `alg=HS256`, `typ=JWT`; absent kid/jku/x5u/crit и любых дополнительных JOSE fields. Structural scanner отвергает duplicate keys во всех objects, неизвестные fields и noncanonical casing aliases; один `DisallowUnknownFields` не заменяет эти проверки. Нет JWE, trailing input или reencoding token перед signature.
- `iss` — непустой exact configured API key; constructor требует fixed issuer и nonempty owned byte secret (nil/empty []byte закрыт до token parse), secret выбирается только этим key, без caller kid/JWKS. `sub` — explicit canonical lowercase nonzero UUID, exact registry participant_identity; empty-sub/JTI fallback запрещён. Optional raw signed `identity`, если присутствует, совпадает с sub; проверить до protocol verifier overwrite. `video.room` — explicit canonical nonzero UUID exact immutable room_name. JWT не выбирает user/session/device/group/generation/owner/fence.
- `iat`, `nbf`, `exp` обязательны, non-null, canonical integer epoch seconds в диапазоне0..253402300799; нет float/exponent/string/bool/date truncation. `iat=nbf`, `exp-iat=600s` с overflow guard, `nbf≤now<exp` и `iat≤now`, leeway0. Эти поля и request deadline проверяются снова после источников/final snapshot. Absent nbf/iat, expiry в stock minute grace и future iat/nbf внутри этой минуты не проходят local policy.
- `video` обязателен: roomJoin=true; explicit non-null canPublish=true/canSubscribe=true; canPublishData=false/canUpdateOwnMetadata=false/canSubscribeMetrics=false/canManageAgentSession=false; canPublishSources exact single lowercase `microphone`, без duplicate/alias/UNKNOWN/другого source. Nil publish/data flags и пустой source list не принимаются как безопасные defaults. Это source grant, **не доказательство одного actual AUDIO track**.
- Kind — explicit `standard`; дополнительные known fields имеют только формы следующей таблицы. Это сужает неопределённое optional-empty wording и **не разрешает ни одной capability**. Все названия — exact canonical JSON tags (case aliases запрещены); repeated object key запрещён даже при одинаковом значении.

| JSON fields | Exact allowed shape |
|---|---|
| Header alg/typ; payload iss/sub/kind; video.room | Required non-null string с exact value/binding; empty/other type denied. |
| iat/nbf/exp | Required non-null canonical integer/range/date rules выше; string/float/exponent/bool denied. |
| video; video.roomJoin; canPublish/canSubscribe | Required non-null object; required boolean true; required pointer-backed booleans true. |
| video.canPublishData/canUpdateOwnMetadata/canSubscribeMetrics/canManageAgentSession | Все REQUIRED present boolean false, non-null; absent/nil/permissive defaults denied. |
| video.canPublishSources | Required array exactly ["microphone"], без null/alias/duplicate/other source. |
| identity | Absent либо non-null string exactlysub; empty/null/mismatch denied до verifier overwrite. |
| aud / jti | aud absent, [] либо ""; jti absent либо "". null/[""]/nonempty/other type denied, no fallback. |
| kindDetails / attributes | Absent либо exact [] / {}, соответственно. null/other type/nonempty denied. |
| name/metadata/roomPreset/sha256 | Absent либо exact "". null/other type/nonempty denied. |
| sip/agent/inference/observability/agentEndpoint/roomConfig | Absent либо JSON null (nil). ANY object даже{}, array/scalar denied. |
| video.roomCreate/roomList/roomRecord/roomAdmin/ingressAdmin/hidden/recorder/agent | Absent либо boolean false. null/true/other type denied. |
| video.destinationRoom | Absent либо exact "". null/other type/nonempty denied. |

Raw duplicate/canonical-key/unknown audit и non-null forbidden-object deny выполняются **до** typed/custom decode; RoomConfig.UnmarshalJSON delegates to protojson.DiscardUnknown=true, поэтому outer DisallowUnknownFields alone недостаточен. Любой unknown field/namespace/depth/type закрыт, никаких normalized aliases или silently dropped fields. Token/grants/registered claims и raw library errors не логируются; библиотечные errors отображаются в fixed internal codes, не возвращаются как user/downstream payload.

Stock default mint6h не используется этим профилем. TTL600s согласуется с reviewed stock refresh minimum10min при incoming lifetime600s; longer original lifetime, изменённые grants/key/kind либо иной actual refreshed shape должны отклоняться. Только source/API mint-format fixture не доказывает server refresh/reconnect. Actual pinned provider refresh/signaling integration остаётся отдельной проверкой. Clock skew приводит к deny/degraded; менять tolerance можно только явным дальнейшим ADR. JWT expiry/refresh/WS close/mute не освобождают slot/generation/publication budget/lease.

#### Стандартная verification и readonly freshness

1. Trusted token adapter после real VerifiedFingerprint задаёт один D=min(parent deadline,start+5s,actual verified peer leaf.NotAfter) **до** structural decode и existing WithVerifiedLeaf. Readonly facade требует live deadline и может только укоротить его до start+5s; все DB pool waits, signature, fresh calls и final view входят в него. После каждого шага и перед return — live ctx/time guard. Pure bounded HMAC нельзя прервать посередине; before/after guards не допускают late candidate. Никаких новых per-stage budgets/cache authority. Затем bounded canonical/duplicate/unknown/forbidden-object raw scanner выполняется ДО ЛЮБОГО `auth.ParseAPIToken` и любого protocol typed/custom decode; запрещённый RoomConfig object не доходит до custom unmarshal.
2. Только после успешного bounded raw scanner `auth.ParseAPIToken(original)` получает original JWS как unverified selector; APIKey должен совпасть с configured key. Затем `Verify(configuredSecret)` проверяет original JWS стандартной library. Его60s leeway, token-selected issuer и overwrite Identity не являются policy. После signature success typed raw payload с exported `jwt.RegisteredClaims` + `auth.ClaimGrants` декодируется и сравнивается с verified values; этот последующий decode не заменяет обязательный scanner до ParseAPIToken/custom decode. Нет собственного signer/hash/handshake; `ParseUnverified` не выдаёт authorization.
3. Дополнительно `jwt.NewValidator(WithIssuer(configured), WithSubject(registryIdentity), WithExpirationRequired(), WithNotBeforeRequired(), WithIssuedAt(), WithLeeway(0), WithTimeFunc(clock.Now)).Validate(claims)`. Этот API не проверяет signature; WithIssuedAt не требует presence — explicit nil guard и raw integer/date/TTL checks обязательны. Не выдавать WithStrictDecoding option для Parser за option injection в protocol.Verify/NewValidator.
4. TLS caller fact — existing `transport/admission.VerifiedFingerprint` из реального verified TLS1.3 chain/fixed media-admission URI, перенесённый trusted adapter через existing `domain/admission.WithVerifiedLeaf/VerifiedLeaf`. Missing/zero/unregistered/wrong/expired caller закрыт; body/header/constructor boolean не выбирают owner. Foundation facade unmounted; будущий mount отдельно обязан получить этот fact из реального TLS, а не произвольного context value.
5. Initial **один readonly SQL statement** связывает exact signed room+identity с full immutable grant/auth key и текущим registered leaf instance/fence/state; включает active grant/room/call/current participant, deny watermark и open End/closing barriers. Подготовленный/revoking/revoked/неизвестный grant не даёт candidate. Existing GetMediaGrant(id) недостаточен для room+identity/final view; допускается узкий named SQLC selector по existing schema, без FOR UPDATE/EnsureMutex/writes.
6. Последовательно свежие **Identity.CheckBoundSession → Chat.CheckGroupSubject → Identity.CheckBoundSession**, same D, existing private typed clients. Оба Identity возвращают exact ACTIVE registry user/session/device + positive exact revisions; JWT/opaque body не выбирают tuple, ResolveSessionBearer без browser bearer здесь не вызывается. Chat — exact group/user PRESENT current owner/admin/member с exact stored positive epoch. reader/removed/not-found закрыты; unknown/malformed/timeout/unavailable не превращаются в fabricated revoke/role/crypto-trust/expiry DTO.
7. Final **один readonly SQL statement** повторяет view той же room+identity+verified leaf и сверяет full key/authority tuple/active states/current fence/watermark/End barrier; повторная strict token time/D проверка перед return. Нет network under locks/transaction. Это текущий RTC statement snapshot и ограниченная свежесть источников, **не distributed atomicity**: source может измениться между чтениями. Candidate не сериализуется/кешируется и действует только внутри данного attempt D; будущий lease writer обязан заново сделать sorted locked recheck/registration/current source/required local guard и single-lease conflict до effects.

Definitive denial либо unavailable/cancel возвращают только internal error и не меняют persistent state; source receiver/будущий reconcile независимо доставляют committed revoke. Успешная candidate policy не решает oneMIC first-forward, actual kind/CID/SDP/RTP aliases, admission fence lifecycle, provider cleanup/absence ACK, privacy UI, browser SDK/audio/NAT/TURN/devices. Эти slices требуют отдельных Accepted contracts/actual gates; public control всегдаPENDING до trusted provider proof. Trusted SFU privacy/E2EE boundary ADR089 сохраняется.


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
