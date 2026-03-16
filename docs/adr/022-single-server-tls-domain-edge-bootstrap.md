# ADR-022: Single-server TLS / domain / edge bootstrap

- Статус: Accepted
- Дата: 2026-03-31

## Контекст

После завершения server secret model и manual operator update flow у проекта уже есть:

- production-oriented single-server compose topology;
- GHCR-based image delivery;
- ручной operator flow для bootstrap, update и rollback;
- `nginx` как единственный внешний HTTP edge и `aero-gateway` как единственная backend edge-точка.

Но текущий foundation ещё не готов к реальному доменному входу на один VPS:

- наружу опубликован только HTTP-порт;
- TLS termination и доменная edge-конфигурация не зафиксированы;
- не определено, как именно сертификаты должны существовать на сервере;
- operator runbook не описывает domain/TLS bootstrap как отдельный понятный слой.

Нужно подготовить production-like edge path для домена вида `aero.example.com`, не выходя за already accepted границы:

- single-server self-host остаётся основной моделью;
- `nginx` остаётся единственным внешним edge;
- `aero-gateway` остаётся единственной backend edge-точкой за `nginx`;
- local/dev flow не должен ломаться;
- этот этап не должен тянуть SSH automation, ACME automation, реальный rollout и новые topology-слои.

## Решение

### 1. Внешняя edge-модель

Для single-server deployment фиксируется одна primary domain-facing edge-точка:

- наружу публикуется только `nginx`;
- `nginx` слушает `80/tcp` и `443/tcp`;
- `80/tcp` используется для внешнего HTTP entry, health/readiness и канонического редиректа на HTTPS;
- `443/tcp` используется для TLS termination и всего обычного пользовательского traffic.

Backend topology не меняется:

- `/` и SPA routes идут в `web`;
- `/api/*` идут только в `aero-gateway`;
- `aero-gateway` остаётся единственной backend edge-точкой;
- `aero-identity` и `aero-chat` не публикуются наружу напрямую.

### 2. Domain model

Single-server runtime получает один явный primary domain через non-secret server env.

Этот домен используется как:

- `server_name` для `nginx`;
- канонический HTTPS redirect target с `http://` на `https://`;
- основной operator contract для внешнего доступа к AeroChat.

Модель нескольких внешних edge-доменов, wildcard-конфигураций и multi-tenant routing в этот этап не входит.

### 3. TLS runtime model

TLS-сертификаты и приватный ключ не хранятся в репозитории и не передаются через env.

Фиксируется файловая модель:

- на VPS существует отдельная директория с TLS-материалами;
- `docker compose.server` монтирует эту директорию в контейнер `nginx` только для чтения;
- внутри директории ожидаются файлы:
  - `fullchain.pem`
  - `privkey.pem`

Репозиторий хранит только:

- compose contract;
- path-level runtime expectation;
- operator documentation;
- env placeholders без реального certificate material.

### 4. Граница ответственности за сертификаты

На этом этапе сертификаты считаются уже подготовленными оператором на VPS до запуска `docker compose up -d`.

Допускаются:

- вручную выданный сертификат;
- сертификат, полученный внешним tooling вне репозитория;
- временный тестовый сертификат для preflight smoke на сервере.

В этот этап не входят:

- ACME issuance;
- renewal automation;
- DNS automation;
- хранение certificate material в Git;
- хранение приватного ключа в env или compose file.

### 5. Health и readiness в domain-facing topology

Health и readiness должны оставаться usable после перехода на HTTP+HTTPS edge.

На этом этапе:

- `/healthz` отвечает сам `nginx`;
- `/readyz` проксируется в `aero-gateway`;
- оба endpoint доступны как по HTTP, так и по HTTPS;
- обычный пользовательский HTTP traffic перенаправляется на HTTPS.

Это даёт две полезные свойства:

- оператор может быстро проверять edge process и readiness chain даже до полного user-facing smoke;
- production path по умолчанию остаётся HTTPS-first.

### 6. Разделение local/dev и server/prod-like

Local/dev flow сохраняется без TLS и без domain requirements:

- `infra/compose/docker-compose.yml` не меняется как primary local runtime;
- локальный `nginx` остаётся HTTP-only;
- server-only TLS/domain contract живёт только в `server/prod-like` слое.

Это намеренное разделение, а не временный компромисс.

### 7. Scope boundaries

В этот этап не входят:

- SSH automation;
- GitHub Actions deploy;
- реальный production rollout на домен;
- ACME/TLS automation;
- topology redesign;
- замена `nginx` на другой edge stack;
- публикация второго внешнего backend edge.

## Последствия

### Положительные

- Single-server runtime становится domain-ready и production-like по edge path.
- Certificate/runtime contract становится явным и понятным оператору.
- `nginx` и `aero-gateway` сохраняют уже принятые роли без topology drift.
- Final rollout PR сможет опираться на готовую HTTP/HTTPS edge-конфигурацию, а не перестраивать её заново.

### Отрицательные

- На этом этапе сертификаты и их обновление остаются ручной обязанностью оператора.
- До отдельного rollout PR доменная часть остаётся подготовленной, но не подтверждённой реальным внешним запуском.
- Оператору нужно аккуратно поддерживать файловые права и наличие TLS-материалов на VPS.

### Ограничения

- Нельзя коммитить реальные сертификаты и приватные ключи.
- Нельзя считать этот slice автоматизацией выпуска или обновления TLS.
- Нельзя публиковать наружу `aero-gateway`, `aero-identity` или `aero-chat` в обход `nginx`.
- Нельзя смешивать этот этап с SSH rollout automation и реальным production cutover.

## Альтернативы

### 1. Оставить server runtime на HTTP до финального rollout

Не выбрано, потому что final rollout тогда потребовал бы менять edge topology одновременно с боевым запуском, что
увеличивает риск и размывает isolated slice.

### 2. Публиковать `aero-gateway` наружу рядом с `nginx`

Не выбрано, потому что это ломает модель одного внешнего edge и ухудшает операционную ясность.

### 3. Хранить TLS-материал в env или в репозитории

Не выбрано, потому что это противоречит безопасной границе между versioned config и server-only sensitive material.
