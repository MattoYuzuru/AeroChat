# Single-server TLS/domain bootstrap и operator update flow

Этот документ описывает ручной operator flow для одного VPS после появления GHCR image delivery, server secret model и
domain-ready TLS edge bootstrap.

Цель текущего этапа:

- получить воспроизводимый server/prod-like runtime;
- получить registry-backed release bootstrap для application images;
- явно разделить versioned runtime config и server-only secret values;
- зафиксировать production-like HTTP/HTTPS edge path для одного домена;
- явно определить файловую модель TLS-сертификатов на VPS;
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
  - домен и путь к каталогу TLS-сертификатов задаются оператором в `.env.server`;
  - каталог с `fullchain.pem` и `privkey.pem` существует только на VPS и монтируется в `nginx` read-only;
  - `infra/compose/docker-compose.server.yml` тянет предсобранные application images из registry;
  - наружу публикуется только `nginx` на `80/443`.

## Server env-модель

Для одного VPS фиксируется двухфайловая модель:

- `.env.server.example`
  - versioned шаблон для несекретных runtime-настроек;
  - сюда входят image namespace/tag, domain, порты `nginx`, путь к TLS-каталогу, имена пользователей, log level и
    timeouts;
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

TLS-материал в эту env-модель не добавляется.
Сертификат и приватный ключ живут только как файлы на VPS и не передаются через env.

На текущем этапе к server-only секретам относятся:

- `POSTGRES_PASSWORD`
- `MINIO_ROOT_PASSWORD`

Если позже появятся дополнительные чувствительные значения, они должны попадать в `.env.server.secrets`, а не в
versioned runtime-шаблон.

## Что версионируется и что создаётся на VPS

В репозитории версионируются:

- `infra/compose/docker-compose.server.yml`;
- `infra/nginx/server.conf.template`;
- `.env.server.example`;
- `.env.server.secrets.example`;
- этот runbook и ADR.

Только на VPS создаются:

- `.env.server`;
- `.env.server.secrets`;
- каталог из `AERO_NGINX_TLS_CERTS_DIR`;
- файлы `fullchain.pem` и `privkey.pem` внутри этого каталога.

Для следующих этапов сознательно остаются:

- реальное получение сертификата;
- renewal automation;
- DNS automation;
- SSH rollout automation;
- GitHub Actions deploy;
- реальный production cutover.

## Runtime topology

На одном VPS поднимаются:

- `nginx` как единственный внешний HTTP/HTTPS edge;
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
- domain-ready `nginx` path с внешними `80/443`;
- канонический redirect с HTTP на HTTPS для обычного user traffic;
- файловая модель TLS-сертификатов, которые монтируются в `nginx` read-only;
- readiness chain через `identity` → `chat` → `gateway` → `nginx`;
- manual bootstrap/update/rollback flow без дополнительной deploy automation.

## Что намеренно отложено

- GitHub Actions deploy;
- SSH automation;
- реальные production secrets в репозитории;
- реальное получение, выпуск и renewal TLS-сертификатов;
- backup/restore automation;
- zero-downtime rollout;
- firewall hardening, DNS automation и OS-level provisioning.

## Подготовка VPS

Минимально нужны:

- Linux VPS;
- Docker Engine;
- Docker Compose plugin;
- открытые `80/tcp` и `443/tcp` для `nginx`;
- подготовленный домен, который будет указывать на VPS;
- уже существующие TLS-файлы для этого домена или временный тестовый сертификат для preflight smoke.

## Первый bootstrap на VPS

1. Клонируй репозиторий на VPS или обнови уже существующую рабочую директорию.

2. Скопируй оба server env-шаблона в реальные server-only файлы:

```bash
cp .env.server.example .env.server
cp .env.server.secrets.example .env.server.secrets
```

3. Заполни файлы по их роли:

- в `.env.server` задай runtime-настройки, `AERO_EDGE_DOMAIN`, `AERO_NGINX_TLS_CERTS_DIR` и желаемый `AERO_IMAGE_TAG`;
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

- `AERO_EDGE_DOMAIN`:
  - основной внешний домен single-server deployment;
  - используется как `server_name` и canonical HTTPS redirect target.

- `AERO_NGINX_TLS_CERTS_DIR`:
  - каталог на VPS, который монтируется в контейнер `nginx` только для чтения;
  - внутри него должны существовать `fullchain.pem` и `privkey.pem`.

`latest` намеренно не используется.

На этом этапе опубликованные application images собираются только для `linux/amd64`.

4. Подготовь файловую TLS-модель на VPS:

Если используется значение по умолчанию из `.env.server.example`, подготовка выглядит так:

```bash
mkdir -p /opt/aerochat/tls
chmod 700 /opt/aerochat/tls
```

Дальше оператор вручную кладёт в каталог из `AERO_NGINX_TLS_CERTS_DIR`:

- `fullchain.pem`
- `privkey.pem`

Минимальные правила:

- файлы не коммитятся в репозиторий;
- приватный ключ остаётся только на VPS;
- compose и `nginx` считают эти файлы уже существующими до `up -d`.

5. Проверь итоговую compose-конфигурацию:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  config
```

6. Загрузи выбранный release tag и подними runtime:

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

7. Проверь состояние контейнеров и edge health:

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

Если DNS уже настроен и сертификат соответствует домену, проверь HTTPS entry.
Ниже `aero.example.com` нужно заменить на реальный домен из `.env.server`:

```bash
curl -fsS --resolve "aero.example.com:443:127.0.0.1" https://aero.example.com/healthz
curl -fsS --resolve "aero.example.com:443:127.0.0.1" https://aero.example.com/readyz
```

Если проверка выполняется удалённо, используй домен сервера вместо `127.0.0.1`.

## Ожидаемое поведение

- `/healthz` отвечает сам `nginx` и показывает, что edge-process жив;
- `/readyz` проходит через `nginx` в `aero-gateway` и отражает доступность downstream chain;
- `http://<domain>/` делает redirect на `https://<domain>/`;
- `https://<domain>/` открывает web shell;
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
  - `AERO_EDGE_DOMAIN`, если меняется primary domain;
  - `AERO_NGINX_TLS_CERTS_DIR`, если оператор переносит сертификаты в другой host path;
  - несекретные runtime-параметры по необходимости.

- `.env.server.secrets`
  - только чувствительные server-only значения;
  - без commit в репозиторий;
  - без передачи в CI на текущем этапе.

- каталог из `AERO_NGINX_TLS_CERTS_DIR`
  - только certificate files;
  - без commit в репозиторий;
  - с ручной ответственностью оператора за наличие и права доступа.

## Что намеренно не делается в этом PR

- SSH automation и удалённое выполнение команд из GitHub Actions
- автоматический rollout после publish workflow
- автоматический выбор последнего release
- ACME issuance/renewal automation и DNS automation
- внешние secret managers и сложная ops-оркестрация
- полноценный production change-management вне ручного operator flow

## Следующий шаг после этого foundation

Следующий PR должен добавлять следующий изолированный deploy slice, а не менять topology заново:

- финальный single-server rollout PR на реальном домене с внешним smoke и operator verification;
- отдельный SSH/deploy automation slice только после того, как ручной rollout будет подтверждён;
- без смены `nginx`/gateway topology и без переноса certificate material в репозиторий.
