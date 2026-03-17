# ADR-028: First-launch database schema bootstrap для `aero-identity` и `aero-chat`

- Статус: Accepted
- Дата: 2026-04-05

## Контекст

После первого внешнего запуска на VPS подтвердился реальный runtime-issue:

- публичный сайт доступен по HTTPS;
- `aero-gateway`, `aero-identity`, `aero-chat` и `web` поднимаются;
- регистрация падает с ошибкой `relation "users" does not exist`.

Это означает, что:

- сервисы умеют подключаться к PostgreSQL;
- readiness по зависимости БД может проходить;
- но доменная схема не применяется автоматически при первом запуске.

В репозитории уже существуют упорядоченные SQL-файлы:

- `services/aero-identity/db/schema`
- `services/aero-chat/db/schema`

Однако текущий runtime их не исполняет.
Из-за этого первый запуск зависит от ручного `psql`-шага, который не был частью зафиксированного operator flow.

Нужно исправить это минимально и production-oriented:

- без отдельного migration-сервиса;
- без redesign deploy topology;
- без heavy migration framework;
- с одинаковой семантикой для `local/dev` и `server/prod-like`.

Также нужно учесть фактическую зависимость схем:

- `aero-identity` владеет таблицами `users`, `user_sessions`, `user_devices`, `user_friendships` и др.;
- `aero-chat` использует свои таблицы в той же PostgreSQL БД, но его schema SQL ссылается на identity-owned relation'ы.

## Решение

### 1. Внутрипроцессный bootstrap выполняется самим сервисом до HTTP startup

`aero-identity` и `aero-chat` обязаны применять свою SQL-схему до того, как сервис начнёт обслуживать HTTP-запросы.

Порядок старта внутри процесса:

1. загрузка конфигурации;
2. создание logger;
3. подключение к PostgreSQL;
4. database schema bootstrap;
5. инициализация доменных зависимостей;
6. запуск HTTP-сервера.

Если bootstrap не прошёл, сервис завершает запуск с явной ошибкой.

### 2. Источником миграций остаются уже существующие SQL-файлы

В качестве source of truth используются текущие упорядоченные `.sql`-файлы в:

- `services/aero-identity/db/schema`
- `services/aero-chat/db/schema`

Сами SQL-файлы встраиваются в бинарь через `embed`, чтобы:

- release image не зависел от внешних mounted-файлов;
- local/dev и production использовали одинаковый набор migrations;
- оператору не нужно было отдельно копировать schema assets на VPS.

### 3. Состояние bootstrap хранится в PostgreSQL

В БД используется отдельная таблица `schema_migrations`.

Она хранит:

- имя сервиса;
- имя SQL-файла;
- checksum содержимого;
- время применения.

Таблица является общей для всех сервисов, но migration state разделяется по `service_name`.

### 4. Применение выполняется детерминированно и идемпотентно

Runner:

- читает `.sql`-файлы в лексикографическом порядке;
- сравнивает их с уже применённым состоянием в `schema_migrations`;
- применяет только отсутствующие migrations;
- повторный запуск не переисполняет уже применённые файлы;
- если ранее применённый файл изменился, bootstrap завершается ошибкой checksum mismatch.

Таким образом runtime не маскирует drift и не делает вид, что изменённая старая migration безопасна.

### 5. Для конкурирующего старта используется один PostgreSQL advisory lock

Bootstrap выполняется под общим transaction-scoped `pg_advisory_xact_lock`.

Это даёт минимальную и достаточную защиту для текущей single-server модели:

- одновременно только один сервис может применять schema bootstrap;
- повторные рестарты не приводят к гонке между двумя процессами;
- не требуется отдельный coordinator или внешний migration job.

### 6. `aero-chat` явно ждёт identity bootstrap

Поскольку SQL-схема `aero-chat` ссылается на identity-owned таблицы, `aero-chat` не пытается bootstrap'ить свои relation'ы поверх пустой БД без готового identity foundation.

Для этого `aero-chat` ждёт появления обязательной migration
`aero-identity:000002_social_graph_foundation.sql`
в `schema_migrations` в пределах ограниченного startup timeout.

Следствия:

- если `aero-chat` стартует раньше `aero-identity`, он не создаёт частичную или некорректную схему;
- если `aero-identity` успевает применить bootstrap, `aero-chat` затем продолжает свой bootstrap автоматически;
- если identity bootstrap не произошёл за ожидаемое время, `aero-chat` падает с явной startup-ошибкой.

### 7. Operator contract для first launch не требует ручного `psql`

Нормальный first-launch flow теперь выглядит так:

- оператор поднимает compose runtime;
- `aero-identity` и `aero-chat` сами применяют schema bootstrap;
- после успешного bootstrap сервисы становятся ready.

Ручной `psql` больше не является обязательным штатным шагом bootstrap.

## Последствия

### Положительные

- Пустая PostgreSQL БД больше не ломает normal first launch.
- Local/dev и production runtime получают одинаковую семантику schema bootstrap.
- Release image остаётся самодостаточным без отдельного schema volume.
- Startup failures становятся явными и лучше диагностируются по логам.
- Исправление остаётся локальным и не перестраивает deploy topology.

### Отрицательные

- Внутри сервисов появляется ещё один startup-step до запуска HTTP.
- `aero-chat` получает явную runtime-зависимость от завершённого identity bootstrap на общей БД.
- Текущий механизм рассчитан на существующую ordered-SQL модель и не пытается решать сложные branching migration сценарии.

### Ограничения

- Это не отдельная универсальная migration platform.
- Изменение не вводит cross-service schema ownership beyond already existing shared PostgreSQL model.
- Для крупных schema-rewrite, data backfill или zero-downtime migration policy позже может потребоваться отдельный ADR.
- Existing SQL-файлы после применения нельзя бесконтрольно переписывать, иначе checksum drift остановит startup.

## Альтернативы

### 1. Оставить ручной `psql` как штатный шаг первого запуска

Не выбрано, потому что это уже подтвердилось как реальный production footgun и противоречит цели воспроизводимого bootstrap.

### 2. Вынести миграции в отдельный сервис или job

Не выбрано, потому что для текущего corrective slice это увеличивает scope, operational complexity и не нужно для single-server runtime.

### 3. Подключить тяжёлый migration framework

Не выбрано, потому что текущему репозиторию уже достаточно ordered SQL-файлов, а задача требует узкого исправления без лишнего infrastructural redesign.
