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
