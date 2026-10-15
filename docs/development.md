# Разработка AeroChat

Правила изменений находятся в [AGENTS.md](../AGENTS.md), карта контекста — в [навигаторе](README.md). Команды ниже сверены с [Taskfile](../Taskfile.yml), [web package](../apps/web/package.json) и [CI](../.github/workflows/ci.yml); фактические результаты проверок фиксируются отдельно в [аудите](audits/2026-10-11-readiness.md).

## Инструменты

- Git, Go **1.27.2** по `go.work` / `infra/go-toolchain.json`, Node.js **22** по CI, pnpm **10.19.0** по `package.json`. Для source checks задать `GOTOOLCHAIN=go1.27.2`; глобальные Go настройки менять не требуется.
- Docker Engine / Docker Compose для полного локального стенда.
- Task, Buf, sqlc, golangci-lint и govulncheck устанавливаются `infra/scripts/install-dev-tools.sh` в `bin`. Go/linter/scanner pins — `infra/go-toolchain.json`; Buf/Task/sqlc pins сохраняются в installer. Task leaf-команды используют exact `bin` paths; `task check` не требует ручного изменения PATH для Buf/sqlc/linter. Для прямого вызова этих CLI: `export PATH="$PWD/bin:$PATH"`.

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

MinIO и bootstrap client собираются из pinned upstream sources по [ADR-087](adr/087-pinned-storage-source-build-lifecycle.md), включая checksum архивов и base image digests. Первый запуск скачивает Go modules и компилирует storage; старые binary image tags не используются. Для проверки acquisition без shared build cache создать отдельный BuildKit builder (`docker buildx create --driver docker-container --name <unique-name>`) и выполнить `docker buildx build --builder <unique-name> --pull --no-cache --load --target minio -t aerochat-minio:7ced9663-maintenance-2ad58d880c49 -f infra/storage/Dockerfile .`, затем аналогично target `mc` с tag `aerochat-mc:7394ce0d-maintenance-2ad58d880c49`. Не удалять чужие builders, caches и volumes. Обычный повторный `compose up --build` сам по себе не доказывает cold-cache bootstrap.

По [ADR-093](adr/093-full-readiness-storage-and-downstream-propagation.md), `/healthz` проверяет процесс, `/readyz` — full dependencies. Chat дополнительно выполняет read-only S3 bucket check под service credentials, gateway читает downstream `/readyz`. Missing/denied/unreachable storage даёт chat/gateway/edge 503 при доступном process health; восстановление storage возвращает 200 без перезапуска. RPC Ping остаётся transport diagnostics и не доказывает readiness. S3 и gateway network probe budget — 3 секунды либо более ранний caller deadline. Metadata readiness не заменяет authenticated write/read/private-policy smoke.

| Конфигурация | Назначение и ограничение |
| --- | --- |
| `AERO_MEDIA_S3_INTERNAL_ENDPOINT`, `AERO_MEDIA_S3_PRESIGN_ENDPOINT` (source-mode); `MEDIA_S3_PUBLIC_ENDPOINT` (compose) | Внутренний service-to-storage endpoint и отдельный browser-visible endpoint для presigned URL; браузеру нельзя отдавать compose-host `minio:9000`. |
| `MEDIA_S3_CORS_ALLOWED_ORIGINS` | Origins для browser upload; локальный compose применяет CORS и bootstrap приватного bucket. |
| `AERO_MEDIA_USER_QUOTA_BYTES` | Per-user budget по backend attachment state; `detached`, `expired`, `deleted` не удерживают активный budget. |
| `AERO_MEDIA_DETACHED_ATTACHMENT_RETENTION` | Grace period перед удалением detached objects; source-mode и оба Compose профиля применяют значение, default `168h` (7 дней). Короткий TTL допустим для отдельного disposable fixture; `attached` objects не становятся eligible по возрасту. Правила [ADR-050](adr/050-attachment-retention-delete-semantics-foundation.md) и [ADR-073](adr/073-encrypted-media-retention-and-tombstone-parity.md) сохраняются. |
| `AERO_MAX_ACTIVE_GROUP_MEMBERSHIPS_PER_USER` | Лимит активных membership для create/join; leave/remove освобождают capacity. |
| `AERO_WEB_PUSH_SUBSCRIBER`, `AERO_WEB_PUSH_VAPID_PUBLIC_KEY`, `AERO_WEB_PUSH_VAPID_PRIVATE_KEY` | Полный VAPID-блок нужен для background push; частичная конфигурация считается ошибкой старта, пустая отключает push. |

Push требует secure context: `localhost` или HTTPS-origin для внешнего домена/телефона. UI-тогглы сами по себе не доказывают доставку. Секреты остаются в локальных env-файлах и не входят в Git или отчёты.

Регион media bucket определяется SDK через `AERO_MEDIA_S3_INTERNAL_ENDPOINT` при первом presign и сохраняется в клиенте подписи. У storage principal должно быть право `s3:GetBucketLocation`; пустой location S3 соответствует `us-east-1`. Browser-visible endpoint используется только для URL и подписи, без исходящих запросов к нему из `aero-chat`. После переноса bucket в другой регион сервис нужно перезапустить. При ошибке internal discovery URL не выдаётся; следующий запрос повторяет discovery. Подписи upload/download проверяются отдельно от доступности публичного storage origin в браузере.

Native media integration `go -C services/aero-chat test -tags integration ./internal/storage/minio ./internal/storage/postgres` требует `AERO_MEDIA_TEST_ENV_FILE` вне Git с ключами `AERO_MEDIA_S3_*` и `AERO_DATABASE_URL`. S3 принимает loopback endpoints с разными internal/public именами; PostgreSQL использует только dedicated `aerochat_media_test` и собственные disposable schemas. Fixture пишет небольшие объекты и удаляет свои keys. Отсутствующий профиль завершает проверку ошибкой, а не skip. Проверки охватывают POST policy, conditional staging→final copy, concurrent Complete и metadata rollback; browser decrypt остаётся отдельной приёмкой. [Cutover, legacy backfill, cleanup и rollback](deploy/immutable-media-cutover.md) описывают coordinated POST rollout и требования lifecycle/versioning/CORS.

Encrypted server ordering по [ADR-096](adr/096-encrypted-conversation-server-sequence.md) использует тот же PostgreSQL profile только для собственных disposable schemas. `go test -count=1 -tags integration -run TestEncrypted ./services/aero-chat/internal/storage/postgres` проверяет sender clock/read cutoff, commit serialization, cancellation, duplicate/overflow и bounded metadata backfill; S3 эти tests не трогают. [Sequence cutover](deploy/encrypted-sequence-cutover.md) требует остановки старых writers, verified backup/restore и opt-in CLI до запуска нового chat service на legacy data. Web adoption и full two-account browser acceptance фиксируются отдельно.

Web Push endpoints ограничены [ADR-095](adr/095-web-push-egress-boundary.md): HTTPS/443, `fcm.googleapis.com`, `updates.push.services.mozilla.com` и непустые subdomains `*.push.apple.com`. Sender повторно проверяет старые subscriptions, весь DNS answer и числовой dial; proxy environment и redirects отключены. Custom push providers пока не поддерживаются. Request budget 5s, DNS/dial/TLS/header 2s, весь sequential batch 10s. Private/mixed DNS, TLS и timeout не удаляют допустимый subscription; HTTP 404/410 и структурно запрещённый URL — invalid. Локальные fixtures подтверждают transport boundary, не actual browser/OS delivery.

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
| Go pins / actual toolchain | `python3 -B infra/scripts/go_lifecycle.py check --runtime` |
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

Для регрессии автоматического чтения: `node apps/web/tests/read/read-effects.mjs`. Передать `PLAYWRIGHT_MODULE` (путь к установленному Playwright) и `CHROMIUM_EXECUTABLE` (путь к Chromium); fixture использует только свой Vite на `127.0.0.1:25174` (`READ_FIXTURE_PORT` позволяет сменить порт). Он исполняет исходные React read effects для direct/self и group с синтетическим gateway. Проверяются minimize/restore, скрытая вкладка и информация группы; это не замена приёмке с двумя аккаунтами. `READ_EFFECT_SOURCE_ROOT` задаёт другой `apps/web/` для воспроизведения исходного дефекта без редактирования checkout.

Для регрессии direct composer: `node apps/web/tests/composer/composer.mjs` с `PLAYWRIGHT_MODULE` и `CHROMIUM_EXECUTABLE`. Собственный Vite использует `127.0.0.1:25174` (`COMPOSER_FIXTURE_PORT` меняет порт); параллельно с другими fixtures этот порт не занимать. Проверяются исходные React send/Enter/change/edit/cancel handlers: задержка, повторный вход, ошибка/повтор, отмена, смена переписки/reply, повторный выбор редактирования с теми же ID и ошибка старой переписки. Crypto action синтетический: ciphertext и network этим тестом не подтверждаются. `COMPOSER_SOURCE_ROOT` позволяет выполнить те же assertions на другом `apps/web/` без его редактирования.

Пять логических направлений: координатор и Product/Architecture, SDE, Frontend/RTC, SRE/DevOps, Harness/Cleaner. Это роли, а не требование одновременно запустить пять агентов: число активных исполнителей ограничено доступными runtime slots. Специалистов подключать к конкретным вопросам; координатор сверяет выводы и формирует одну очередь задач.

1. Координатор фиксирует scope, исходный HEAD, владельцев файлов, критерии приёмки и список проверок.
2. Для параллельных изменений выделяются отдельные ветки и worktrees. В общем checkout разрешено независимое чтение; source freeze обязателен во время итогового прогона.
3. Один назначенный владелец управляет общим runtime: compose, портами, тестовой БД и browser fixtures. Остальные запрашивают у него состояние и результаты.
4. Тяжёлые checks используют один общий lock/resource для этого стенда; путь lock и scope передаются в каждую делегацию. Логи и временные данные хранятся вне Git, например в `~/.local/state/agent-dev`.
5. После объединения изменений выполняется один согласованный итоговый прогон при замороженных исходниках. После него новые edits требуют повторения затронутых проверок; копировать старый pass на новый HEAD нельзя.
6. Findings дедуплицируются по причине и подтверждаются evidence. Каждая issue ведёт к узкому завершённому PR, а не к одновременному redesign auth, crypto, storage, RTC и shell.

Для личной инфраструктуры сначала читать `/Users/yuzuru/AGENTS.md` и его navigator; при local Docker discovery, runtime version mismatch или конкурирующих/пропущенных checks применять `workstation-dev`. По умолчанию проверяется текущая машина. SSH/VPN/другие хосты входят в scope только по явному заданию.

### Lazy UI regression

`app-routes` содержит только metadata/path builders; содержимое приложений находится в `app-content`. Lazy declarations стабильны вне render. Retry создаёт новый loader только для неудавшегося экземпляра и получает compiled URL из allowlisted `build/lazy-module-urls.mjs`. Одного сброса [React lazy](https://react.dev/reference/react/lazy) недостаточно: браузер может кешировать отказ dynamic import по URL. Для descriptor доступны три свежих query URL за lifetime страницы, shared pending retry и cache только полной успешной загрузки. Общие auth/crypto/notifications/RTC providers остаются в bootstrap.

Сборка выпускает `assets/*.js.resources.json` с проверяемым expected module и static CSS closure. Эти файлы обязательны вместе с JS/CSS; текущая упаковка копирует весь `dist`. Клиент запрашивает sidecar только при ручном retry, ограничивает его 16 KiB/64 stylesheet paths, проверяет same-origin/asset directory/redirect и ждёт CSS load. Повторно используется только stylesheet с подтверждённым собственным `load`, поэтому первоначально успешный Vite CSS при первом retry может скачаться ещё раз. Наличие `link.sheet` не заменяет подтверждение сетевой загрузки. Ошибка вложенной static JS dependency, отсутствующий sidecar и исчерпание попыток оставляют inline error; автоматической перезагрузки и переписывания shared imports нет. Plugin использует metadata и hook ordering Vite **7.3.1** из frozen lock, проверяет их наличие при build; см. ADR005 и versioned primary source links.

`apps/web/tests/lazy/lazy.mjs` собирает production AppRouter, shell и реальные People/Explorer pages в chunks. Playwright прерывает настоящий запрос JS chunk и CSS, проверяет retry, соседнее поле ввода, быстрые повторные нажатия, одновременные failed instances, close/reopen identity, lifetime exhaustion и закрытие окна до позднего завершения загрузки. Неверный module path, oversized JSON, внешний CSS и sidecar redirect проверяются реальными bounded HTTP responses. Счётчики evaluation shared React/provider modules и fixture root дополняют анализ единственности emitted module identity; они не доказывают actual auth/crypto provider lifecycle. Перед запуском задаются `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE` и внешний собственный `LAZY_BUILD_DIR`; Vite build не очищает этот каталог. Fixture использует bounded localhost25174 и закрывает browser/server в finally. Auth/gateway/RTC/realtime здесь синтетические; actual accounts, общий crypto bootstrap и real-device поведение эта проверка не подтверждает.

### Router maintenance

React Router остаётся в Declarative/BrowserRouter Mode. При обновлении maintained
7.x проверять official release notes и registry metadata выбранной версии,
обновлять lockfile через pnpm10.19.0 и сохранять raw production audit вне Git.
Для каждой advisory отдельно фиксировать reachable/unreachable и необходимые
предпосылки по code trace; Framework-only advisory нельзя выдавать за доказанный
RCE static SPA. Текущий [review #175](audits/2026-10-11-router-advisories.md)
явно различает подготовку, выполненные gates и оставшиеся проверки.

`apps/web/tests/router/router.mjs` использует actual AppRouter/DesktopShell и
window-scoped location/path builders для deep-link/refresh, back/forward,
повторного открытия conversation singleton и encoded query IDs. Auth/gateway/
RTC/realtime и тела страниц здесь синтетические, поэтому это не message-page или
backend acceptance. Перед запуском задать `PLAYWRIGHT_MODULE` и
`CHROMIUM_EXECUTABLE`; fixture использует bounded localhost25174 и освобождает
browser/server в finally. Source наличие fixture само по себе не означает PASS.

## Server runtime и публикация

[Bootstrap](deploy/single-server-bootstrap.md) описывает `.env.server`, `.env.server.secrets`, shared `k3s + Traefik`, media origin и repo-managed TURN. [Rollout](deploy/production-rollout.md) содержит production health gates и rollback; это отдельная операционная процедура.

Application images для пяти services проходят reusable CI на точном SHA, затем публикуются в GHCR для `linux/amd64` как один [verified release](deploy/verified-release.md): immutable manifest digest + source SHA + пять image digests. Production workflow выбирает `release_digest` и `source_sha`; application `edge`/semver tags больше не продвигаются. Секреты остаются в `.env.server.secrets`; `.env.server` сохраняет выбранную пару `AERO_RELEASE_DIGEST` / `AERO_RELEASE_SOURCE_SHA` после успешных gates.

## Клиентский порядок encrypted conversations

Encrypted web после ADR-096 требует серверный `serverSequence` как положительную decimal int64 строку; read position использует `lastReadServerSequence`. Sender `createdAt` остаётся display/AAD metadata. HTTP без корректного порядка показывает ошибку, некорректные realtime events не применяются. Обновление backend и web согласуется при cutover; старый backend без sequence с новым web несовместим. Переиндексация локального поиска меняет только memory cache, сохраняя pending outbound и локальный ключевой материал.

Accepted timestamp clarification в [ADR-063](adr/063-web-encrypted-direct-message-v2-outbound-bootstrap-send-foundation.md#уточнение-12-октября-2026-совместимость-timestamp-в-aad) и [ADR-068](adr/068-web-encrypted-group-outbound-text-bootstrap.md#уточнение-12-октября-2026-совместимость-timestamp-в-aad) допускает после raw `OperationError` только один distinct same-instant UTC ISO-ms3 candidate. Raw AAD остаётся первым; nonzero sub-millisecond digits не округляются, а оба group authentication layers используют один candidate. Решение принято до реализации: codec/transport regressions, fresh web gates и новый actual browser core/media run ещё требуются. Historical core04 FAIL и отдельный actual two-account timestamp witness сохраняются как разные результаты.

Local content projection хранит origin `serverSequence` для history/read и `lastAppliedServerSequence` для convergence. Accepted operation sequence определяет выбранную mutation; `revision` остаётся ciphertext metadata и не считается backend CAS. Reverse/split realtime, fetch и send result должны давать одну projection даже при одинаковых или уменьшающихся revisions.

Terminal tombstone остаётся terminal по ADR-069: независимые локальные `lastEditServerSequence` и `tombstoneServerSequence` делают edit/delete arrival-order независимым. Late old edit или accepted edit после удаления не возвращает body/attachments; display metadata последнего edit и delete выбирается по sequence каждой категории. Group partial edit с `attachments: null` сохраняет последнее explicit attachment значение через локальный `lastAttachmentsServerSequence`. Эти поля не передаются в ciphertext/AAD или API.

Если mutation расшифрована до origin content, projection показывает `unresolved_target`, а текущая lane хранит pending payload только в памяти (min(valid page size, 64)). Поздний content запускает повтор соответствующих operations; applied/duplicate payload удаляется, scope change/unmount очищает pending. Overflow не скрывает unresolved failure. При reopen/reload или crypto-device rebind/reconnect hook объединяет fetch и scoped opaque realtime buffer (64 events), сортирует по sequence. Без concurrent updates snapshot заменяется; при concurrent updates он объединяется только с тем же requestKey, а request generation отсекает старые загрузки. Recovery вне окна зависит от наличия origin/mutation в bounded fetch/buffer; full historical backfill этим не реализован.
Для проверки boot/chooser: `node apps/web/tests/entry/entry.mjs` с `PLAYWRIGHT_MODULE` и `CHROMIUM_EXECUTABLE`, через общий heavy runner. Fixture использует Vite `127.0.0.1:25174` (`ENTRY_FIXTURE_PORT` меняет порт): first-run login/register, login error, daily valid-session и explicit reboot на desktop/mobile. Production AppRouter/AuthPage/entry state исполняются напрямую; auth context и post-auth shell синтетические, backend login и полный workspace не подтверждаются. `ENTRY_SOURCE_ROOT` задаёт другой `apps/web/` для baseline без изменения его файлов.

## Мобильная геометрия conversation

Mobile LegacyAppShell ограничен `100dvh`: header/call strip/navigation занимают свои grid rows, а content имеет `min-height:0`. Выбранная self/direct/group conversation занимает оставшееся пространство; history scroll не двигает composer и navigation. При ширине ниже desktop breakpoint 1180px layout скрывает неактивный список/повторный заголовок panel, сохраняя back/refresh actions; узкий composer выделяет textarea отдельную строку, короткий landscape возвращает одну строку действий. В коротком landscape скрываются только декоративные status spans, а call/back buttons остаются видимыми и доступными с клавиатуры. Active call strip в выбранной conversation компактен: имя звонка и actions видимы, подробный текст не отнимает место у history. Reply/attachment/error composer ограничен половиной viewport и имеет собственный scroll; info pane скроллится отдельно.

Accepted уточнение [ADR-083](adr/083-mobile-practical-shell-adaptation.md#уточнение-13-октября-2026-pinned-summary-и-бюджет-composer-accepted): mobile direct/self pinned summary имеет bounded presentation и не вытесняет полезную history48px или целиком видимый textarea140×39px. Composer учитывает фактическую высоту textarea в пределах текущего max-height и свой padding; pin ordinal/navigation остаются доступны с Tab, preview/metadata сохраняют доступный текст/переход. Actual diagnostic07 на3f63 подтвердил clipping при pinned auto row; историческая geometry fixture без pinned DOM этот случай не покрывала. Следующий `node apps/web/tests/mobile/pinned.mjs` использует faithful pinned/tombstone DOM и synthetic auth/RTC; source наличие теста не означает PASS, реальные message-page/device пункты подтверждаются отдельно.

Для pinned fixture задать `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, `PINNED_LAYOUT_ARTIFACT_DIR` (новый абсолютный каталог вне Git с mode0700) и `PINNED_LAYOUT_JUNIT` (новый абсолютный XML внутри этого каталога). `PINNED_LAYOUT_SOURCE_ROOT` при необходимости указывает на проверяемый `apps/web/`; `PINNED_LAYOUT_FIXTURE_PORT` меняет исходный localhost25174. Запускать под Node22 после frozen offline pnpm10 install через согласованный `agent-dev` heavy gate; один owner обеспечивает отсутствие конкурирующего fixture/server. Сохраняются actual семь case outcomes, XML без skips, source hashes, private CFT profile/executable/PID ledger и подтверждение закрытия owned PID/PG/profile/port; RED exit не превращается в PASS.

Отдельный `node apps/web/tests/mobile-landscape/landscape.mjs` проверяет один direct/tombstone trajectory320→390→768→568 на той же странице с real production SVG и stimulus fill→две animation frames→focus. Он использует те же `PINNED_LAYOUT_*`/browser переменные и owned lifecycle, сохраняет geometry до фиксированного failedPredicate и actual XML одного случая без skips; прежние семь pinned и147 mobile cases не заменяет. В коротком pinned landscape pin имеет собственный bounded scroll, а history48px/composer50px и минимальные размеры controls сохраняются. Synthetic regression не подтверждает причину native failure без свежей actual message-page проверки.

Отдельный `node apps/web/tests/group-composer/group-composer.mjs` проверяет simultaneous reply, uploaded attachment и длинную ошибку отправки в group composer при переходе320×568→568×320. Используются production Group CSS/DOM order/SVG/LegacyAppShell; auth/RTC/attachment preparation и отказ отправки синтетические. Старые семь pinned и147 mobile случаев не меняются. Запуск — с теми же `PINNED_LAYOUT_*`, Node22, offline pnpm10.19 и новым private CFT profile/JUnit через согласованный heavy runner; baseline PASS не превращается в FAIL. Сохраняются geometry до assertions, реальные140/39/48/32 minima, draft/reply/file, natural Tab и независимый after-exit owned PID/PG/profile-process/port readback. OS keyboard/native zoom/actual backend этот fixture не подтверждает.


Geometry regression использует настоящий LegacyAppShell и production conversation CSS с representative DOM, synthetic auth/RTC. Проверяются 320/390/768 portrait и landscape, 0/2/50 rows, active call strip, keyboard/draft/info/scroll и textarea не уже 140 CSS px, минимум 48 CSS px полезной истории без padding и отсутствие перекрытия composer. В коротком viewport composer получает минимум 50 CSS px; кнопки не меньше 32 CSS px полностью видимы после обычного Tab-фокуса и programmatic scroll reveal. Это не тест touch-жестов. Дополнительный CSS viewport640×360 моделирует layout при 200% zoom desktop1280×720; это не native browser zoom. Полные actual pages на integration HEAD, iOS/Android OS keyboard, touch-жесты и hardware safe area остаются отдельной наблюдаемой приёмкой.

Send feedback выбранного direct/self thread размещается внутри собственного scroll composer, отдельно от скрываемого mobile overview. Длинный alert ограничен собственной высотой и доступен через Tab; reveal меняет только composer scroll, сохраняя draft/focus/history. `apps/web/tests/composer-feedback/feedback.mjs` связывает regression с production JSX-site/компонентом и точными send/change handlers, использует настоящий LegacyAppShell/CSS и synthetic HTTP503 adapter. Это дополняет geometry fixture; реальный отказ gateway в полной message page проверяется в отдельном owned runtime.


## Local call-capture owner: подготовленный browser regression

`apps/web/tests/rtc/owner.mjs` проверяет actual direct hook/local slot на React с
bounded synthetic media/PC/RPC и новым private external `LOCAL_CALL_OWNER_ARTIFACT_DIR`.
Запуск: `agent-dev run --cwd "$PWD" --node 22 --resource heavy -- node apps/web/tests/rtc/owner.mjs`,
с согласованным `RTC_FIXTURE_PORT` и внешними Playwright/Chromium paths из RTC README.
Контракт [call-only owner](product/local-call-capture-owner-plan.md) не включает notes,
не заменяет backend admission/ACK и не подтверждает SDK/group audio или physical devices.
Новый source gate/receipt обязателен; preparation не является выполненным PASS.


## Sender projection: подготовленная регрессия lifetime context

`node apps/web/tests/sender-projection/sender-projection.mjs` требует `PLAYWRIGHT_MODULE` и `CHROMIUM_EXECUTABLE`; `SENDER_PROJECTION_SOURCE_ROOT` выбирает исходный `apps/web/` для RED/исправленного GREEN без редактирования другого checkout. Фикстура использует только собственный Vite `127.0.0.1:25174` (`SENDER_PROJECTION_FIXTURE_PORT` меняет порт), настоящий production hook/outbound buffer/merge и synthetic gateway/deferred decrypt adapter. Проверяются pending-state context identity, поздний HTTP local publish, authoritative ready/failure и отмена при смене scope; текущие исходники SHA читаются до/после. `SENDER_PROJECTION_JUNIT` задаёт новый абсолютный XML файл с actual семью cases и zero skips. Это не actual backend/WebCrypto или whole browser core PASS; такая приёмка проводится отдельно. Source наличие fixture не означает PASS.

Sender projection fixture требует `SENDER_PROJECTION_ARTIFACT_DIR`: новый собственный canonical абсолютный каталог0700 вне Git. До запуска CFT записываются private `ownership.json` с точным profile/executableSHA; после запуска — PID/PGID/start time. TERM/INT сразу закрывает только свежие процессы с этим profile. После выхода runtime owner независимо подтверждает отсутствие owned profile/PID/PGID и освобождение fixture port; нормальный finally не заменяет этот readback. Фазы/counters FAIL не содержат token, key material или payload.


## Group sender projection: подготовленная отдельная регрессия

`node apps/web/tests/group-sender-projection/group-sender-projection.mjs` требует `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE` и `GROUP_SENDER_PROJECTION_ARTIFACT_DIR` (новый canonical каталог0700 вне Git). `GROUP_SENDER_PROJECTION_SOURCE_ROOT` выбирает `apps/web/` для RED/GREEN; `GROUP_SENDER_PROJECTION_FIXTURE_PORT` меняет собственный Vite25174; `GROUP_SENDER_PROJECTION_JUNIT` задаёт новый absolute XML с семью actual cases/zero skips. Исполняются настоящий group hook/bootstrap/list pipeline, buffer/merge с synthetic gateway и deferred decrypt. Bootstrap/list counters и binding группы отличают semantic failure от сломанного fixture; failedPhase/counters не содержат payload/token/key. Private prelaunch executableSHA/profile и PID/PGID ledger требуют independent owner after-exit readback, как direct fixture. Ни direct7 PASS, ни наличие source не являются group PASS; crypto/backend/whole core/group audio проверяются отдельно.
