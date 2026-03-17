# Single-server bootstrap, shared-host nginx edge и operator fallback flow

Этот документ описывает базовую подготовку одного VPS после перехода на shared-host edge модель, где публичные
`80/443` уже принадлежат существующему host-level `nginx`.

Цель текущего этапа:

- сохранить single-server self-host runtime;
- убрать конфликт за публичные `80/443`;
- оставить host `nginx` единственным внешним edge;
- публиковать AeroChat runtime только на loopback high ports;
- документировать выпуск сертификата через existing host `nginx` path;
- сохранить ручной fallback flow для update и rollback;
- не превращать этот документ в provisioning, ACME automation или zero-downtime runbook.

Основной production rollout по GitHub Actions описан отдельно в
[production-rollout runbook](/home/mattoyudzuru/GolandProjects/AeroChat/docs/deploy/production-rollout.md).
Этот документ остаётся source of truth для server preparation, host `nginx` contract и ручного fallback flow.

## Модель окружений

В репозитории фиксированы два отдельных режима:

- `local/dev`
  - root `.env.example` управляет локальным compose-стеком;
  - `infra/compose/docker-compose.yml` подходит для локального full-stack smoke запуска;
  - локальный `nginx` контейнер по-прежнему используется только в dev-runtime;
  - `services/*/.env.example` и `apps/web/.env.example` остаются примерами для source-mode запуска вне compose.

- `server/prod-like`
  - `.env.server.example` содержит только versioned non-secret runtime config;
  - `.env.server.secrets.example` содержит только перечень обязательных secret keys с плейсхолдерами;
  - `infra/compose/docker-compose.server.yml` тянет предсобранные application images из registry;
  - compose публикует только `web` и `aero-gateway` на `127.0.0.1` high ports;
  - host-level `nginx` остаётся единственным внешним edge на `80/443`;
  - сертификаты выпускаются и используются на host-level `nginx`, а не внутри compose stack.

## Runtime topology

На одном VPS поднимаются:

- host-level `nginx` как единственный внешний HTTP/HTTPS edge;
- `web` как контейнер со статически собранным frontend;
- `aero-gateway` как единственная backend edge-точка;
- `aero-identity` и `aero-chat` как внутренние сервисы;
- `postgres`, `redis`, `minio` как внутренние зависимости.

Внутренние обращения идут так:

- browser → host `nginx`
- host `nginx` → `web` на `127.0.0.1:${AERO_WEB_HOST_PORT}`
- host `nginx` → `aero-gateway` на `127.0.0.1:${AERO_GATEWAY_HOST_PORT}`
- `aero-gateway` → `aero-identity`, `aero-chat` по compose DNS
- `aero-identity` → `postgres`
- `aero-chat` → `postgres`, `redis`

Наружу не публикуются:

- `aero-identity`
- `aero-chat`
- `postgres`
- `redis`
- `minio`

## Server env-модель

Для одного VPS фиксируется двухфайловая модель:

- `.env.server.example`
  - versioned шаблон для несекретных runtime-настроек;
  - сюда входят image namespace/tag, primary domain и loopback ports для host `nginx` upstreams;
  - этот файл можно безопасно хранить в репозитории как пример.

- `.env.server.secrets.example`
  - versioned шаблон только для имён обязательных секретных переменных;
  - реальных значений в репозитории быть не должно.

- `.env.server` на VPS
  - реальная рабочая копия non-secret runtime config;
  - оператор обычно меняет здесь `AERO_IMAGE_TAG` и при необходимости loopback ports.

- `.env.server.secrets` на VPS
  - реальная рабочая копия секретов;
  - этот файл не коммитится;
  - значения из него существуют только на сервере.

На текущем этапе к server-only секретам относятся:

- `POSTGRES_PASSWORD`
- `MINIO_ROOT_PASSWORD`

Если позже появятся дополнительные чувствительные значения, они должны попадать в `.env.server.secrets`, а не в
versioned runtime-шаблон.

## Что версионируется и что создаётся на VPS

В репозитории версионируются:

- `infra/compose/docker-compose.server.yml`;
- `.env.server.example`;
- `.env.server.secrets.example`;
- host `nginx` examples:
  - `infra/nginx/shared-host-http-bootstrap-aero.keykomi.com.conf.example`;
  - `infra/nginx/shared-host-aero.keykomi.com.conf.example`;
- этот runbook и ADR.

Только на VPS создаются:

- `.env.server`;
- `.env.server.secrets`;
- host `nginx` site config для реального домена;
- ACME webroot directory, например `/var/www/certbot`;
- host-level сертификаты и приватный ключ.

## Host nginx contract

Host-level `nginx` должен обслуживать:

- `/healthz` самостоятельно;
- `/readyz` через proxy в `aero-gateway`;
- `/api/` только в `aero-gateway`;
- `/` и SPA routes в `web`.

Для первой выдачи сертификата в репозитории есть отдельный HTTP bootstrap example:

- [shared-host-http-bootstrap-aero.keykomi.com.conf.example](/home/mattoyudzuru/GolandProjects/AeroChat/infra/nginx/shared-host-http-bootstrap-aero.keykomi.com.conf.example)

Для итогового HTTPS runtime есть отдельный final example:

- [shared-host-aero.keykomi.com.conf.example](/home/mattoyudzuru/GolandProjects/AeroChat/infra/nginx/shared-host-aero.keykomi.com.conf.example)

Оба файла используют домен `aero.keykomi.com` и loopback ports `18080/18081` как явный пример.
Если домен или порты отличаются, оператор обязан заменить их в host `nginx` config и в `.env.server`.

## Что готово сейчас

- production-oriented compose topology без отдельного публичного `nginx` контейнера;
- loopback-only contract для `web` и `aero-gateway`;
- host-level reverse proxy contract для shared-host VPS;
- GHCR-ready модель публикации versioned application images;
- `aero-gateway` остаётся единственной backend edge-точкой;
- documented certificate issuance path через existing host `nginx` + ACME webroot;
- manual bootstrap/update/rollback flow как fallback;
- manual GitHub Actions rollout через environment `production`.

## Что намеренно отложено

- автоматический выпуск и renewal сертификатов;
- управление host `nginx` через GitHub Actions;
- backup/restore automation;
- zero-downtime rollout;
- OS-level provisioning и firewall hardening;
- multi-host и blue-green topology.

## Подготовка VPS

Минимально нужны:

- Linux VPS;
- Docker Engine;
- Docker Compose plugin;
- уже работающий host-level `nginx`, который владеет `80/tcp` и `443/tcp`;
- домен, который будет указывать на VPS;
- доступ к `sudo` для обновления host `nginx` config и выдачи сертификата;
- директория для ACME webroot, например `/var/www/certbot`.

## Первый bootstrap на VPS

1. Клонируй репозиторий на VPS или обнови уже существующую рабочую директорию.

2. Скопируй оба server env-шаблона в реальные server-only файлы:

```bash
cp .env.server.example .env.server
cp .env.server.secrets.example .env.server.secrets
```

3. Заполни `.env.server` и `.env.server.secrets`.

Минимально важные non-secret переменные в `.env.server`:

- `AERO_IMAGE_NAMESPACE`
- `AERO_IMAGE_TAG`
- `AERO_EDGE_DOMAIN`
- `AERO_WEB_HOST_PORT`
- `AERO_GATEWAY_HOST_PORT`

Ожидаемая семантика:

- `AERO_WEB_HOST_PORT` используется host `nginx` для upstream `/`;
- `AERO_GATEWAY_HOST_PORT` используется host `nginx` для upstream `/api/` и `/readyz`;
- оба порта должны оставаться loopback-only и не конфликтовать с другими сервисами на VPS.

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

6. Проверь состояние контейнеров и loopback upstreams:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  ps
```

```bash
curl -fsS http://127.0.0.1:18080/
curl -fsS http://127.0.0.1:18081/readyz
```

Если в `.env.server` выбраны другие loopback ports, замени `18080` и `18081` на актуальные значения.

7. Подготовь ACME webroot и HTTP bootstrap config для host `nginx`.

Пример для домена `aero.keykomi.com`:

```bash
sudo mkdir -p /var/www/certbot
sudo cp infra/nginx/shared-host-http-bootstrap-aero.keykomi.com.conf.example /etc/nginx/sites-available/aerochat.conf
```

Дальше замени в `/etc/nginx/sites-available/aerochat.conf`:

- `aero.keykomi.com` на реальный домен из `AERO_EDGE_DOMAIN`;
- `18080` на значение `AERO_WEB_HOST_PORT`;
- `18081` на значение `AERO_GATEWAY_HOST_PORT`.

После этого включи сайт и перезагрузи host `nginx`:

```bash
sudo ln -sf /etc/nginx/sites-available/aerochat.conf /etc/nginx/sites-enabled/aerochat.conf
sudo nginx -t
sudo systemctl reload nginx
```

8. Выпусти сертификат через existing host `nginx` path.

Основной documented path:

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d aero.keykomi.com
```

В команде выше замени `aero.keykomi.com` на реальный домен.
`certbot --standalone` не является основным сценарием для shared-host VPS.

9. Переключи host `nginx` на финальный HTTPS server block.

Пример:

```bash
sudo cp infra/nginx/shared-host-aero.keykomi.com.conf.example /etc/nginx/sites-available/aerochat.conf
```

После копирования замени:

- `aero.keykomi.com` на реальный домен;
- `18080` на значение `AERO_WEB_HOST_PORT`;
- `18081` на значение `AERO_GATEWAY_HOST_PORT`;
- пути `/etc/letsencrypt/live/aero.keykomi.com/...` на актуальные certificate paths, если они отличаются.

Затем снова проверь и перезагрузи host `nginx`:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

10. Проверь итоговый edge path:

```bash
curl -fsS http://127.0.0.1/healthz
curl -fsS http://127.0.0.1/readyz
curl -fsS --resolve "aero.example.com:443:127.0.0.1" https://aero.example.com/healthz
curl -fsS --resolve "aero.example.com:443:127.0.0.1" https://aero.example.com/readyz
```

В командах выше `aero.example.com` замени на `AERO_EDGE_DOMAIN`.

После того как VPS подготовлен и локальные проверки проходят, для production rollout рекомендуется перейти к
[production-rollout runbook](/home/mattoyudzuru/GolandProjects/AeroChat/docs/deploy/production-rollout.md) и
использовать manual workflow `Deploy Production`.

## Ожидаемое поведение

- `/healthz` отвечает host `nginx` и показывает, что edge-process жив;
- `/readyz` проходит через host `nginx` в `aero-gateway` и отражает доступность downstream chain;
- `http://<domain>/` делает redirect на `https://<domain>/`;
- `https://<domain>/` открывает web shell;
- frontend ходит в backend только через `/api`;
- loopback upstream ports не открыты наружу.

## Диагностика

Если readiness не проходит:

1. Проверь compose runtime:

```bash
docker compose \
  --env-file .env.server \
  --env-file .env.server.secrets \
  -f infra/compose/docker-compose.server.yml \
  logs --tail=100 web aero-gateway aero-identity aero-chat postgres redis minio
```

2. Проверь host `nginx`:

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
```

3. Убедись, что в host `nginx` config совпадают:

- домен;
- `AERO_WEB_HOST_PORT`;
- `AERO_GATEWAY_HOST_PORT`;
- certificate paths.

## Manual update и rollback fallback

Если GitHub Actions недоступен, fallback остаётся простым:

1. Измени `AERO_IMAGE_TAG` в `.env.server`.
2. Выполни `docker compose ... config`.
3. Выполни `docker compose ... pull`.
4. Выполни `docker compose ... up -d`.
5. Проверь `docker compose ... ps`, `http://127.0.0.1/readyz` и `https://<domain>/readyz`.

Rollback делается тем же flow после возврата `AERO_IMAGE_TAG` на предыдущий known-good tag.

## Границы ответственности

Compose runtime отвечает только за application stack AeroChat.

Оператор отвечает за:

- host `nginx` config;
- ACME webroot;
- выпуск и renewal сертификатов;
- DNS и firewall;
- синхронность `.env.server` и host `nginx` upstream ports;
- внешний пользовательский smoke после deploy.
