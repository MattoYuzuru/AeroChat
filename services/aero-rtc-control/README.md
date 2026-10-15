# RTC control и media foundations

Сервис управляет lifecycle/signaling звонков 1:1 и групповым лобби. Для будущего
group media реализованы persisted grants/operations, private source receiver,
admission-instance registration, legacy media-slot guard и Leave/End coordinator.
Identity/Chat source senders и private authority APIs реализованы в своих сервисах.

Authorized public-control factory проверяет свежие private facts и scoped status,
но не mounted в app/gateway. Provider/token adapter, SFU/admission proxy, trusted
media teardown ACK, workers и browser group audio ещё не подключены. Private
listeners и delivery по умолчанию выключены; публичные media stubs возвращают
Unimplemented. Контракты — [ADR-089](../../docs/adr/089-group-audio-sfu-and-admission-boundary.md)
и [ADR-097](../../docs/adr/097-group-media-trusted-authorization-contract.md).

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
booleans. Source sender workers реализованы в Identity и Chat; по умолчанию они выключены.

DURABLY_APPLIED означает RTC inbox/watermark/operation commit. Same canonical
event replay получает тот же operation; changed payload conflict. Own-domain
receipt lookup содержит лишь event ID, не generic subject/operation lookup.
Количество — distinct full grant keys exact source scope, не action/lease rows.
NO_MATCHING_REGISTRY_GRANTS factual empty registry set: не SFU/RTP absence proof.
Nonempty target всегда MEDIA_PENDING в этом receiver, даже если journal помечен
complete тестовой моделью. Реальный media completion требует позднего reviewed
trusted SDK/proxy adapter; authorized control adapter описан ниже и пока не mounted в public app/gateway.

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

## Guard для legacy media slot

Реализована dormant constructor policy по ADR-097,
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
не объявляется принятым к исполнению. Durable Leave/End coordinator описан ниже.

## Durable Leave / End coordinator

`MediaControlStore` сохраняет immutable parent intent, child/participant/room
snapshots и pending history. Registered migrations 000000–000003 применяются
embedded bootstrap при startup/upgrade. Open End barrier удерживает admission
и terminal transition даже при нуле held grants/participants до matching room ACK.
Child release допустим только после полного собственного action ACK; call/room
завершает parent после всех exact child и room journals. Empty UNKNOWN остаётся
pending. DB-clock claim/lease/fence/attempt CAS исключает stale worker completion.

Actor/RoomClaim и journal ACK — model facts. Они не доказывают фактическое
удаление participant/room в SFU. WS close, mute, HTTP200 и token expiry не являются
trusted teardown ACK; pending history не удаляется. Default lobby/direct behavior
сохраняется; отдельный media feature не включён.

## Authorized media control factory

Фабрика использует opaque bearer через private Identity и свежие Chat facts.
Own minimal status и сохранённый Leave replay доступны после fresh active Identity
без fabricated Chat role. Новый Leave требует exact session/device held binding;
End требует call creator и текущий eligible Chat subject. Отозванный/anonymous
bearer отклоняется. Общий budget 5s начинается до Connect decode; body cap 4KiB,
read/write deadlines и локальный guard ограничивают запрос до journal mutation.
UNKNOWN provider facts возвращают PENDING, даже если reference model journal complete.

Фабрика не подключена к public app/gateway. Это не provider/token adapter,
полный Chat main/Compose или реализация группового звука.

## Проверки

Go 1.27.2; команды и ownership — в [development](../../docs/development.md).
PostgreSQL schemas, selectors и profiles — в [storage testing](internal/storage/postgres/README.md).
Native public-control scope использует настоящий Identity main и Chat test-host
с production domain/repository/private TLS listener. Fixture не запускает Redis/S3.
Ей нужны exact-source binaries и собственный PostgreSQL profile; выбранный native
scope завершается ошибкой при отсутствии profile и не выдаётся за unit PASS.

Тесты подтверждают соответствующий source/runtime scope. Исторические exact-SHA
результаты — в [candidate report](../../docs/audits/2026-10-13-integration-candidate.md),
актуальные ограничения и ручная приёмка — в [project status](../../docs/project-status.md).
Physical audibility, devices/NAT/TURN и SFU cleanup остаются отдельной проверкой.
