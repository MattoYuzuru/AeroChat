# Проверка атомарного RTC lifecycle

Unit tests запускаются обычным `go test ./...`. PostgreSQL tests используют только отдельную loopback БД `aerochat_rtc_test`; при отсутствии конфигурации integration cases явно skipped, что не считается integration evidence.

Для обязательного integration-прогона задать `AERO_RTC_TEST_DATABASE_URL` через окружение либо `AERO_RTC_TEST_DATABASE_ENV_FILE` — путь к task-owned env-файлу с `AERO_DATABASE_URL`. Значение DSN не печатать. Тесты создают уникальный schema, минимальный users fixture и настоящую RTC schema; cleanup удаляет только этот test schema.

```bash
agent-dev run --cwd "$PWD" --resource heavy -- go test -count=1 -v ./internal/storage/postgres -run TestPostgres
```

Suite проверяет reject ended join и восстановление orphan user slot; Join против End и последнего Leave в обоих порядках. Две отдельные connection pools блокируются на внешнем row lock, readiness barrier сверяется с PostgreSQL `pg_stat_activity`, затем lock освобождается. Отдельный trigger вводит failure при изменении call status: participant exit должен откатиться. Failed participant insert при Start не должен оставлять phantom call. Тесты не проверяют media/signaling delivery, реальную сеть или production.

## Dormant media journal ADR-097

Migration `000001_dormant_media_grant_store.sql` зарегистрирована через embedded
`rtcschema.Files` и автоматически применяется штатным `dbbootstrap.Apply` при
обычном старте, включая upgrade существующей БД. Условного migrator нет.
Отдельный `MediaStore` пока не вызывается RTC service/transport handlers.
Lobby/1:1 по-прежнему использует прежний
repository; media flag, SDK/JWT, private RTC API, proxy, workers и frontend
отсутствуют. До их включения нужен отдельный reviewed compatibility slice:
End/Leave/stale eviction с held grants обязаны возвращать pending cleanup.

Store сохраняет opaque binding, tuple session/device revisions и eligibility
epoch, отдельные room/grant generations, user mutex, source inbox/deny watermarks,
operations/targets и cleanup outbox. Reserve+Join атомарны; prepared, active и
revoking удерживают global user slot. Quota комнаты считает held grants даже
после legacy participant exit; room/user generation exhaustion возвращает
unavailable без deny watermark. Ошибка PostgreSQL/cancellation не становится
permanent authority deny. Room mapping не меняется при join другого
user. IDs и counters не удостоверяют caller: будущий adapter должен проверять
свежую Identity/Chat authority, mTLS owner registration и фактический proxy/SFU
cleanup. Current management role здесь не кешируется. Ни bearer/JWT/hash/jti,
ни SDP/ICE, audio, ключи или profile/group names не сохраняются.

`RecordCleanupAcknowledgement` принимает полный immutable key, persisted
operation/lease/admission owner fence и worker claim fence. Это journal evidence,
**не реальный trusted SFU ACK**: adapter/SDK/mTLS boundary ещё не реализован.
Partial action остаётся pending; новый worker после claim expiry исключает старый
ACK. WS close меняет только matching lease, не grant или publication budget.
Registry room `closed` означает отсутствие held grants этой mapping; store не
вызывает DeleteRoom и не утверждает удаление SFU room. Все required participant
cleanup actions сохраняются до completion; pending history не удаляется.

Prepared deadline — 20 секунд. `ExpirePrepared` допускает release лишь при
persisted отсутствии activation intent и **любых** leases, без SFU receipt.
Activate записывает intent до будущего mint. Active hard lifetime/JWT expiry
release отсутствует; retry/claim duration передаёт будущий trusted worker,
production tuning требуется в отдельном wiring PR. Transient lookup отказ не
меняет active state/watermarks; явно запрошенный recovery-exhaustion cleanup
сохраняет outcome `unavailable`, не `revoked`.

Один held grant на user ограничивает source-event parent set одним call/room.
Store берёт call → room → user mutex, повторно читает set и делает bounded
rollback/retry при смене parent. Inbox и denied watermark atomic с pending
cleanup; delayed deny epoch2 не меняет eligible grant3. Remote source lookup и
RTC commit не являются distributed transaction: до доставки outbox сохраняется
cross-domain race, будущий reconcile должен закрывать её.

Native `TestMediaStoreRegisteredBootstrapUpgradeKeepsLegacyLifecycle` проверяет
штатные embedded bootstrap files/requirements на fresh DB и upgrade с legacy
call rows, idempotent repeat и настоящие legacy Touch/stale prune/Leave через
RTC service + PostgreSQL после migration; source auth здесь fixture, не mTLS
или real-device evidence.

Native `TestMediaStore*` используют только fresh `rtc_test_UUID` в отдельной
`aerochat_rtc_test`: absence preflight, atomic CREATE, точный search_path, cleanup
только после успешного CREATE. Конкурентные cases используют два named PG backend
и observed lock wait; это storage evidence, не два RPC/WS или audio/network.

```bash
GOTOOLCHAIN=go1.25.8 agent-dev run --cwd "$PWD" --resource heavy -- go test -json -race -count=1 -timeout=120s -run '^TestMediaStore' ./internal/storage/postgres
```

Обязательный gate задаёт task-owned `AERO_RTC_TEST_DATABASE_ENV_FILE`; skips
не считаются native evidence. Отдельно проверяются unit/race, vet/lint, touched
formatting, frozen source и два pinned SQLC/Buf generations без drift. Future
Go27 combined candidate проверяется заново и не наследует Go1.25.8 receipt.


Registration concurrency fixture сохраняет3s/10ms wait и два concurrent workers.
Наблюдение ограничено exact root locker и двумя owned PID, application/database
binding, active Lock waits и real ungranted fence-row/transaction locks; каждый
worker должен достигать того же root через только owned blockers без cycle,
foreign/zero/self PID. Success и last-failure witness содержат только PID/lock
metadata, без query text, credentials или domain payload. Прямой blocker не всегда
root: PostgreSQL допускает hard/soft очередь, а row waits могут отражаться через
transaction lock ([pg_blocking_pids](https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-INFO-SESSION),
[pg_locks](https://www.postgresql.org/docs/current/view-pg-locks.html)).
Гипотеза о worker→worker→locker для исторического direct-only predicate failure
не является actual observed graph; новый native witness и fresh exact-source
whole gate обязательны. Pure graph tests не заменяют native concurrent replay,
distinct nonce/fence/allocation assertions и не доказывают registration/media enable.


Strong graph helper `registrationConcurrentWait` обслуживает только две barriers
concurrent replay/distinct-nonce test. Shared `registrationWait` для двух inherited
TLS single-worker barriers сохраняет исходные signature и body; TLS source не
изменяется. Изменение helper API требует inventory всех callers до нового gate.

Whole `check-43x2s13s` на `2a94bdf` завершился FAIL при декодировании lock metadata,
до успешного graph witness; 21 pure graph cases и остальные пять native registration
cases прошли, но не заменяют whole gate. Source review выявил несовместимость:
`pg_locks.relation` имеет тип OID, который PostgreSQL преобразует в JSON string,
а fixture ожидает числовой `uint32`. Тестовый query явно приводит OID к `bigint`;
диагностика type error содержит только имя поля, категорию JSON и Go type,
без исходного JSON/value. В этом failed gate observed graph не был получен.

Whole `check-_kxt9jyl` на `69f57cc` получил два actual owned graph witnesses
worker→worker→root и PASS всех шести native registration cases, 21 pure graph cases
и privacy case без actual test SKIP. Whole остаётся FAIL: RTC lint обнаружил
избыточную initial assignment при преобразовании instance state в transport enum.
Все три допустимые ветви присваивают значение, default возвращает ошибку;
объявление без инициализации сохраняет mapping. Fresh exact-source whole gate
после исправления ещё не выполнялся; partial native PASS его не заменяет.
