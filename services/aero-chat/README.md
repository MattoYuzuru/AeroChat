# aero-chat

Chat владеет группами, membership и текущими ролями. Контракты сообщений и encrypted lane описаны в [навигаторе ADR](../../docs/README.md); [ADR096](../../docs/adr/096-encrypted-conversation-server-sequence.md) задаёт server sequence и порядок group → thread locks. Этот документ описывает source authority для будущего group audio по принятому [ADR097](../../docs/adr/097-group-media-trusted-authorization-contract.md).

## Eligibility epoch и source outbox

Additive migration024 добавляет `group_membership_authority_versions`: exact group/user pair, positive persisted revision, present/eligible state. Membership остаётся источником свежей role; таблица версий сохраняет tombstone после physical удаления. Existing memberships получают epoch1; удалённые до migration пары не восстанавливаются. До подключения media активных grants на старый state нет.

Owner/admin/member имеют одинаковый audio eligibility: переходы между ними и ownership transfer сохраняют epoch без revoke event. Eligible→reader и physical remove/leave увеличивают epoch и добавляют ID-only event; reader→eligible и removed→rejoin увеличивают epoch без revoke event. Reader initial/rejoin остаётся запрещённым для media. Повтор одного state ничего не меняет. Message-only restriction не становится audio ban. Management permissions всегда используют свежую role, а не кеш по epoch.

AFTER membership trigger атомарно меняет state/outbox, включая group FK cascade. Trigger имеет SECURITY INVOKER, schema-qualified таблицы через quoted trigger schema и не берёт parent/user locks. Pair IDs immutable. Missing/inconsistent authority state и exhausted counter откатывают source operation; eligible MaxInt64 запрещён. RESTRICT user FK сохранён: raw user delete не каскадирует membership. Source outbox без FK cascade переживает удаление membership/group, а после допустимого удаления user сохраняет IDs/revision/reason. В outbox нет invite bearer/hash, profiles, MLS/keys, message/audio payload.

Existing membership и invite writers сериализуются на group row; quota paths берут user quota lock до group. Invite disable/create соблюдают group → invite порядок, Join не инвертирует его. Group encrypted message append сохраняет group → thread порядок. Raw cascades требуют отдельных native concurrency checks: trigger atomicity не является доказательством отсутствия deadlock.

Event resulting denied revision2 применяется только к matching pair/grant с revision≤2; новый eligible grant revision3 его не принимает. Dispatch/ack/retry worker, retention/backpressure, private Chat authorization API, RTC grant/admission/proxy/SFU/browser audio в этот slice не входят. Committed event не означает media_teardown_complete; group audio остаётся выключенным. Позднейший private API обязан проверять fresh membership + retained state/revision и неизвестные значения отвергать.

## Private subject lookup

Следующий отдельный API slice добавляет `chat.authorization.v1.InternalAuthorizationService.CheckGroupSubject`. Exact group/user IDs поступают из registry RTC, а не из browser claims. Одна SQLC query читает snapshot group/membership/retained authority; fresh role возвращается при неизменном eligibility epoch для owner/admin/member. Missing authority при existing membership, mismatch presence/class, unknown role и exhausted eligible epoch возвращают sanitized unavailable. Genuine never-known pair получает NOT_FOUND без fabricated IDs/epoch; tombstone получает REMOVED с persisted epoch. LastSeen/profile/MLS/messages не читаются и не изменяются.

Private listener disabled по умолчанию. Для explicit setup нужны:

| Env | Назначение |
| --- | --- |
| `AERO_CHAT_INTERNAL_AUTHORIZATION_ENABLED=true` | Включить отдельный private HTTPS listener |
| `AERO_CHAT_INTERNAL_AUTHORIZATION_LISTEN_ADDR` | Explicit host:port private сети, без public gateway route |
| `AERO_CHAT_INTERNAL_AUTHORIZATION_TLS_CERT_FILE` | Valid serverAuth leaf с DNS/IP SAN |
| `AERO_CHAT_INTERNAL_AUTHORIZATION_TLS_KEY_FILE` | Соответствующий private key, вне repo/logs |
| `AERO_CHAT_INTERNAL_AUTHORIZATION_CLIENT_CA_FILE` | Dedicated valid client CA certificates |

TLS1.3 и verified client chain обязательны; единственный URI SAN caller — `urn:aerochat:service:rtc-control`. Header/произвольный env principal не авторизуют. Public Chat mux private route не регистрирует. Missing/bad config/CA/keypair закрывают startup без plaintext fallback; fatal public/private server exit останавливает второй listener. Общий request budget5s, body limit4096, static errors/logs без credential/subject payload. Эта конфигурация не открывает grants/SFU и не включает group audio.

Local source preparation не заменяет required exact-HEAD gates: state native checks должны пройти до publication state/API; API требует собственных actual typed Connect/mTLS/PG checks с wrong/no/expired/ambiguous/wrong-EKU certificates, raw HTTP/header spoof/public route denial, same-connection fresh role/epoch transitions и cancellation. Deployment isolation, реальные devices/NAT/TURN/WAN и media ACK остаются отдельными проверками. Runtime/certificate provisioning выполняет согласованный owner, а не API code.

## Проверки

Go1.25.8; пример unit gate:

```sh
GOTOOLCHAIN=go1.25.8 go test -race -cover ./...
```

Native authority cases помечены `integration` и требуют `AERO_CHAT_AUTHORITY_TEST_ENV_FILE` с профилем owned loopback PostgreSQL `aerochat_media_test:25432`. Тесты создают исключительно новые `rtc_chat_authority176_UUID` schemas: absence preflight, atomic CREATE, exact search_path, cleanup только собственных успешно созданных schemas. Команда в разрешённом runtime scope:

```sh
GOTOOLCHAIN=go1.25.8 go test -tags=integration -race -count=1 -timeout=120s -run '^TestGroupAuthority' ./internal/storage/postgres
```

В общий local workflow команды запускаются через shared `agent-dev` resource heavy, source фиксируется committed HEAD/receipt; значения fixture DSN не выводятся. Этот selector не запускает другие integration suites с чужими profiles/schema names и не переносит их старые результаты.

Migration/bootstrap повторяемые и additive. Rollback к старому binary на новой schema сохраняет trigger invariant; drop trigger/schema/events при active media недопустим. Возврат к source без authority schema допускается только при media off/no active grants, без удаления сохранённых pending events. Actual deployment, SFU/media и real-device/NAT/TURN/WAN проверки нужны отдельными этапами.

Передача владельца группы выполняет demotion прежнего owner, затем promotion
нового owner в одной transaction под group row lock. Это сохраняет immediate
unique owner index независимо от heap/UUID order. Missing, restricted или уже
изменившийся target не оставляет группу без owner; ошибка promotion откатывает
обе роли. Owner/admin/member transitions сохраняют audio eligibility epoch.

Write restriction явно типизирует timestamp parameter как `timestamptz` в обоих
CASE expressions, включая idempotency predicate. Именованный nullable
[sqlc.narg](https://docs.sqlc.dev/en/latest/howto/named_parameters.html#nullable-parameters)
сохраняет поле `WriteRestrictedAt` с типом `pgtype.Timestamptz`. Это сохраняет nullable time и
повторный unchanged result при установке/снятии ограничения; message-only
restriction не меняет audio eligibility epoch. Native
`TestGroupAuthorityWriteRestrictionTimestampRoundTrip` проверяет реальный
repository writer, persisted timestamp, повтор и NULL при снятии ограничения на
owned PostgreSQL. Установка ограничения без timestamp по-прежнему отклоняется
constraint `group_memberships_write_restriction_consistency`, сохраняя прежнюю
дату и authority epoch; native regression проверяет и этот rollback.

## Chat revocation sender

Migration025 добавляет chat_revocation_delivery journal, backfill существующего
outbox024 и qualified SECURITY INVOKER AFTER INSERT outbox trigger. Source
membership/epoch/outbox/journal записываются в одной TX, journal failure rollback
всего transition. Historical024 и текущие group-first locks не переписываются;
новый trigger не берёт parent group/user locks. FK RESTRICT только immutable
outbox event, без group/user cascade, history pending/quarantined retained.

Producer формирует ровно event/group/user IDs + source_revision→eligibility_epoch
из claimed committed row. eligibility_denied/member_removed оба group-denied;
original reason/time остаются source audit. RPC не содержит current role,
reader/removal/present/eligible flags: sender/receiver не выдумывают эти facts
из отсутствующих полей и не отменяют old event после rejoin. Current management
role читается свежим private authorization API отдельно от audio epoch.

Pending/delivered/quarantined journal: DB-clock lease15s, monotonic owner/fence/
attempt, expired/stale CAS rejected. Exhausted counters unchanged/excluded перед
next eligible selection, static exhausted_counter и прогресс другого event.
Unknown source row/canonical conflict guarded quarantine/staticreason/noautorepair.
Own receipt lookup MUST canonical Apply replay under SAME total5s; sameevent/op,
transient/invalid/differentoperation pending. Delivered — durable RTC commit,
NO_MATCHING/MEDIA_PENDING factual registry receipt, не SFU absence/media completion.

Default off AERO_CHAT_RTC_REVOCATION_DELIVERY_ENABLED=false. При enable нужны
BASE_URL(private https authority), SERVER_CA_FILE, TLS_CERT_FILE, TLS_KEY_FILE
с prefix AERO_CHAT_RTC_REVOCATION_DELIVERY_. Fixed sole Chat URI/clientAuth,
TLS1.3/strict CA/standard hostname verification, no redirects/envproxy/caller
override. Typed ApplyChatEvent/GetChatEventReceipt only; read/send4096/header8192.
Singleinflight/wake1s/capped1–30s retry — начальные constants, не benchmark.
Worker связан с production app HTTP ctx и awaited shutdown; attachment cleanup/
Redis/S3/crypto flow не меняются, native sender fixtures их не запускают.

Native scope: approved rtc-chat-authority176 profile/new rtc_chat_authority176_UUID
и RTC profile/new rtc_test_UUID, absence/atomicCREATE/exactsearch_path/own cleanup,
production exact-head RTC binary внеGit/verifiedSHA+vcsHEAD/owned ephemeral
listeners/PID TERM3/KILL3. Cases source triggerrollback/backfill/eligible writers,
observed claim/takeover/staleCAS/exhaustion/malformedquarantine, actual TLSreceipt
postcommit CASfault/restart/canonicalconflict, enabledwrapper cancellation,
clientcertificate/redirect/SAN boundaries. Code prep не является native PASS.

Local Chat source prep может идти от reviewed UNVERIFIED Identityd6 в отдельном
WT. До fullgates/publication обязательно ordinary merge generated/verified/
published Identity parent и fresh clean whole run; parent receipts не переносятся.
No manualgeneratedcode, no media flag/runtimeenable. Actual group sound, trusted
SDK/proxy cleanup, real devices/NAT/TURN остаются UNVERIFIED.

Sender integration также требует `AERO_RTC_TEST_DATABASE_ENV_FILE` с PostgreSQL
URL и `AERO_RTC_RECEIVER_TEST_BINARY`, `AERO_RTC_RECEIVER_TEST_HEAD`,
`AERO_RTC_RECEIVER_TEST_BINARY_SHA256`. Перед subprocess launch fixture явно
записывает собственные `search_path`/`application_name` в URL и проверяет их
повторным parse: изменение `pgx.ConnConfig.RuntimeParams` не обновляет исходный
`ConnString()` ([pgx v5.8.0](https://pkg.go.dev/github.com/jackc/pgx/v5@v5.8.0#ConnConfig.ConnString)).
Профили и URL не выводятся. Правила full-clone сборки Go 1.25.8 и проверки
реальных VCS settings перечислены в [Identity native gate](../aero-identity/README.md#identity-revocation-sender).
Отсутствие metadata не принимается за PASS; новые fixtures не ослабляют native
assertions, а ordinary verified published Identity parent нужен до codegen/gates.
