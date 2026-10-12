# RTC control и private source receiver

Public lobby/1:1 control остаётся прежним. Registered media migration000001
применяется embedded bootstrap при normal startup/upgrade. Group audio/SDK/proxy,
source senders, trusted registration/cleanup ACK и media flag пока отсутствуют.

## Private source events

SourceRevocationService на proto rtc.revocation.v1 регистрируется только на
отдельном optional mTLS listener, вне public gateway/mux. ApplyIdentityEvent и
GetIdentityEventReceipt принимают только verified single URI
urn:aerochat:service:identity; ApplyChatEvent/GetChatEventReceipt — только
urn:aerochat:service:chat. Dedicated CA + chain/expiry/clientAuth/TLS1.3 и fixed
method ACL обязательны. Caller/domain не выбираются header/body.

Identity DTO передаёт canonical committed event tuple (kind session/device,
event/subject/user/device IDs, positive revision); Chat — pair/resulting denied
eligibility epoch, оба original audit reason канонически group-denied. Source
audit reason/time не передаются; received_at server-owned. Caller producer должен
получать tuple из собственных committed outbox rows, не browser authorization
booleans. Source sender worker этим slice не реализован.

DURABLY_APPLIED означает RTC inbox/watermark/operation commit. Same canonical
event replay получает тот же operation; changed payload conflict. Own-domain
receipt lookup содержит лишь event ID, не generic subject/operation lookup.
Количество — distinct full grant keys exact source scope, не action/lease rows.
NO_MATCHING_REGISTRY_GRANTS factual empty registry set: не SFU/RTP absence proof.
Nonempty target всегда MEDIA_PENDING в этом receiver, даже если journal помечен
complete тестовой моделью. Реальный media completion требует позднего reviewed
trusted SDK/proxy adapter; публичный status/polling — отдельный slice.

Default off. Explicit runtime owner config:

- AERO_RTC_INTERNAL_REVOCATION_ENABLED=true
- AERO_RTC_INTERNAL_REVOCATION_LISTEN_ADDR=explicit-host:port
- AERO_RTC_INTERNAL_REVOCATION_TLS_CERT_FILE=path
- AERO_RTC_INTERNAL_REVOCATION_TLS_KEY_FILE=path
- AERO_RTC_INTERNAL_REVOCATION_CLIENT_CA_FILE=path

URI/method allowlist не расширяется env. Server leaf требует valid serverAuth
и DNS/IP SAN; client CA strict nonempty certificate-only PEM. Address port0
используют лишь own ephemeral native fixtures. Invalid TLS/startup fails closed;
private/public server смерть останавливает оба. Request budget максимум5s,
body/response4096, headers8192, read5s/write6s/idle30s. Logs fixed method/status/
duration/static TLS rejection без payload identifiers/URI query/credentials.

## Source checks

Pinned Go1.25.8/GOTOOLCHAIN=go1.25.8; future27 combined gate отдельный. Профиль
AERO_RTC_TEST_DATABASE_ENV_FILE указывает approved task-owned RTC env path;
значения DSN не выводить. Только new rtc_test_UUID в dedicated aerochat_rtc_test:
absence+atomic CREATE, exact search_path, cleanup только successfully-created own
schema. Private TLS listeners/certs ephemeral own localhost; runtime owner
delivery управляет retained Compose и shared ports, изменений стенда нет.

После source freeze — bounded whole unit/race/coverage/vet/lint/build, actual
native16 storage groups и TLS method-domain matrix, nonempty actual go-test JSON/
SKIP0; pinned Buf/SQLC twice/drift0. Source generation меняет files и сама не
является PASS receipt. Source prep/typed fixture не доказывает group sound,
physical devices/NAT/TURN: UNVERIFIED. До flag отдельный compatibility gate
закрывает все legacy Start/Join/Leave/End/liveness heldmedia bypass.

## Admission instance registration foundation

Registered additive migration000002 создаёт persisted global fence/instance
history автоматически при обычном startup/upgrade. RegisterInstance — один
proto-first method на отдельном optional TLS listener, defaultoff. Это лишь
service instance registration, не grant/token/lease admission и не media ACK.

Body содержит только canonical UUID request_id для correlation. Sole verified
URI urn:aerochat:service:media-admission, explicitclientAuth/chain/expiry/TLS1.3/
methodACL; fingerprint SHA256 фактического verified leaf DER приходит из
transport context. Headers/body не выбирают fingerprint/serverUUID/fence.
Source receiver Identity/Chat allowlist не расширяется, public gateway/mux
не открывают registration. Uniqueleaf provisioning — deployment contract;
cert+nonce copies не различают физические процессы.

Singleton row lock +ownleaf lookup +guardedincrement+instanceinsert в одной TX.
Sameleaf/samerequest replay =same UUID/globalpositivefence/currentstate после
loss/restart; distinctnonce того же leaf конфликтует даже retired. Same nonce
другого leaf создаёт только own registration. Newinstance не invalidatesothers:
globalfence — sequence, не election. Overflow mutationless, savedretry доступен
приMax. Binding/history immutable, inactive retry неreactivates; rotation/newleaf
predecessor takeover/ACK UNSUPPORTED, oldtargets/heldslots retained.

AERO_RTC_INTERNAL_ADMISSION_REGISTRATION_ENABLED=false default. Enable требует
LISTEN_ADDR, TLS_CERT_FILE, TLS_KEY_FILE, CLIENT_CA_FILE с тем же prefix.
Dedicated CA/operator-owned paths/privateports, TLSserverAuth+SAN иstrictPEM;
runtime owner включает отдельно. Budget5s/body4K/header8K/read5/write6/idle30,
staticlogs безIDs/nonce/fingerprint/keys/query/body. Public/source/registration
servers cancel/shutdown coupled; registration requestctx наследует wrapperctx.

Source prep started from reviewed UNVERIFIED Identity→Chat local parents.
No generation/native/compile/runtimePASS из этого README. Before fullgates/PR
ordinary merge generated+verified+published parents, exactcleanfreeze, bounded
heavy only; actualnamedPG/TLS/upgrade/cancel cases/testSKIP0 и twicepinnedBufSQLC
drift0 required. Native only approved fresh rtc_test_UUID schemas +own TLS/certs,
no sharedCompose/S3/SDK/download/flag. Pending media cleanup/real device/NAT/TURN/
group sound remain UNVERIFIED.

## План guard foundation для legacy mic-slot

Source preparation отдельного slice по ADR097 — dormant constructor policy,
default off, без env activation. `NewRepositoryWithMediaSlotGuard` и
`NewMediaStoreWithMediaSlotGuard` явно выбирают policy; обычные constructors,
main и config её не включают. Она сериализует legacy Create/Join и group Reserve под общим
user mutex. Parent discovery включает old active participation ended-call и
held grant; sorted calls → rooms → users locks и повторная проверка binding
исключают child→parent inversion. Изменившийся parent set требует rollback и
не более трёх полных transaction attempts в исходном context; exhaustion/DB
error означает unavailable, не revoked. Same-call legacy Join возвращает
только уже существующий matching participant и не выдаёт media grant/token;
repository не получает session/device и не заявляет проверку этого tuple.

Guard охватывает legacy Leave/End, ended-orphan repair, stale conflict/pruning
и ineligible signal-target exit. Matching held prepared/active/revoking grant
удерживает slot. Typed pending превращается в sanitized FailedPrecondition,
без successful left/ended response; существующий flag-off lobby/direct/stale
lifecycle сохраняется. В этом foundation cleanup не начинается и Leave/End
не объявляется принятым к исполнению. Source preparation ещё не native PASS.

WS close, mute и expiry токена не являются SFU teardown ACK. Future matching
proxy/SFU acknowledgement и отдельный durable call-wide End/Leave coordinator
нужны до media enable; one-grant finalizer не расширяется скрыто. Public status,
SDK/proxy/worker/UI/audio исключены. До generation/full checks/publication —
ordinary merge generated+verified+published Identity→Chat→registration parents,
новый clean freeze и собственные receipts; прежние PASS не переносятся.

## Accepted план public media Leave / End coordinator

План принят координатором 2026-10-12 по ADR097; additive контракты сгенерированы
и reviewed, но compile/native/runtime acceptance ещё не завершена. Additive commands с call_id/request_id и
fresh-authorized operation status, immutable parent intent + one-grant children
и room-generation cleanup journal. Live authority/provider adapters не реализованы.
Own Leave требует exact active auth session/device binding, включая own
reader/removed subject. End разрешён call creator +fresh eligible Chat role;
GroupOwner/admin не получает это право автоматически. Новая active own session
может читать minimal own Leave status без roster; revoked/anonymous bearer нет.

OPEN END INTENT удерживает admission/terminal barrier даже при0held/0participants
и всех grants REVOKED, пока selected room ACK pending. Legacy End/last-Leave/
stale/orphan paths не пишут premature ENDED/CLOSED; same-group Start и все
Join/Reserve/Activate/RegisterLease/reconnect закрыты. Child release допустим
только после full own ACK, parent End завершается лишь после ALL exact child
и room-generation trusted ACK в atomic finalizer. Empty UNKNOWN не complete.

Fresh lookup вне TX и sorted parents→rooms→users/recheck внутри не обещают
distributed auth atomicity. Local Leave/mute/WS close/providerHTTP200/expiry не
ACK; new leaf не наследует old targets, rotation unsupported. Pending history
neverdelete. Existing lobby/direct off-mode неизменен; SDK/proxy/workers/UI/
public enable не входят в coordinator foundation. Code только после Accepted
ADR review/commit, own fresh gates и verified generated published parent merges.

GroupMediaControlService proto расположен в `proto/aerochat/rtc/v1/
group_media_control_service.proto`. Он не регистрируется app/gateway; все три
typed stubs — Unimplemented. Existing RtcControlService и gateway interface
не меняются. `MediaControlStore` принимает validated model Actor/RoomClaim facts,
а не live Identity/Chat response или trusted SFU/proxy ACK. Reference journal
complete в native fixture не подтверждает звук/provider absence и не отдаётся
public клиенту. Authorization/SDK/private ACK adapters — отдельные узкие slices.

Registered additive migration000003 применяется обычным embedded bootstrap;
ledger теперь содержит четыре RTC migrations. Она удерживает immutable
intent/children/participants/room targets и pending history. Persisted open End
barrier действует независимо от constructor policy, включая zero-held phase.
Own child finalizer освобождает собственный slot после full model action ACK,
но call/room завершает только parent после всех child и room journals. Empty
unknown intent не становится complete. Room claim использует DB clock,15s lease
и guarded monotonic owner/fence/attempt CAS; это не benchmark и не worker loop.

Source tests подготовлены для exact targets/replay/status, observed End↔Join/
lease barriers, zero-held pending End, rollback/cancel/fence expiry/exhaustion,
other-room progress и actual registered003 upgrade/repeat retained history.
Они ещё UNRUN. Старые pre-upgrade fixtures seed primitive SQLC queries под old
schema; current writers вызываются после registered bootstrap, без42P01 bypass.
Native profiles/schema ownership/heavy queue прежние; до запуска — verified
published Identity→Chat→registration→guard ordinary merges и fresh freeze.

Первый whole check `check-wtqqnh9q` на generated HEAD `4e6ff3e` завершился
compile FAIL до native tests: SQLC возвращает nullable `pgtype.Bool` для
`MediaControlChildrenReady`, а source ожидал `bool`. Исправление учитывает
`Valid` и `Bool`: неизвестный/false result сохраняет pending и не позволяет
room action обойти children barrier. Generated SQL/proto не редактируются.
Исторический FAIL сохраняется; native/provider completion не подтверждена
и требует нового whole check на clean исправленном HEAD.

Accepted adapter refinement 2026-10-12: own minimal status использует отдельный
identity-only OwnStatusSubject/read после fresh active Identity, без требования
Chat role/roster и без fabricated RoleRemoved/Reader при NOT_FOUND/unavailable.
Saved same-user Leave replay из новой active session возвращает original
minimal scoped receipt, не создаёт target и не меняет replacement generation;
новый Leave требует exact current session/device held binding. End status
по-прежнему fresh creator +eligible Chat role. Revoked/anonymous bearer denied.
Model-complete Leave не становится public media COMPLETE: при UNKNOWN provider
facts adapter возвращает media_PENDING. Уточнение пока docs-only, actual
authorization/read adapters и SDK/admission/proxy ACK не реализованы.
