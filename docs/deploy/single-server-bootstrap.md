# Single-server bootstrap

Этот документ описывает foundation-уровень ручного bootstrap для одного VPS.

Цель текущего этапа:

- получить воспроизводимый server/prod-like runtime;
- получить registry-backed release bootstrap для application images;
- не внедрять CI/CD deploy;
- не требовать реальные боевые секреты;
- не делать реальный production rollout.

## Модель окружений

В репозитории теперь фиксированы два отдельных режима:

- `local/dev`
  - root `.env.example` управляет локальным compose-стеком;
  - `infra/compose/docker-compose.yml` подходит для локального full-stack smoke запуска;
  - `services/*/.env.example` и `apps/web/.env.example` остаются примерами для source-mode запуска вне compose.

- `server/prod-like`
  - `.env.server.example` служит шаблоном для VPS;
  - `infra/compose/docker-compose.server.yml` тянет предсобранные application images из registry;
  - наружу публикуется только `nginx`.

## Runtime topology

На одном VPS поднимаются:

- `nginx` как единственный внешний HTTP edge;
- `web` как контейнер со статически собранным frontend;
- `aero-gateway` как единственная backend edge-точка;
- `aero-identity` и `aero-chat` как внутренние сервисы;
- `postgres`, `redis`, `minio` как внутренние зависимости.

Внутренние обращения идут по service DNS:

- `aero-gateway` → `aero-identity`, `aero-chat`
- `aero-identity` → `postgres`
- `aero-chat` → `postgres`, `redis`

## Что готово сейчас

- production-oriented compose topology для одного сервера;
- отдельный env-шаблон для server/prod-like режима;
- GHCR-ready модель публикации versioned application images;
- readiness chain через `identity` → `chat` → `gateway` → `nginx`;
- manual bootstrap flow без дополнительной deploy automation.

## Что намеренно отложено

- GitHub Actions deploy;
- SSH automation;
- реальные production secrets;
- TLS и ACME automation;
- backup/restore automation;
- zero-downtime rollout;
- firewall hardening и OS-level provisioning.

## Подготовка VPS

Минимально нужны:

- Linux VPS;
- Docker Engine;
- Docker Compose plugin;
- открытый HTTP-порт для `nginx`.

## Bootstrap

1. Скопируй server env-шаблон:

```bash
cp .env.server.example .env.server
```

2. При необходимости измени плейсхолдеры в `.env.server`.

Для foundation smoke bootstrap можно оставить шаблонные значения на изолированном тестовом сервере.
Для любого реального внешнего rollout их нужно заменить.

Минимально важные release-переменные:

- `AERO_IMAGE_NAMESPACE`:
  - по умолчанию указывает на GHCR namespace проекта;
  - в fork или mirror может быть заменён на свой namespace.

- `AERO_IMAGE_TAG`:
  - `edge` для latest build из default branch;
  - `vX.Y.Z` для фиксированного release;
  - при необходимости можно использовать точный `sha-<commit>`.

`latest` намеренно не используется.

На этом этапе опубликованные application images собираются только для `linux/amd64`.

3. Проверь итоговую compose-конфигурацию:

```bash
docker compose --env-file .env.server -f infra/compose/docker-compose.server.yml config
```

4. Подними runtime:

```bash
docker compose --env-file .env.server -f infra/compose/docker-compose.server.yml pull
docker compose --env-file .env.server -f infra/compose/docker-compose.server.yml up -d
```

5. Проверь edge health:

```bash
curl -fsS http://127.0.0.1/healthz
curl -fsS http://127.0.0.1/readyz
```

Если проверка выполняется удалённо, используй IP или домен сервера вместо `127.0.0.1`.

## Ожидаемое поведение

- `/healthz` отвечает сам `nginx` и показывает, что edge-process жив;
- `/readyz` проходит через `nginx` в `aero-gateway` и отражает доступность downstream chain;
- web shell открывается через `/`;
- frontend ходит в backend только через `/api`.

## Остановка и обновление

Остановить стек:

```bash
docker compose --env-file .env.server -f infra/compose/docker-compose.server.yml down
```

Обновить до другого release tag:

```bash
docker compose --env-file .env.server -f infra/compose/docker-compose.server.yml pull
docker compose --env-file .env.server -f infra/compose/docker-compose.server.yml up -d
```

## Следующий шаг после этого foundation

Следующий PR должен добавлять уже не topology foundation, а реальный deploy workflow:

- безопасную модель секретов;
- TLS/domain setup;
- automation для rollout и обновлений.
