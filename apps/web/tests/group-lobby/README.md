# Group lobby heartbeat regression

Browser fixture запускает production hook/ownership selector на настоящем React с ускоренными browser clock и fake RTC RPC. Она проверяет 20s cadence, observer/reader/hidden/leave/unmount gating и ноль capture/peer/audio element. Полный GroupsPage/AuthProvider и реальное audio/network она не поднимает.

После frozen pnpm install задать `PLAYWRIGHT_MODULE` (абсолютный ESM путь к внешнему Playwright) и `CHROMIUM_EXECUTABLE`. Запуск из repository root:

```bash
agent-dev run --cwd "$PWD" --node 22 --resource heavy -- node apps/web/tests/group-lobby/run.mjs
```

Fixture использует только loopback `25173` (либо `RTC_FIXTURE_PORT`) и закрывает Vite/browser в finally.

Отдельный `TestPostgresGroupLobbyHeartbeatAndCrashEviction` проверяет production RTC service/repository с test identity/chat и настоящей PostgreSQL: configured cutoff 1s, joined Touch >2 окна, reader не продлевает owner, Leave и crash eviction освобождают call/user slot. Нужна dedicated loopback `aerochat_rtc_test` БД; `AERO_RTC_TEST_DATABASE_ENV_FILE` задаёт task-owned файл с `AERO_DATABASE_URL` без вывода значения. Schema каждой fixture имеет собственное имя `rtc_touch162_UUID`; другие schemas не меняются. Без profile integration case явно skipped и не считается evidence.
