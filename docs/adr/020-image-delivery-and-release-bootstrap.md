# ADR-020: Image delivery и release bootstrap для single-server self-host

- Статус: Accepted
- Дата: 2026-03-29

## Контекст

После завершения deploy foundation для single-server self-host проекту нужен следующий изолированный platform slice:
минимальная, production-oriented база для доставки версионированных контейнерных образов и ручного выбора release на
одном VPS.

Этот этап должен:

- публиковать готовые образы для текущего внешне используемого stack;
- сохранить явное разделение между `local/dev` и `server/prod-like`;
- убрать необходимость собирать application images прямо на VPS;
- дать оператору простой и воспроизводимый способ указать server compose нужный release tag;
- не тянуть SSH automation, реальные production secrets и реальный rollout workflow.

Также важно не нарушить уже принятые ограничения:

- single-server self-host модель из ADR-001 и ADR-019 сохраняется;
- `aero-gateway` остаётся единственной внешней backend edge-точкой;
- service ownership boundaries не меняются;
- deploy work не превращается в redesign архитектуры, auth, crypto или frontend shell;
- local/dev compose продолжает оставаться source-oriented и удобным для разработки.

## Решение

### 1. Registry model

На этом этапе основным registry target фиксируется **GHCR**.

Причины:

- GHCR уже соответствует общему направлению репозитория;
- публикация может использовать стандартный `GITHUB_TOKEN` без отдельных секретов;
- образы естественно связываются с GitHub-репозиторием и release flow.

Реальные внешние registry credentials в этот slice не добавляются.

### 2. Scope публикуемых образов

Публикуются только образы сервисов, которые нужны для текущего externally usable stack:

- `web`
- `aero-gateway`
- `aero-identity`
- `aero-chat`
- `aero-rtc-control`

`aero-jobs` в этот release bootstrap не входит, потому что он пока не обязателен для текущего
single-server runtime.

### 3. Image naming

Для каждого сервиса публикуется отдельный образ в плоском и репозиторно-узнаваемом виде:

- `ghcr.io/<owner>/aerochat-web`
- `ghcr.io/<owner>/aerochat-aero-gateway`
- `ghcr.io/<owner>/aerochat-aero-identity`
- `ghcr.io/<owner>/aerochat-aero-chat`
- `ghcr.io/<owner>/aerochat-aero-rtc-control`

Такое именование выбрано как минимальное и явное:

- образы легко сопоставляются с репозиторием;
- оператору не нужно разбираться в сложной вложенной naming-схеме;
- fork или mirror может заменить только namespace, не меняя сами service names.

### 4. Tagging и versioning policy

Фиксируется следующая стратегия тегов:

1. push в default branch публикует:
   - `edge`
   - `sha-<commit>`

2. git tag вида `vX.Y.Z` публикует:
   - `vX.Y.Z`
   - `vX.Y`
   - `vX`
   - `sha-<commit>`

`latest` намеренно не используется.

Причины:

- оператор явно выбирает release tag, а не неявный moving target;
- `edge` остаётся удобным каналом для smoke/self-host testing;
- `sha-*` даёт точную привязку к конкретной сборке для диагностики и отката.

### 5. Build/publish workflow boundaries

GitHub Actions на этом этапе отвечает только за:

- сборку образов;
- проставление version tags и OCI metadata;
- публикацию в GHCR.

GitHub Actions на этом этапе **не** отвечает за:

- SSH доступ к серверу;
- обновление VPS;
- выполнение `docker compose pull` или `up`;
- rollout orchestration;
- post-deploy smoke tests на удалённом окружении.

На этом этапе publish workflow собирает application images только для `linux/amd64`.

### 6. Server compose consumption model

`server/prod-like` compose перестаёт использовать локальные `build` contexts для application services и начинает
потреблять registry images.

Операторский contract остаётся минимальным:

- `AERO_IMAGE_NAMESPACE` задаёт registry namespace;
- `AERO_IMAGE_TAG` задаёт общий release tag для application services.

Обычный сценарий:

- для тестового канала используется `edge`;
- для фиксированного release используется `vX.Y.Z`.

Это выбрано как минимальная и достаточно явная модель для одного VPS без сложного image-override matrix.

### 7. Разделение local/dev и server/prod-like

После этого изменения режимы фиксируются ещё жёстче:

1. `local/dev`
   - остаётся на `build` из исходников;
   - продолжает использовать `infra/compose/docker-compose.yml`;
   - подходит для разработки и локального smoke runtime.

2. `server/prod-like`
   - использует только предсобранные registry images;
   - продолжает использовать `infra/compose/docker-compose.server.yml`;
   - не требует application build на VPS.

Это намеренное разделение, а не временный компромисс.

### 8. Web image contract

Release image для `web` собирается с `VITE_GATEWAY_BASE_URL=/api`.

Это соответствует уже принятой single-server topology, где:

- `nginx` остаётся единственным внешним HTTP edge;
- frontend ходит в backend только через `/api`;
- оператору не нужно отдельно перенастраивать downstream URLs внутри browser bundle.

Если в будущем понадобится иная edge-схема для внешнего хостинга web-клиента, для этого потребуется отдельное решение.

### 9. Platform scope limits

На этом этапе не внедряются:

- multi-arch image matrix;
- private registry mirroring automation;
- cosign/signature workflow;
- SBOM/provenance policy как обязательный release gate;
- GitHub Release automation;
- rollback orchestration;
- secrets management beyond стандартного `GITHUB_TOKEN`.

## Последствия

### Положительные

- VPS перестаёт зависеть от локальной сборки application images.
- Появляется воспроизводимая и явная version-tag модель для server runtime.
- GHCR-based delivery закрывает отложенный кусок deploy foundation без преждевременного CI/CD rollout.
- Local/dev и server/prod-like сценарии становятся более понятными и операционно разделёнными.

### Отрицательные

- На этом этапе серверное обновление остаётся ручным.
- `edge` является mutable tag и подходит только для тестового канала, а не для строгого release management.
- Multi-arch, signing и deploy automation остаются отдельными будущими задачами.

### Ограничения

- Нельзя считать этот slice полноценным production rollout workflow.
- Нельзя добавлять SSH automation или server mutation steps в publish workflow.
- Нельзя возвращать server compose к неявной сборке приложений на VPS.
- Нельзя подменять release policy тегом `latest`.

## Альтернативы

### 1. Продолжать собирать application images прямо на VPS

Не выбрано, потому что это ухудшает воспроизводимость, замедляет обновление и смешивает server runtime с build
responsibility.

### 2. Сразу делать полный deploy workflow через GitHub Actions и SSH

Не выбрано, потому что это расширяет scope slice и смешивает image delivery с реальным rollout automation.

### 3. Использовать только commit SHA без semver release tags

Не выбрано, потому что оператору нужен человекочитаемый стабильный release marker, а не только низкоуровневый build id.
