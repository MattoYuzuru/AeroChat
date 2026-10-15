# Проверка атомарного RTC lifecycle

Unit tests запускаются обычным `go test ./...`. PostgreSQL tests используют только отдельную loopback БД `aerochat_rtc_test`; при отсутствии конфигурации integration cases явно skipped, что не считается integration evidence.

Для обязательного integration-прогона задать `AERO_RTC_TEST_DATABASE_URL` через окружение либо `AERO_RTC_TEST_DATABASE_ENV_FILE` — путь к task-owned env-файлу с `AERO_DATABASE_URL`. Значение DSN не печатать. Тесты создают уникальный schema, минимальный users fixture и настоящую RTC schema; cleanup удаляет только этот test schema.

```bash
agent-dev run --cwd "$PWD" --resource heavy -- go test -count=1 -v ./internal/storage/postgres -run TestPostgres
```

Suite проверяет reject ended join и восстановление orphan user slot; Join против End и последнего Leave в обоих порядках. Две отдельные connection pools блокируются на внешнем row lock, readiness barrier сверяется с PostgreSQL `pg_stat_activity`, затем lock освобождается. Отдельный trigger вводит failure при изменении call status: participant exit должен откатиться. Failed participant insert при Start не должен оставлять phantom call. Тесты не проверяют media/signaling delivery, реальную сеть или production.
