# ADR-006: Foundation для identity, password auth и device sessions

- Статус: Accepted
- Дата: 2026-03-16

## Контекст

После завершения Foundation phase проекту нужен следующий изолированный slice:
безопасная и расширяемая база аккаунтов, аутентификации и устройств.

Этот этап должен:

- ввести неизменяемый пользовательский логин;
- заложить минимальную password auth модель без security theater;
- подготовить multi-device foundation;
- не смешивать identity с chat, friends, groups, rtc и crypto implementation;
- оставить пространство для будущих passkeys, E2EE device identity и social graph.

Также важно заранее зафиксировать ограничения:

- публичный user directory не вводится;
- поиск по произвольным полям не вводится;
- passkeys пока не реализуются;
- E2EE и device keys пока не реализуются;
- сервер не должен логировать пароли, токены и иной чувствительный material.

## Решение

### 1. Идентичность пользователя

Identity foundation строится вокруг аккаунта с неизменяемым `login` и изменяемым `nickname`.

`login`:

- уникален в рамках системы;
- нормализуется в lower-case;
- после регистрации не меняется;
- используется как точный идентификатор пользователя для будущих social actions.

`nickname`:

- может изменяться владельцем профиля;
- не считается уникальным ключом;
- используется как display field.

### 2. Базовый профиль

На первом этапе профиль пользователя хранит только базовые account/profile fields:

- `id`
- `login`
- `nickname`
- `avatar_url`
- `bio`
- `timezone`
- `profile_accent`
- `status_text`
- `birthday`
- `country`
- `city`

Также в модель сразу включаются privacy flags:

- `read_receipts_enabled`
- `presence_enabled`
- `typing_visibility_enabled`

И foundation-поле статуса key backup:

- `key_backup_status`

### 3. Password auth foundation

На этом этапе принимается минимальная, но production-oriented password auth модель:

- пароль хранится только как `Argon2id` hash;
- для каждого хеша используется отдельная случайная salt;
- plaintext password не хранится и не логируется;
- transport handlers не содержат password hashing logic.

Password auth рассматривается как временно основной login method до отдельного решения по passkeys.

### 4. Device и session model

Identity foundation сразу поддерживает модель:

- у пользователя есть устройства;
- у устройства есть человекочитаемая метка;
- у устройства есть timestamps создания, последнего использования и отзыва;
- у устройства может быть несколько сессий;
- у каждой сессии есть собственный identifier и opaque session token.

Session token:

- генерируется через secure random;
- не хранится на сервере в открытом виде;
- на сервере хранится только hash токенного секрета;
- используется только для аутентификации текущей сессии.

Это решение не считается device crypto identity и не подменяет будущую E2EE-модель.

### 5. Block list и privacy

Identity domain на этом этапе хранит relation block list:

- пользователь может блокировать другого пользователя по точному `login`;
- relation хранится отдельно;
- foundation не включает friend system и не вводит user discovery.

### 6. Persistence

Для identity foundation используется PostgreSQL.

Минимальный набор таблиц:

- `users`
- `user_password_credentials`
- `user_devices`
- `user_sessions`
- `user_blocks`

Доменные операции реализуются через явные SQL-запросы и типизированный sqlc layer.

### 7. Transport

Identity API фиксируется через protobuf и ConnectRPC.

Transport layer:

- остаётся тонким;
- извлекает auth context текущей сессии;
- делегирует доменные решения application/service слою;
- не хранит бизнес-логику внутри handlers.

## Последствия

### Положительные

- Появляется безопасная база аккаунтов и session lifecycle.
- Проект получает основу для multi-device.
- Фундамент для будущих passkeys и device-bound crypto остаётся открытым.
- Identity развивается отдельно от social graph и chat logic.

### Отрицательные

- Password auth требует дальнейшего развития: reset flow, rate limits, auditing.
- Session model пока минимальна и не включает refresh/rotation policies.
- Key backup фиксируется только как status foundation без crypto implementation.

### Ограничения

- Нельзя объявлять реализованным passkey flow.
- Нельзя считать текущую session model E2EE device model.
- Нельзя добавлять публичный поиск пользователей в рамках этого этапа.
- Нельзя смешивать identity foundation с friend/chat/group logic.

## Альтернативы

### 1. Делать identity сразу вместе с friend system

Не выбрано, потому что это смешивает два разных roadmap slice и расширяет scope PR.

### 2. Хранить session token в открытом виде

Не выбрано, потому что это ухудшает последствия утечки БД и не нужно для текущей модели.

### 3. Ждать passkeys и не делать password auth foundation

Не выбрано, потому что проекту нужен реальный и тестируемый способ аутентификации уже на этом этапе.
