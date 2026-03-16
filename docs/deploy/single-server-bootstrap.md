# Single-server bootstrap и operator update flow

Этот документ описывает ручной operator flow для одного VPS после появления GHCR image delivery и server secret model.

Цель текущего этапа:

- получить воспроизводимый server/prod-like runtime;
- получить registry-backed release bootstrap для application images;
- явно разделить versioned runtime config и server-only secret values;
- сделать ручной update/rollback flow воспроизводимым;
- не внедрять CI/CD deploy и SSH automation;
- не выполнять реальный production rollout из репозитория.

## Модель окружений

В репозитории теперь фиксированы два отдельных режима:

- `local/dev`
  - root `.env.example` управляет локальным compose-стеком;
  - `infra/compose/docker-compose.yml` подходит для локального full-stack smoke запуска;
  - `services/*/.env.example` и `apps/web/.env.example` остаются примерами для source-mode запуска вне compose.

- `server/prod-like`
  - `.env.server.example` содержит только versioned non-secret runtime config;
  - `.env.server.secrets.example` содержит только перечень обязательных secret keys с плейсхолдерами;
  - `infra/compose/docker-compose.server.yml` тянет предсобранные application images из registry;
  - наружу публикуется только `nginx`.

## Server env-модель

Для одного VPS фиксируется двухфайловая модель:

- `.env.server.example`
  - versioned шаблон для несекретных runtime-настроек;
  - сюда входят image namespace/tag, порт `nginx`, имена пользователей, log level и timeouts;
  - этот файл можно безопасно хранить в репозитории как пример.

- `.env.server.secrets.example`
  - versioned шаблон только для имён обязательных секретных переменных;
  - реальных значений в репозитории быть не должно;
  - файл нужен, чтобы оператор видел полный список server-only secret keys.

- `.env.server` на VPS
  - реальная рабочая копия non-secret runtime config;
  - оператор обычно меняет здесь только release-related параметры, в первую очередь `AERO_IMAGE_TAG`.

- `.env.server.secrets` на VPS
  - реальная рабочая копия секретов;
  - этот файл не коммитится;
  - значения из него должны существовать только на сервере.

На текущем этапе к server-only секретам относятся:

- `POSTGRES_PASSWORD`
- `MINIO_ROOT_PASSWORD`

Если позже появятся дополнительные чувствительные значения, они должны попадать в `.env.server.secrets`, а не в
versioned runtime-шаблон.

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
- отдельные versioned шаблоны для runtime config и secret expectations;
- GHCR-ready модель публикации versioned application images;
- readiness chain через `identity` → `chat` → `gateway` → `nginx`;
- manual bootstrap/update/rollback flow без дополнительной deploy automation.

## Что намеренно отложено

- GitHub Actions deploy;
- SSH automation;
- реальные production secrets в репозитории;
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

## Первый bootstrap на VPS

1. Клонируй репозиторий на VPS или обнови уже существующую рабочую директорию.

2. Скопируй оба server env-шаблона в реальные server-only файлы:

```bash
cp .env.server.example .env.server
cp .env.server.secrets.example .env.server.secrets
```

3. Заполни файлы по их роли:

- в `.env.server` задай runtime-настройки и желаемый `AERO_IMAGE_TAG`;
- в `.env.server.secrets` задай реальные server secrets;
- не коммить `.env.server` и `.env.server.secrets` обратно в репозиторий.

Для foundation smoke bootstrap на изолированном тестовом VPS можно начать с template-значений.
Для любого реального внешнего rollout значения в `.env.server.secrets` нужно заменить до первого запуска.

Минимально важные release-переменные в `.env.server`:

- `AERO_IMAGE_NAMESPACE`:
  - по умолчанию указывает на GHCR namespace проекта;
  - в fork или mirror может быть заменён на свой namespace.

- `AERO_IMAGE_TAG`:
  - `edge` для latest build из default branch;
  - `vX.Y.Z` для фиксированного release;
  - при необходимости можно использовать точный `sha-<commit>`.

`latest` намеренно не используется.

На этом этапе опубликованные application images собираются только для `linux/amd64`.

4. Проверь итоговую compose-конфигурацию:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  config
```

5. Загрузи выбранный release tag и подними runtime:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  pull

docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  up -d
```

6. Проверь состояние контейнеров и edge health:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  ps
```

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

Если readiness не проходит, смотри логи проблемного сервиса:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  logs --tail=100 nginx aero-gateway aero-identity aero-chat postgres redis minio
```

## Обновление до выбранного release tag

1. Открой `.env.server` и измени `AERO_IMAGE_TAG` на нужный GHCR tag:

- `edge` для тестового moving channel;
- `vX.Y.Z` для фиксированного release;
- `sha-<commit>` для точной диагностики или адресного отката.

2. Проверь финальную конфигурацию:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  config
```

3. Подтяни выбранные образы и применяй обновление:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  pull

docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  up -d
```

4. Проверь итог:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  ps

curl -fsS http://127.0.0.1/healthz
curl -fsS http://127.0.0.1/readyz
```

## Rollback на предыдущий tag

1. Верни в `.env.server` предыдущий стабильный `AERO_IMAGE_TAG`.

2. Повтори стандартный операторский цикл:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  pull

docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  up -d
```

3. Снова проверь `ps`, `/healthz` и `/readyz`.

Rollback не автоматизируется отдельно: на текущем этапе это сознательно тот же ручной flow, что и update, но с
предыдущим tag.

## Остановка стека

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  down
```

## Что оператор редактирует вручную

- `.env.server`
  - `AERO_IMAGE_TAG` при update/rollback;
  - `AERO_IMAGE_NAMESPACE`, если используется fork, mirror или другой GHCR owner;
  - несекретные runtime-параметры по необходимости.

- `.env.server.secrets`
  - только чувствительные server-only значения;
  - без commit в репозиторий;
  - без передачи в CI на текущем этапе.

## Что намеренно не делается в этом PR

- SSH automation и удалённое выполнение команд из GitHub Actions
- автоматический rollout после publish workflow
- автоматический выбор последнего release
- ACME, TLS termination automation и настройка домена
- внешние secret managers и сложная ops-оркестрация
- полноценный production change-management вне ручного operator flow

## Следующий шаг после этого foundation

Следующий PR должен добавлять следующий изолированный deploy slice, а не менять topology заново:

- TLS/domain setup для single-server self-host;
- явную политику внешнего адреса и edge-конфигурации;
- при необходимости подготовку к следующему уровню deploy automation без SSH rollout в том же PR.
