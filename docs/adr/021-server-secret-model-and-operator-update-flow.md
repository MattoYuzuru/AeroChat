# ADR-021: Server secret model и manual operator update flow для single-server self-host

- Статус: Accepted
- Дата: 2026-03-30

## Контекст

После завершения image delivery и release bootstrap у проекта уже есть:

- single-server runtime topology на Docker Compose;
- GHCR-based публикация versioned application images;
- ручной выбор `AERO_IMAGE_TAG` для server/prod-like окружения.

Но текущий foundation ещё недостаточно чётко фиксирует две вещи:

1. где заканчивается versioned server config и начинаются server-only секреты;
2. каким именно должен быть ручной операторский flow для первого bootstrap, update и rollback.

Если оставить это неявным, появляются ненужные риски:

- секреты начинают смешиваться с versioned env examples;
- оператору неочевидно, какие файлы он должен редактировать на VPS;
- update и rollback выполняются по памяти, а не по воспроизводимому runbook;
- image delivery slice начинает выглядеть как полуавтоматический deploy, хотя automation ещё не утверждена.

Также нужно сохранить уже принятые ограничения:

- single-server self-host модель из ADR-001, ADR-019 и ADR-020 остаётся основной;
- `nginx` остаётся единственным внешним HTTP edge, а `aero-gateway` единственной внешней backend edge-точкой;
- local/dev flow не должен ломаться и не должен подчиняться server secrets model;
- этот этап не должен тянуть SSH automation, TLS automation и реальный production rollout orchestration.

## Решение

### 1. Двухфайловая server env-модель

Для `server/prod-like` окружения фиксируется явная двухфайловая модель:

1. `.env.server`
   - реальный server runtime env на VPS;
   - содержит только несекретные runtime-настройки и release selection;
   - обычно редактируется оператором при выборе `AERO_IMAGE_TAG`.

2. `.env.server.secrets`
   - реальный server-only secret env на VPS;
   - содержит только чувствительные значения;
   - не коммитится в репозиторий.

В репозитории поддерживаются два versioned example-файла:

- `.env.server.example` для non-secret runtime config;
- `.env.server.secrets.example` только для списка обязательных secret keys и безопасных placeholder values.

Это решение заменяет неявную модель, где server bootstrap выглядел как один `.env.server` со смешанными ожиданиями.

### 2. Граница между versioned config и secret material

В versioned non-secret runtime example допускаются:

- `AERO_IMAGE_NAMESPACE`
- `AERO_IMAGE_TAG`
- `AERO_NGINX_HTTP_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `MINIO_ROOT_USER`
- log level, timeouts и другие безопасные runtime defaults

В server-only secret env на текущем этапе должны жить:

- `POSTGRES_PASSWORD`
- `MINIO_ROOT_PASSWORD`

Если в следующих slices появятся новые чувствительные переменные, они должны добавляться в `.env.server.secrets`,
а не возвращаться в versioned runtime example.

### 3. Operator contract для update и rollback

Ручной operator flow остаётся максимально простым:

- оператор выбирает release через `AERO_IMAGE_TAG` в `.env.server`;
- затем выполняет `docker compose ... config`;
- затем выполняет `docker compose ... pull`;
- затем выполняет `docker compose ... up -d`;
- затем проверяет `docker compose ps`, `curl /healthz` и `curl /readyz`.

Rollback не получает отдельной automation-семантики.
Он выполняется тем же flow после возврата `AERO_IMAGE_TAG` на предыдущий известный рабочий tag.

### 4. Первый bootstrap на VPS

Первый bootstrap обязан быть явно документирован:

- копирование `.env.server.example` в `.env.server`;
- копирование `.env.server.secrets.example` в `.env.server.secrets`;
- ручное заполнение server-only секретов;
- выбор нужного image tag;
- compose config validation;
- compose pull и up;
- health/readiness checks.

Это фиксируется как production-oriented runbook без SSH automation.

### 5. Scope boundaries

В этот этап не входят:

- GitHub Actions deploy jobs;
- SSH automation;
- ACME/TLS automation;
- доменное провижининг;
- zero-downtime orchestration;
- backup/restore automation;
- внешний secret manager;
- реальные production secrets в репозитории.

## Последствия

### Положительные

- Server secret expectations становятся явными и безопаснее отделены от versioned config.
- Operator update и rollback flow становится воспроизводимым и проверяемым.
- GHCR image delivery получает понятный ручной runtime contract без преждевременной automation.
- Local/dev flow не усложняется и не смешивается с VPS-specific secret handling.

### Отрицательные

- На этом этапе оператор всё ещё вручную редактирует env-файлы на сервере.
- Rollback остаётся ручным и не даёт zero-downtime гарантий.
- Секреты пока не интегрированы с отдельным secret manager или orchestration layer.

### Ограничения

- Нельзя коммитить реальные `.env.server` и `.env.server.secrets`.
- Нельзя считать этот slice полноценным production deploy automation.
- Нельзя добавлять SSH rollout steps в publish workflow.
- Нельзя усложнять single-server модель ради преждевременной ops-автоматизации.

## Альтернативы

### 1. Оставить один `.env.server` для всего

Не выбрано, потому что это размывает границу между безопасно версионируемым config и server-only secret material.

### 2. Сразу внедрить secret manager или orchestration platform

Не выбрано, потому что это преждевременно расширяет scope и не соответствует текущей single-server foundation задаче.

### 3. Сразу добавить SSH automation для update и rollback

Не выбрано, потому что текущий slice должен сначала зафиксировать простой ручной operator contract, а не remote mutation
pipeline.
