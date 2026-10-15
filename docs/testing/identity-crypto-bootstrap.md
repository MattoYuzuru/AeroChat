# Проверка атомарного first-device bootstrap

Контракт — [ADR-056](../adr/056-crypto-device-registry-public-bundles-and-linked-device-ceremony-foundation.md), задача — [#151](https://github.com/MattoYuzuru/AeroChat/issues/151).

Unit gate: `go test -race -count=1 -cover ./services/aero-identity/...`.

PostgreSQL integration suite требует отдельную тестовую БД, в которой разрешено создавать и удалять собственные schema. Оно не запускает контейнеры и не использует production credentials. Передать `AERO_IDENTITY_TEST_DATABASE_URL` через environment либо `AERO_IDENTITY_TEST_ENV_FILE` — путь к внешнему файлу с одной literal строкой `AERO_DATABASE_URL=...`. DSN не печатается; shell sourcing не нужен.

```bash
agent-dev run --cwd /absolute/AeroChat --resource heavy -- \
  env GOTOOLCHAIN=go1.27.2 AERO_IDENTITY_TEST_ENV_FILE=/outside-Git/auth-fixture.env \
  go test -tags=integration -race -count=1 -v ./services/aero-identity/internal/storage/postgres
```

Каждый тест создаёт уникальную schema, применяет embedded identity migrations через штатный bootstrap и удаляет только эту schema при завершении. Отсутствующий fixture — ошибка, а не skipped success.

Проверяются: два соединения, ожидающих owner row lock одновременно, ровно один успешный bootstrap и один conflict; конфликт для непустого и полностью revoked registry; rollback device при ошибке bundle insert; сохранение pending registration и signed approval до двух active устройств. Repository bundle fixtures синтетические; signed approval использует существующий формат proof и временный P-256 key. Suite проверяет storage transitions и не является audit криптографического протокола.
