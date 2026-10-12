# Identity authority state

Public Identity API сохраняет auth/session/device semantics [ADR-006](../../docs/adr/006-identity-auth-foundation.md). Foundation для будущего group media admission описана в [ADR-097](../../docs/adr/097-group-media-trusted-authorization-contract.md).

## Revisions и source outbox

Миграция `000007_identity_authority_revision_outbox.sql` добавляет persisted `authority_revision` в auth `user_sessions` и `user_devices`. Это версии session/device tuple, а не crypto-device state и не timestamp. Новые active rows имеют version1, historical revoked rows получают version2. LastSeen/profile/password/crypto changes не меняют эти revisions.

Session revoke/Logout выполняет NULL→revoked CAS, increment revision и source outbox insert в одной transaction. Device revoke атомарно меняет device и все её active sessions; один device event покрывает всю device. Ранее revoked sessions сохраняются. Повторный storage CAS не increment/version/event; public Logout retry с уже revoked bearer сохраняет прежний `unauthenticated` результат.

Outbox содержит только server IDs, subject kind, revision, timestamp и static reason; bearer/hash/profile/key/audio/payload не сохраняются. Событие сохраняется до будущей delivery независимо от удаления source rows. Default-disabled Identity delivery journal/client/worker описан ниже; media ack и retention/capacity policy ещё не реализованы; наличие строки не означает завершённый media teardown. RTC grants/proxy/SFU/browser group audio отсутствуют, media feature не включена.

## Private session authority

`aerochat.identity.authorization.v1.InternalAuthorizationService` предоставляет `ResolveSessionBearer` и `CheckBoundSession` только через отдельный optional HTTPS listener. Namespace не содержит literal Go `internal` path segment, но public mux/gateway этот сервис не регистрируют. Обычный browser/SFU token и caller header доступа не дают: нужны verified client chain от отдельной CA и единственная URI SAN `urn:aerochat:service:rtc-control`, с allowlist обеих read methods. TLS1.3, client-auth usage/expiry/URI checks без insecure/plain fallback.

Resolve проверяет existing opaque bearer в Authorization header; CheckBoundSession читает exact user/session/auth-device binding без bearer retention/impersonation/cache. Обе операции не трогают LastSeen. Response содержит только IDs, positive session/device revision tuple и ACTIVE/REVOKED/NOT_FOUND. Broken/missing/unsupported authority не возвращает active; revoked bearer не Resolve-ится. Request context имеет максимум5s (короткий incoming deadline сохраняется), headers/body/read/write ограничены. Private logs содержат method/status/duration и static TLS rejection, без URI/query/header/body/IDs/credentials.

По умолчанию private listener выключен. При включении все параметры обязательны; cert/key/CA берутся из operator-owned файлов, значения/PEM в repository не добавляются:

| Env | Значение |
| --- | --- |
| `AERO_IDENTITY_INTERNAL_AUTHORIZATION_ENABLED` | defaultfalse |
| `AERO_IDENTITY_INTERNAL_AUTHORIZATION_LISTEN_ADDR` | explicit private host:port; runtime owner задаёт network policy |
| `AERO_IDENTITY_INTERNAL_AUTHORIZATION_TLS_CERT_FILE` | действующий server-auth certificate с SAN |
| `AERO_IDENTITY_INTERNAL_AUTHORIZATION_TLS_KEY_FILE` | соответствующий private key |
| `AERO_IDENTITY_INTERNAL_AUTHORIZATION_CLIENT_CA_FILE` | dedicated client CA certificates |

Missing/bad config/material/listener приводит к startup failure без plain fallback. Public/private servers завершаются вместе; private fatal listener failure прекращает public readiness вместе с сервисом. Compose/production ports/cert provisioning в этом slice не изменяются. Enabling private API не включает media.

Positive revision и active-incrementable constraints исключают wrapping. Неожиданная constraint/transaction failure откатывает source revoke и outbox вместе и не возвращает successful revoke. Startup применяет migration через existing checksum bootstrap ledger; повторный bootstrap не сбрасывает revisions/events. Historical SQL не изменён.

## Проверки

Обычные unit tests не запускают integration-tag cases. Для actual PostgreSQL tests нужна dedicated owned fixture; `AERO_IDENTITY_TEST_ENV_FILE` указывает на task-owned файл с `AERO_DATABASE_URL` без вывода его содержимого:

```bash
agent-dev run --cwd "$PWD" --resource heavy -- go test -race -cover -count=1 -tags=integration ./...
agent-dev run --cwd "$PWD" --resource heavy -- go vet -tags=integration ./...
```

Использовать Go1.25.8 с корректным PATH/`GOTOOLCHAIN=go1.25.8`, pinned SQLC1.30.0 и финальный committed HEAD. Native state fixture принимает только dedicated local `aerochat_auth_test` на loopback25432, создаёт собственную новую `rtc_authority176_UUID` schema, проверяет отсутствие перед CREATE и удаляет только её. Existing151 integration cases используют собственные `identity_test_UUID` schemas. Docker/DB ownership и общий heavy lock согласуются по [development runbook](../../docs/development.md); эти команды не дают права на production или чужую БД.

Integration cases проверяют clean/legacy migration, session/logout/device source transactions, retry/concurrency с отдельными PostgreSQL sessions и наблюдаемыми lock barriers, rollback при outbox/session-step fault, revision boundary и сохранение события после reconnect. Отдельная actual generated Connect/TLS+PostgreSQL fixture проверяет свежий revoke на том же connection; TLS negative matrix использует test-only standard x509 CA/certs. Это local source/caller evidence; оно не доказывает delivery, distributed atomic admission, SFU, audio или real device/network flow.

## Rollback и следующие этапы

Старый binary не записывает новые revisions/outbox: rollback на него допустим только при media off и отсутствии active media grants. Schema, events и revisions при rollback не удаляются. До будущего media enable все authority writers должны поддерживать source outbox. Две private Identity read methods реализованы в этом slice; Chat authority, durable dispatch/operation status, retention/backpressure и RTC media cleanup внедряются отдельными reviewable PR. Успешный auth revoke не объявляется завершённым audio teardown.

## Identity revocation sender

Migration008 добавляет delivery journal и backfill только existing committed
outbox rows. Source event/journal insert — CTE в existing revoke TX; failed TX
не доставляет event. Private client вызывает лишь Identity Apply/GetEventReceipt
по ADR097, формируя DTO из claimed immutable source row. Event receipt mapping
retained; successful delivery не означает media complete.

States pending/delivered/quarantined. Claim использует SKIP LOCKED и DB-clock
lease15s, monotonic owner/fence/attempt; stale/expired worker не выполняет CAS.
Exhausted counters не изменяются и исключены из claim до selection, поэтому
другой due event прогрессирует; static exhausted_counter diagnosis без IDs.
Canonical conflict/malformed source row — guarded quarantined с staticreason,
без auto retry/repair. Pending/claimed/quarantined не удаляются. Media outcome
NO_MATCHING/MEDIA_PENDING лишь factual RTC receipt, никакого SFU absence ACK.

Default off: AERO_IDENTITY_RTC_REVOCATION_DELIVERY_ENABLED=false. При enable
обязательны BASE_URL (private https host/port), SERVER_CA_FILE, TLS_CERT_FILE,
TLS_KEY_FILE с тем же prefix AERO_IDENTITY_RTC_REVOCATION_DELIVERY_. Exact
Identity URI/clientAuth и strict CA validation; hostname verification стандартная,
нет redirects/env proxy/override/credentials в URL. TLS1.3, message4096 и
headers8192; errors/logs static без source IDs/URL/keys.

Single-inflight worker: общий5s claim→lookup/apply→CAS, recovery wake1s,
capped1–30s backoff; constants начальные, без capacity benchmark. Crash/response
loss доCAS восстанавливает own receipt lookup + обязательный canonical Apply
replay под тем же5s: совпадают event/operation, conflict quarantine, invalid или
different operation pending. Lookup по одному event ID не доказывает tuple.
Source revoke не меняется.
Shutdown cancels owned attempt; expired lease остаётся для durable takeover.
Runtime enable/cert provisioning назначает owner отдельно, media flag нет.

Actual sender fixture требует root-reviewed exact RTC binary внеGit и только
new own auth rtc_authority176_UUID +RTC rtc_test_UUID schemas по approved
profiles/loopback25432. Native tests должны доказать committed source→actual
TLS receiver, replay/crash/takeover/quarantine/counters/migration/rollback и
no payload logs. Source prep/generation не являются passed gate; публикация
требует clean committed exactHEAD full receipts/actualtestSKIP0. Physical audio,
NAT/TURN и SDK/proxy teardown остаются UNVERIFIED.

Для sender integration нужны `AERO_RTC_TEST_DATABASE_ENV_FILE` с PostgreSQL URL,
`AERO_RTC_RECEIVER_TEST_BINARY`, `AERO_RTC_RECEIVER_TEST_HEAD` и
`AERO_RTC_RECEIVER_TEST_BINARY_SHA256`. Отдельный RTC-процесс получает URL с
явными `search_path` и `application_name` собственной fixture. Изменение
`pgx.ConnConfig.RuntimeParams` не меняет результат `ConnString()`: этот метод
возвращает исходный DSN ([pgx v5.8.0](https://pkg.go.dev/github.com/jackc/pgx/v5@v5.8.0#ConnConfig.ConnString)).
Перед запуском fixture повторно разбирает передаваемый URL и проверяет привязку
к своей схеме. Значения профиля и URL в вывод не попадают.

Go 1.25.8 не записывает VCS settings при сборке из checkout с `.git`-файлом
([Go #58218](https://go.dev/issue/58218)). Для такого native gate создаётся новый
private clone через `git clone --no-local --no-hardlinks --no-checkout`, затем
`git checkout --detach` на проверенный SHA. До и после сборки проверяются SHA,
Git tree, clean status и отсутствие object alternates. `GOWORK` явно указывает
на `go.work` этого clone, `go env GOMOD` — на его RTC-модуль. Бинарник собирается
тем же Go 1.25.8 с `-buildvcs=true` вне clone; `go version -m` должен показать
точный package path, `vcs.revision` и `vcs.modified=false`. Исходный worktree
тоже остаётся чистым на том же SHA. Отсутствие VCS metadata не принимается как
успешная проверка происхождения бинарника.
