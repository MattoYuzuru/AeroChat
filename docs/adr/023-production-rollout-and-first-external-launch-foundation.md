# ADR-023: Production rollout automation и first external launch foundation

- Статус: Accepted
- Дата: 2026-04-01

## Контекст

После завершения single-server TLS / domain / edge bootstrap у проекта уже есть:

- production-oriented single-server topology на одном VPS;
- GHCR-based image delivery c tag-driven release selection;
- двухфайловая server env-модель;
- ручной operator flow для bootstrap, update и rollback;
- domain-ready HTTP/HTTPS edge path через `nginx`.

Остаётся последний изолированный operational slice перед первым реальным внешним запуском:
минимальная, production-oriented автоматизация rollout на один VPS и явный runbook для first external launch.

Этот этап должен:

- добавить ручной production deploy workflow через GitHub Actions;
- использовать GitHub Environment `production` как единственную точку scoping и protection rules;
- выполнять rollout по SSH без хранения боевых секретов в репозитории;
- сохранить уже принятую tag-driven release модель через `AERO_IMAGE_TAG`;
- зафиксировать first launch, verification и rollback как явный операторский contract;
- не менять single-server topology и не превращать этот PR в полноценную orchestration-платформу.

Также важно не нарушить уже принятые ограничения:

- single-server self-host модель из ADR-001, ADR-019, ADR-020, ADR-021 и ADR-022 остаётся основной;
- `nginx` остаётся единственным внешним edge, а `aero-gateway` единственной backend edge-точкой;
- rollout не должен требовать real secrets в Git;
- update должен оставаться явным, ручным и tag-driven;
- этот этап не должен тянуть auto-promote, multi-host deployment, ACME automation, backup orchestration и zero-downtime redesign.

## Решение

### 1. Trigger model

Production rollout выполняется только через отдельный GitHub Actions workflow с `workflow_dispatch`.

Причины:

- production deploy остаётся явным ручным действием оператора;
- первый внешний запуск не смешивается с publish workflow и не запускается автоматически после сборки образов;
- оператор явно выбирает целевой `image_tag` перед rollout.

Workflow использует:

- один job;
- `environment: production`;
- последовательный rollout через `concurrency`, чтобы не было двух параллельных деплоев на один VPS.

### 2. GitHub Environment contract

GitHub Environment `production` становится единственной точкой для production-scoped deploy metadata.

В environment secrets хранятся только SSH connection values:

- `AERO_PROD_SSH_HOST`
- `AERO_PROD_SSH_PORT`
- `AERO_PROD_SSH_USER`
- `AERO_PROD_SSH_PRIVATE_KEY`
- `AERO_PROD_SSH_KNOWN_HOSTS`

В environment variables хранятся только non-secret rollout parameters:

- `AERO_PROD_DEPLOY_DIR`
- `AERO_PROD_COMPOSE_FILE`
- `AERO_PROD_EDGE_DOMAIN`

Такое разделение выбрано как минимальное и достаточно безопасное:

- connection material не попадает в репозиторий;
- не секретные server paths и domain contract остаются читаемыми и явно документированными;
- environment protection rules можно использовать как release gate без отдельной платформы.

### 3. Remote rollout contract

Workflow не выполняет remote build и не синхронизирует git checkout на сервере.

Remote rollout меняет только уже принятый runtime selector:

- на VPS редактируется только `AERO_IMAGE_TAG` в `.env.server`;
- `.env.server.secrets` не переписывается;
- compose topology и TLS file contract остаются такими же, как уже зафиксировано в предыдущих ADR.

Это означает, что сервер к моменту rollout уже обязан иметь:

- deploy directory с актуальным checkout репозитория;
- `.env.server`;
- `.env.server.secrets`;
- каталог TLS с `fullchain.pem` и `privkey.pem`;
- рабочий `docker compose.server` contract.

Такое ограничение выбрано намеренно: текущий slice автоматизирует только rollout известной topology, а не полное remote provisioning.

### 4. Rollout sequence

Workflow обязан выполнять один и тот же явный операторский цикл:

1. подключиться к VPS по SSH;
2. проверить наличие нужных server-side prerequisites;
3. гарантировать существование deploy directory;
4. обновить `AERO_IMAGE_TAG` в `.env.server`;
5. выполнить `docker compose ... config`;
6. выполнить `docker compose ... pull`;
7. выполнить `docker compose ... up -d`;
8. вывести `docker compose ... ps`;
9. проверить edge health/readiness через HTTP и HTTPS.

Проверки после `up -d` выполняются с retry и должны охватывать:

- `http://127.0.0.1/healthz`
- `http://127.0.0.1/readyz`
- `https://<domain>/healthz` через `--resolve`
- `https://<domain>/readyz` через `--resolve`

Это решение даёт минимальную, но meaningful проверку:

- edge process действительно поднят;
- readiness chain через `gateway` и downstream сервисы готова;
- доменный TLS path соответствует уже принятому single-server contract.

### 5. First external launch contract

Первый внешний запуск должен быть явно описан как отдельный runbook.

Операторский сценарий выглядит так:

1. подготовить VPS по уже существующему bootstrap contract;
2. создать GitHub Environment `production` и заполнить secrets/variables;
3. выбрать initial release tag;
4. вручную запустить production deploy workflow;
5. дождаться успешных edge/readiness checks;
6. выполнить внешний smoke через домен и браузер;
7. зафиксировать предыдущий known-good tag для rollback.

Для первого live run рекомендуется использовать фиксированный release tag `vX.Y.Z`, а не mutable tag `edge`.

### 6. Rollback model

Rollback остаётся намеренно простым:

- оператор повторно запускает тот же manual workflow;
- в качестве `image_tag` указывает предыдущий известный рабочий tag;
- workflow повторяет тот же rollout cycle и те же проверки.

Автоматический rollback при failed deploy не добавляется.

Причины:

- это усложняет semantics текущего slice;
- скрытая automatic mutation ухудшает operator clarity;
- для одного VPS на этом этапе важнее явный и воспроизводимый runbook, чем полуавтоматическая orchestration-магия.

### 7. Scope boundaries

В этот этап не входят:

- автоматический deploy после publish workflow;
- remote `git pull` или checkout commit на VPS;
- zero-downtime orchestration;
- database migration orchestration;
- auto-rollback;
- ACME issuance/renewal automation;
- multi-server или blue-green topology;
- внешний secret manager;
- real production secrets в репозитории.

## Последствия

### Положительные

- Появляется воспроизводимый production rollout path для одного VPS.
- GitHub Environment `production` становится явной точкой protection rules и secret scoping.
- Tag-driven release model получает безопасную удалённую automation без topology drift.
- Первый внешний запуск перестаёт зависеть от неформального ручного SSH runbook.

### Отрицательные

- Rollout всё ещё stateful и привязан к already prepared VPS.
- Обновление checkout на сервере остаётся отдельной ручной обязанностью оператора.
- Автоматического rollback и zero-downtime гарантий на этом этапе нет.

### Ограничения

- Нельзя хранить реальные SSH-ключи, server secrets и certificate material в репозитории.
- Нельзя превращать workflow в полноценный remote provisioning pipeline.
- Нельзя менять topology, публиковать новые внешние ports или обходить `nginx`.
- Нельзя смешивать этот slice с autoscaling, multi-host deployment и новым edge stack.

## Альтернативы

### 1. Оставить production rollout полностью ручным

Не выбрано, потому что первый live run тогда остаётся слишком зависимым от памяти оператора и не получает reproducible deploy gate в GitHub.

### 2. Автоматически деплоить production сразу после publish workflow

Не выбрано, потому что production rollout должен оставаться ручным и явно подтверждаемым, особенно перед первым внешним запуском.

### 3. Одновременно автоматизировать remote git sync, provisioning и rollback

Не выбрано, потому что это расширяет scope за пределы isolated slice и превращает простой single-server rollout в преждевременную orchestration-систему.
