# Разработка AeroChat

Правила изменений находятся в [AGENTS.md](../AGENTS.md), карта контекста — в [навигаторе](README.md). Команды ниже сверены с [Taskfile](../Taskfile.yml), [web package](../apps/web/package.json) и [CI](../.github/workflows/ci.yml); фактические результаты проверок фиксируются отдельно в [аудите](audits/2026-10-11-readiness.md).

## Инструменты

- Git, Go **1.25** по `go.work`, Node.js **22** по CI, pnpm **10.19.0** по `package.json`.
- Docker Engine / Docker Compose для полного локального стенда.
- Task, Buf, sqlc и golangci-lint устанавливаются `infra/scripts/install-dev-tools.sh` в `bin`; версии зафиксированы в скрипте. Task leaf-команды используют exact `bin` paths; `task check` не требует ручного изменения PATH для Buf/sqlc/linter. Для прямого вызова этих CLI: `export PATH="$PWD/bin:$PATH"`.

Установка инструментов и зависимостей:

```bash
./infra/scripts/install-dev-tools.sh
pnpm install --frozen-lockfile
```

`task tools` выполняет ту же установку инструментов, если Task уже доступен. Для pnpm можно использовать `npx pnpm@10.19.0`.

## Локальный стенд

```bash
cp .env.example .env
docker compose -f infra/compose/docker-compose.yml up --build -d
docker compose -f infra/compose/docker-compose.yml ps
```

Открыть `http://127.0.0.1:${NGINX_PORT}` с портом из `.env`. При первом запуске `aero-identity` и `aero-chat` автоматически применяют PostgreSQL-схему до readiness; ручной `psql` не нужен. Проверить логи и `/healthz`, `/readyz` публичного gateway. Для остановки без удаления данных:

```bash
docker compose -f infra/compose/docker-compose.yml down
```

Root `.env.example` управляет compose. Для запуска из исходников использовать `services/*/.env.example`, `apps/web/.env.example` и `pnpm --filter @aerochat/web dev`. Source-mode приложениям нужны доступные инфраструктурные зависимости; Vite сам их не поднимает.

| Конфигурация | Назначение и ограничение |
| --- | --- |
| `AERO_MEDIA_S3_INTERNAL_ENDPOINT`, `AERO_MEDIA_S3_PRESIGN_ENDPOINT` (source-mode); `MEDIA_S3_PUBLIC_ENDPOINT` (compose) | Внутренний service-to-storage endpoint и отдельный browser-visible endpoint для presigned URL; браузеру нельзя отдавать compose-host `minio:9000`. |
| `MEDIA_S3_CORS_ALLOWED_ORIGINS` | Origins для browser upload; локальный compose применяет CORS и bootstrap приватного bucket. |
| `AERO_MEDIA_USER_QUOTA_BYTES` | Per-user budget по backend attachment state; `detached`, `expired`, `deleted` не удерживают активный budget. |
| `AERO_MEDIA_DETACHED_ATTACHMENT_RETENTION` | Grace period перед удалением detached objects; source-mode читает ключ, оба compose пока не пробрасывают его ([#174](https://github.com/MattoYuzuru/AeroChat/issues/174)). |
| `AERO_MAX_ACTIVE_GROUP_MEMBERSHIPS_PER_USER` | Лимит активных membership для create/join; leave/remove освобождают capacity. |
| `AERO_WEB_PUSH_SUBSCRIBER`, `AERO_WEB_PUSH_VAPID_PUBLIC_KEY`, `AERO_WEB_PUSH_VAPID_PRIVATE_KEY` | Полный VAPID-блок нужен для background push; частичная конфигурация считается ошибкой старта, пустая отключает push. |

Push требует secure context: `localhost` или HTTPS-origin для внешнего домена/телефона. UI-тогглы сами по себе не доказывают доставку. Секреты остаются в локальных env-файлах и не входят в Git или отчёты.

## Проверки

Запускать последовательно после установки инструментов и зависимостей. Генерация меняет файлы: проверять её diff и не совмещать с редактированием тех же контрактов. Buf remote plugins закреплены version + revision в `buf.gen.yaml`: protobuf Go `1.36.11`, Connect Go `1.19.1`, оба revision `1`. SQLC закреплён на `1.30.0` в installer и CI. Версия Buf CLI — `1.59.0`.

`task generated:check` удаляет только `.go` files с первой строкой `// Code generated ` в четырёх generated output-каталогах, затем выполняет Buf и SQLC generation и проверяет tracked/staged/untracked drift относительно HEAD. Ручные regression tests, `gen/go/go.mod` и `go.sum` сохраняются. Команда позволяет обнаружить outputs от удалённых proto/SQL inputs, требует чистой согласованной source phase и намеренно возвращает nonzero при незакоммиченных generated changes. После изменения контрактов выполнить обычные generation tasks, проверить diff, закоммитить inputs и outputs вместе, затем повторить `generated:check`.

Обновление generator: проверить [официальный формат version/revision](https://buf.build/docs/configuration/v2/buf-gen-yaml/#type-of-plugin), изменить точные pins отдельным PR, выполнить generation и Go compile/tests против текущего runtime major, проверить полный generated diff. Изменение Connect runtime major требует отдельного решения; pin не должен автоматически переходить на latest. CI выполняет Buf + SQLC drift gate и negative fixtures (`sh infra/scripts/test-generated-drift.sh`).

| Scope | Команда |
| --- | --- |
| Proto style | `task proto:lint` |
| Proto generation | `task proto:generate` |
| SQL generation | `task sqlc:generate` |
| Generated drift | `task generated:check` |
| Go tests | `task go:test` |
| Go lint | `task go:lint` |
| Web unit tests | `task web:test` |
| Web lint | `task web:lint` |
| Web typecheck/build | `task web:build` |
| Local compose | `task compose:config` |
| Server compose | `task compose:server:config` |
| Workflow lint | `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.8` |

`task go:fmt` форматирует workspace Go-файлы и является изменяющей командой. Для проверки форматирования без записи:

```bash
gofmt -l $(git ls-files '*.go' ':!:gen/go/**')
git diff --check
```

`task check` выполняет последовательные task calls: tools → frozen web install → proto lint → Buf/SQLC generation+drift → Go tests/lint → web lint/tests/build → Compose config. Failed preparation останавливает consumers; generation не меняет outputs одновременно с Go checks. Local/server Compose checks используют те же example env files, что CI, и `config --quiet` не выводит интерполированную модель. Source freeze обязателен для итогового прогона; `check` намеренно отклоняет незакоммиченные generated changes. Отдельные команды выше остаются доступны для узких checks.

Task по умолчанию отдаёт precedence inherited environment: root `env: PATH` не гарантирует добавление `bin` к уже существующему process PATH ([официальный contract](https://taskfile.dev/docs/guide/environment/)). Поэтому local tool references заданы явно, а generation helper получает `bin` через command-local PATH.

Go unit tests сами по себе не доказывают работу storage/runtime. Для integration evidence нужен отдельный стенд и явный setup изменяемого модуля; если соответствующего suite ещё нет, фиксировать этот gap. `pass` с пропущенной integration-веткой не означает, что storage проверен. Evidence каждого прогона должен содержать checkout/HEAD, команду, версии инструментов, runtime/env profile без секретов, exit code и список skipped checks.

## Совместная работа агентов

Пять логических направлений: координатор и Product/Architecture, SDE, Frontend/RTC, SRE/DevOps, Harness/Cleaner. Это роли, а не требование одновременно запустить пять агентов: число активных исполнителей ограничено доступными runtime slots. Специалистов подключать к конкретным вопросам; координатор сверяет выводы и формирует одну очередь задач.

1. Координатор фиксирует scope, исходный HEAD, владельцев файлов, критерии приёмки и список проверок.
2. Для параллельных изменений выделяются отдельные ветки и worktrees. В общем checkout разрешено независимое чтение; source freeze обязателен во время итогового прогона.
3. Один назначенный владелец управляет общим runtime: compose, портами, тестовой БД и browser fixtures. Остальные запрашивают у него состояние и результаты.
4. Тяжёлые checks используют один общий lock/resource для этого стенда; путь lock и scope передаются в каждую делегацию. Логи и временные данные хранятся вне Git, например в `~/.local/state/agent-dev`.
5. После объединения изменений выполняется один согласованный итоговый прогон при замороженных исходниках. После него новые edits требуют повторения затронутых проверок; копировать старый pass на новый HEAD нельзя.
6. Findings дедуплицируются по причине и подтверждаются evidence. Каждая issue ведёт к узкому завершённому PR, а не к одновременному redesign auth, crypto, storage, RTC и shell.

Для личной инфраструктуры сначала читать `/Users/yuzuru/AGENTS.md` и его navigator; при local Docker discovery, runtime version mismatch или конкурирующих/пропущенных checks применять `workstation-dev`. По умолчанию проверяется текущая машина. SSH/VPN/другие хосты входят в scope только по явному заданию.

## Server runtime и публикация

[Bootstrap](deploy/single-server-bootstrap.md) описывает `.env.server`, `.env.server.secrets`, shared `k3s + Traefik`, media origin и repo-managed TURN. [Rollout](deploy/production-rollout.md) содержит production health gates и rollback; это отдельная операционная процедура.

Application images публикуются в GHCR для `web`, `aero-gateway`, `aero-identity`, `aero-chat`, `aero-rtc-control` на `linux/amd64`. Для точного выбора сборки использовать `sha-<commit>`; `edge` следует default branch, release-теги имеют вид `vX.Y.Z`, `vX.Y`, `vX`. `latest` не используется. В `.env.server` выбирается `AERO_IMAGE_TAG`; секреты хранятся только в `.env.server.secrets`.
