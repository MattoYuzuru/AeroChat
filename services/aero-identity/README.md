# Identity authority state

Public Identity API сохраняет auth/session/device semantics [ADR-006](../../docs/adr/006-identity-auth-foundation.md). Foundation для будущего group media admission описана в [ADR-097](../../docs/adr/097-group-media-trusted-authorization-contract.md).

## Revisions и source outbox

Миграция `000007_identity_authority_revision_outbox.sql` добавляет persisted `authority_revision` в auth `user_sessions` и `user_devices`. Это версии session/device tuple, а не crypto-device state и не timestamp. Новые active rows имеют version1, historical revoked rows получают version2. LastSeen/profile/password/crypto changes не меняют эти revisions.

Session revoke/Logout выполняет NULL→revoked CAS, increment revision и source outbox insert в одной transaction. Device revoke атомарно меняет device и все её active sessions; один device event покрывает всю device. Ранее revoked sessions сохраняются. Повторный storage CAS не increment/version/event; public Logout retry с уже revoked bearer сохраняет прежний `unauthenticated` результат.

Outbox содержит только server IDs, subject kind, revision, timestamp и static reason; bearer/hash/profile/key/audio/payload не сохраняются. Событие сохраняется до будущей delivery независимо от удаления source rows. Delivery/ack/retry worker и retention/capacity policy ещё не реализованы; наличие строки не означает завершённый media teardown. RTC grants/proxy/SFU/browser group audio отсутствуют, media feature не включена.

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

Использовать Go1.25 с корректным PATH/`GOTOOLCHAIN=local`, pinned SQLC1.30.0 и финальный committed HEAD. Native state fixture принимает только dedicated local `aerochat_auth_test` на loopback25432, создаёт собственную новую `rtc_authority176_UUID` schema, проверяет отсутствие перед CREATE и удаляет только её. Existing151 integration cases используют собственные `identity_test_UUID` schemas. Docker/DB ownership и общий heavy lock согласуются по [development runbook](../../docs/development.md); эти команды не дают права на production или чужую БД.

Integration cases проверяют clean/legacy migration, session/logout/device source transactions, retry/concurrency с отдельными PostgreSQL sessions и наблюдаемыми lock barriers, rollback при outbox/session-step fault, revision boundary и сохранение события после reconnect. Отдельная actual generated Connect/TLS+PostgreSQL fixture проверяет свежий revoke на том же connection; TLS negative matrix использует test-only standard x509 CA/certs. Это local source/caller evidence; оно не доказывает delivery, distributed atomic admission, SFU, audio или real device/network flow.

## Rollback и следующие этапы

Старый binary не записывает новые revisions/outbox: rollback на него допустим только при media off и отсутствии active media grants. Schema, events и revisions при rollback не удаляются. До будущего media enable все authority writers должны поддерживать source outbox. Private APIs, durable dispatch/operation status, retention/backpressure и RTC media cleanup внедряются отдельными reviewable PR; успешный auth revoke не объявляется завершённым audio teardown.
