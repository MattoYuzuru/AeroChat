# ADR-019: Deploy foundation для single-server self-host AeroChat

- Статус: Accepted
- Дата: 2026-03-16

## Контекст

После завершения Web devices and sessions bootstrap проекту нужен следующий изолированный platform slice:
минимальный, production-oriented deploy foundation для первого воспроизводимого single-server self-host сценария.

Этот этап должен:

- зафиксировать deploy-модель для одного VPS;
- сохранить `aero-gateway` как единственную внешнюю backend edge-точку;
- дать явную границу между local/dev и server/prod-like окружениями;
- подготовить reproducible compose/runtime foundation для первого внешнего запуска;
- не тянуть CI/CD automation, SSH orchestration, боевые секреты и реальный production rollout.

Также важно не нарушить уже принятые ограничения:

- базовая архитектура остаётся монорепозиторием и single-server self-host oriented согласно ADR-001;
- `aero-gateway` остаётся single external edge entrypoint согласно ADR-012;
- frontend продолжает работать только через gateway и не узнаёт downstream URLs согласно ADR-013, ADR-015, ADR-017 и ADR-018;
- ownership `aero-identity` и `aero-chat` не переносится в gateway;
- deploy work не превращается в redesign auth, crypto, storage или frontend shell.

## Решение

### 1. Целевой runtime для этого этапа

На текущем этапе фиксируется single-server topology на одном VPS с Docker Compose.

Runtime состоит из:

- `nginx` как единственного внешнего HTTP edge;
- `web` как контейнера со статически собранным web shell;
- `aero-gateway` как единственной внешней backend edge-точки;
- `aero-identity` и `aero-chat` как внутренних domain services;
- `postgres`, `redis` и `minio` как внутренних инфраструктурных зависимостей.

`aero-rtc-control` и `aero-jobs` в этот foundation не включаются, потому что для текущего product slice у них ещё нет
обязательной server runtime роли.

### 2. External edge model

Внешний HTTP traffic принимает только `nginx`.

Правила маршрутизации:

- `/` и SPA routes проксируются в `web`;
- `/api/*` проксируется в `aero-gateway`;
- `/readyz` проксируется в readiness gateway, чтобы edge health отражал доступность backend entrypoint;
- `nginx` не получает domain ownership и не становится вторым backend edge.

Это закрепляет уже принятую gateway-only frontend architecture без добавления второго внешнего backend входа.

### 3. Internal service wiring

Во всех compose runtime-конфигурациях downstream адресуются по внутренним service names, а не через `localhost`.

Следствия:

- `aero-gateway` использует `http://aero-identity:8081` и `http://aero-chat:8082`;
- `aero-identity` использует PostgreSQL по service DNS;
- `aero-chat` использует PostgreSQL и Redis по service DNS;
- внешний reverse proxy не зависит от localhost-assumptions внутри контейнеров.

При этом source-mode `.env.example` для локального запуска сервисов вне compose остаются отдельными и продолжают
использовать localhost, когда это уместно для разработки.

### 4. Модель окружений

Фиксируются два явных runtime-режима:

1. `local/dev`
   - основной файл: `infra/compose/docker-compose.yml`;
   - цель: локальная разработка и smoke full-stack запуск на одной машине;
   - допускаются localhost port bindings и dev-значения в root `.env.example`;
   - сервисные `.env.example` остаются source-mode примерами для запуска без контейнеров.

2. `server/prod-like`
   - основной файл: `infra/compose/docker-compose.server.yml`;
   - цель: ручной bootstrap одного VPS без CI/CD automation;
   - наружу публикуется только `nginx`;
   - переменные берутся из отдельного `.env.server`;
   - значения в `.env.server.example` являются foundation placeholders, а не боевой секретной конфигурацией.

### 5. Health и readiness policy

Deploy topology должна использовать уже существующие meaningful readiness checks.

На этом этапе:

- `aero-identity` ready только при доступности PostgreSQL;
- `aero-chat` ready только при доступности PostgreSQL и Redis;
- `aero-gateway` ready только при доступности `aero-identity` и `aero-chat`;
- `nginx` в server topology проверяется через `/readyz`, чтобы edge readiness отражал доступность gateway chain.

Это решение даёт практичную operational диагностику без отдельной orchestration-платформы.

### 6. Секреты и rollout policy

В этот PR не входят:

- реальные production secrets;
- доменно-специфичная конфигурация;
- TLS termination и ACME automation;
- GHCR image delivery;
- GitHub Actions deploy jobs;
- SSH automation;
- zero-downtime rollout mechanics;
- backup/restore automation.

`.env.server.example` содержит только placeholder values, достаточные для foundation-level smoke bootstrap.

### 7. Документация и operator flow

В репозитории должен появиться минимальный manual bootstrap flow для VPS:

- подготовка `.env.server`;
- `docker compose ... config`;
- `docker compose ... up --build -d`;
- проверка `/healthz` и `/readyz`;
- перечень того, что уже готово и что намеренно отложено.

Это решение выбрано как минимальное и достаточное для текущего isolated slice без преждевременной automation.

## Последствия

### Положительные

- Появляется воспроизводимый foundation для первого single-server self-host deploy.
- Deploy-модель становится явной и документированной.
- Gateway-only external edge закрепляется не только архитектурно, но и в runtime topology.
- Local/dev и server/prod-like окружения перестают смешиваться в одну неявную конфигурацию.

### Отрицательные

- На этом этапе VPS bootstrap остаётся ручным.
- Compose runtime пока собирает образы из исходников, а не получает их из registry.
- Placeholder secrets допустимы только как foundation-компромисс и не подходят для реального внешнего rollout.

### Ограничения

- Нельзя считать этот PR готовым production deployment workflow.
- Нельзя добавлять второй внешний backend edge помимо `nginx` + `aero-gateway`.
- Нельзя переносить domain ownership из `aero-identity` и `aero-chat` в gateway ради deploy-удобства.
- Нельзя смешивать deploy foundation с TLS automation, Turnstile, cookie-auth redesign или runtime autoscaling.

## Альтернативы

### 1. Сразу внедрить полноценный CI/CD deploy flow

Не выбрано, потому что это смешивает deploy topology foundation с automation, secrets management и rollout policy.

### 2. Делать server runtime только через один compose-файл с профилями

Не выбрано, потому что для текущего этапа явное разделение `local/dev` и `server/prod-like` проще читать и легче
эксплуатировать.

### 3. Публиковать наружу не только `nginx`, но и `aero-gateway`

Не выбрано, потому что это ломает модель единственного внешнего reverse proxy и ухудшает операционную ясность.
