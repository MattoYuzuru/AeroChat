# Production rollout automation и first external launch

Этот документ описывает финальный operational slice для первого реального внешнего запуска AeroChat на одном VPS.

Цель текущего этапа:

- выполнять production rollout только вручную и явно;
- использовать GitHub Environment `production` как deploy gate;
- менять на сервере только выбранный `AERO_IMAGE_TAG`;
- сохранять уже принятую single-server topology;
- иметь понятный runbook для first launch, verification и rollback.

Workflow не занимается:

- remote provisioning VPS;
- `git pull` или sync checkout на сервере;
- ACME issuance/renewal;
- auto-rollback;
- zero-downtime orchestration.

## Что уже должно быть готово до workflow

Перед автоматизированным rollout должны быть завершены предыдущие platform slices:

- сервер подготовлен по [single-server bootstrap runbook](/home/mattoyudzuru/GolandProjects/AeroChat/docs/deploy/single-server-bootstrap.md);
- deploy directory на VPS уже существует и содержит актуальный checkout репозитория;
- на VPS уже есть `.env.server` и `.env.server.secrets`;
- TLS-каталог из `AERO_NGINX_TLS_CERTS_DIR` уже содержит `fullchain.pem` и `privkey.pem`;
- нужные GHCR-образы уже опубликованы;
- домен уже указывает на VPS, а `80/tcp` и `443/tcp` доступны извне.

Если compose topology, env contract или `nginx` шаблон менялись в репозитории, оператор обязан отдельно обновить checkout
на VPS до первого запуска workflow.

## GitHub Environment `production`

Workflow использует только GitHub Environment `production`.

Рекомендуемая настройка:

1. Создать environment с именем `production`.
2. Включить `Required reviewers`, если для репозитория нужен явный deploy approval.
3. При необходимости ограничить допустимые branch rules для deploy.
4. Заполнять production secrets и variables только внутри этого environment.

### Secrets

В `production` secrets должны быть заданы:

- `AERO_PROD_SSH_HOST`
  - внешний адрес VPS;
  - хранится как secret, потому что текущий workflow читает весь SSH connection bundle из environment secrets.

- `AERO_PROD_SSH_PORT`
  - SSH-порт VPS;
  - обычно `22`, но хранится там же для единообразия connection contract.

- `AERO_PROD_SSH_USER`
  - пользователь для SSH rollout.

- `AERO_PROD_SSH_PRIVATE_KEY`
  - приватный ключ без passphrase для GitHub Actions runner;
  - использовать отдельный deploy key только для production rollout.

- `AERO_PROD_SSH_KNOWN_HOSTS`
  - строка `known_hosts` для VPS;
  - позволяет держать `StrictHostKeyChecking=yes` и не отключать проверку host key.

### Variables

В `production` variables должны быть заданы:

- `AERO_PROD_DEPLOY_DIR`
  - абсолютный путь к checkout AeroChat на VPS;
  - пример: `/opt/aerochat/app`.

- `AERO_PROD_COMPOSE_FILE`
  - путь к server compose file относительно deploy directory;
  - для текущего репозитория ожидается `infra/compose/docker-compose.server.yml`.

- `AERO_PROD_EDGE_DOMAIN`
  - основной внешний домен single-server deployment;
  - используется в HTTPS health/readiness проверках workflow.

## Server-side prerequisites

На VPS должны быть доступны:

- `docker`
- `docker compose`
- `bash`
- `curl`
- `grep`
- `sed`

Также до первого rollout workflow обязаны существовать:

- deploy directory из `AERO_PROD_DEPLOY_DIR`;
- checkout репозитория с файлом `infra/compose/docker-compose.server.yml`;
- `.env.server`;
- `.env.server.secrets`;
- TLS directory из `AERO_NGINX_TLS_CERTS_DIR`;
- файлы `fullchain.pem` и `privkey.pem`;
- firewall rules и DNS для `80/443`.

Workflow гарантирует существование deploy directory через `mkdir -p`, но не подготавливает checkout и не создаёт env-файлы за оператора.

## Что делает workflow

Manual workflow `Deploy Production` выполняет один последовательный цикл:

1. принимает входной `image_tag`;
2. проверяет обязательные environment secrets и variables;
3. подключается к VPS по SSH;
4. подтверждает наличие `.env.server`, `.env.server.secrets` и compose file;
5. обновляет `AERO_IMAGE_TAG` в `.env.server`;
6. выполняет `docker compose ... config`;
7. выполняет `docker compose ... pull`;
8. выполняет `docker compose ... up -d`;
9. показывает `docker compose ... ps`;
10. ждёт успешных HTTP/HTTPS health/readiness checks.

Workflow намеренно не трогает:

- `.env.server.secrets`;
- TLS-файлы;
- git checkout на VPS;
- release selection для отдельных сервисов по разным тегам.

## Первый внешний запуск

Рекомендуемый first launch checklist:

1. Подготовить VPS по [single-server bootstrap runbook](/home/mattoyudzuru/GolandProjects/AeroChat/docs/deploy/single-server-bootstrap.md).
2. Проверить, что deploy directory на VPS содержит актуальный checkout этого operational slice.
3. Создать и заполнить GitHub Environment `production`.
4. Выбрать первый стабильный `image_tag`.
   Для первого live run рекомендуется `vX.Y.Z`, а не `edge`.
5. Открыть GitHub Actions и вручную запустить workflow `Deploy Production`.
6. Передать выбранный `image_tag` в `workflow_dispatch`.
7. Дождаться успешного завершения job и встроенных HTTP/HTTPS проверок.
8. С внешней машины выполнить базовую проверку домена:

```bash
curl -fsS https://aero.example.com/healthz
curl -fsS https://aero.example.com/readyz
curl -I http://aero.example.com/
```

9. Открыть `https://aero.example.com/` в браузере и проверить:
   - загрузку web shell;
   - успешный login или register;
   - работу `/api` через обычный пользовательский flow.
10. Зафиксировать предыдущий known-good tag и текущий deployed tag в операторском журнале или release notes.

В командах выше `aero.example.com` нужно заменить на значение из `AERO_PROD_EDGE_DOMAIN`.

## Verification после rollout

### Что проверяет сам workflow

Workflow на сервере дожидается успешного ответа для:

- `http://127.0.0.1/healthz`
- `http://127.0.0.1/readyz`
- `https://<domain>/healthz` через `--resolve`
- `https://<domain>/readyz` через `--resolve`

Этого достаточно, чтобы подтвердить:

- живой `nginx`;
- рабочую readiness chain;
- корректный HTTPS path для домена.

### Что оператору стоит проверить дополнительно

- `docker compose ps` на VPS, если rollout выглядит подозрительно;
- `docker compose logs --tail=100 nginx aero-gateway aero-identity aero-chat postgres redis minio`;
- открытие главной страницы и auth flow через реальный браузер;
- отсутствие TLS warning при внешнем заходе на домен.

## Rollback

Rollback делается тем же workflow и тем же operator contract:

1. Определи предыдущий известный рабочий tag.
2. Запусти workflow `Deploy Production` ещё раз.
3. Передай предыдущий tag как `image_tag`.
4. Дождись тех же health/readiness checks.

Это сознательно тот же tag-driven flow, а не отдельная rollback automation.

### Manual fallback

Если GitHub Actions недоступен, fallback остаётся таким же, как в bootstrap runbook:

1. Зайди на VPS по SSH.
2. Верни `AERO_IMAGE_TAG` в `.env.server` на предыдущий known-good tag.
3. Выполни `docker compose ... pull`.
4. Выполни `docker compose ... up -d`.
5. Снова проверь `/healthz` и `/readyz`.

## Типовые границы ответственности

Workflow отвечает только за rollout already prepared single-server runtime.

Оператор отвечает за:

- актуальность checkout на VPS;
- секреты в `.env.server.secrets`;
- TLS-файлы;
- DNS и firewall;
- выбор release tag;
- внешний пользовательский smoke после deploy.
