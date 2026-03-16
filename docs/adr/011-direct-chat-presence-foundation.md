# ADR-011: Foundation для presence state в direct 1:1 чатах

- Статус: Accepted
- Дата: 2026-03-21

## Контекст

После завершения foundation для direct 1:1 чатов, read receipts и typing проекту нужен следующий изолированный slice:
минимальная, production-oriented база для presence state внутри `aero-chat`.

Этот этап должен:

- разрешить пользователю обновлять heartbeat своего текущего presence state в direct chat;
- поддерживать явную очистку presence state;
- автоматически истекать presence state по TTL;
- уважать privacy-флаг `presence_enabled` из identity;
- не смешивать presence с typing, message history, websocket delivery и global directory;
- не вводить group presence, RTC presence, audit/history и analytics;
- сохранить разделение между `aero-chat` и `aero-identity`.

Также важно не нарушить уже принятые ограничения:

- `aero-chat` остаётся владельцем chat-facing presence orchestration только в контексте direct chat;
- `aero-identity` остаётся владельцем privacy-флагов пользователя;
- presence state остаётся ephemeral и не попадает в историю сообщений;
- transport остаётся proto-first и thin;
- realtime delivery и websocket/event streaming не внедряются в рамках этого этапа.

## Решение

### 1. Семантика presence state

Presence state рассматривается как краткоживущее ephemeral-состояние участника direct chat.

На этом этапе пользователь может:

- выполнить `SetDirectChatPresenceHeartbeat`;
- выполнить `ClearDirectChatPresence`;
- получить текущее видимое presence state через `GetDirectChat` и ответы presence-методов.

Presence state:

- не является частью message history;
- не хранится как аудит всех heartbeat events;
- живёт только в пределах TTL;
- подходит для будущего realtime fan-out, но realtime-механизм в этом PR не реализуется.

### 2. Граница сервиса

Presence foundation реализуется внутри сервисной границы `aero-chat`.

`aero-chat` отвечает за:

- проверку membership в direct chat;
- постановку и очистку presence state;
- чтение текущего видимого presence state;
- скрытие presence state по privacy policy.

`aero-identity` остаётся владельцем privacy-флага `presence_enabled`.

Использование identity-данных в `aero-chat` допускается только через узкую read-only boundary:
chat service читает флаг из identity-owned таблиц, но не изменяет его и не управляет lifecycle privacy settings.

### 3. Privacy policy

Presence visibility подчиняется privacy-флагу пользователя `presence_enabled`.

Следствия:

- если пользователь отключил presence visibility, новый heartbeat не должен публиковаться как видимое состояние;
- если у пользователя уже есть активное ephemeral presence state, оно не должно раскрываться другому участнику при выключенном флаге;
- собственный presence state пользователя с выключенным флагом также не возвращается как активное видимое состояние;
- `ClearDirectChatPresence` остаётся допустимой операцией независимо от privacy-флага.

Таким образом privacy-флаг управляет внешней видимостью presence state и не позволяет считать скрытое состояние продуктово доступным сигналом.

### 4. Persistence model

Для foundation используется Redis как отдельный ephemeral state layer.

Redis хранит presence state по паре:

- `chat_id`
- `user_id`

Запись содержит минимальные поля:

- `heartbeat_at`
- `expires_at`

и сама удаляется через TTL.

Эта модель выбрана как минимальная и достаточная для:

- корректной auto-expire semantics;
- отделения presence от message history;
- будущего realtime fan-out без миграции persistent SQL-модели.

На этом этапе не вводятся:

- SQL-таблицы для presence;
- global presence directory;
- group presence;
- история presence transitions.

### 5. Last seen policy

На этом этапе **не** публикуется `last_seen`.

Причины:

- `last_seen` уже является полупостоянной user-facing семантикой, а не чистым ephemeral state;
- она требует отдельной privacy policy по точности, деградации и скрытию;
- для текущего slice достаточно минимального online-style heartbeat foundation.

Если продукту позже понадобится privacy-safe `last_seen`, для этого потребуется отдельное решение и отдельный ADR.

### 6. API и выдача состояния

Chat API расширяется методами:

- `SetDirectChatPresenceHeartbeat`
- `ClearDirectChatPresence`

Для минимизации scope текущее состояние возвращается как отдельная структура `DirectChatPresenceState`, а не как расширение message rows.

Presence state возвращается в:

- `GetDirectChat`
- `SetDirectChatPresenceHeartbeat`
- `ClearDirectChatPresence`

Структура содержит:

- собственный presence indicator пользователя;
- presence indicator второго участника только если у него включён `presence_enabled`.

### 7. Access policy

Presence-related операции доступны только участникам соответствующего direct chat.

Следствия:

- нельзя выставить presence heartbeat в чужом чате;
- нельзя очистить presence state в чужом чате;
- нельзя увидеть presence state чужого чата;
- non-participant не получает состояние даже если Redis-ключ существует;
- group semantics не добавляются.

## Последствия

### Положительные

- Появляется минимальный, но реальный foundation для direct chat presence state.
- Ephemeral модель согласуется с архитектурной ролью Redis из ADR-001 и ADR-004.
- Privacy settings из identity становятся доменно значимыми и для presence slice.
- База подходит для дальнейшей realtime-доставки без преждевременного transport overhaul.

### Отрицательные

- На этом этапе нет websocket/event delivery и клиенту нужен явный запрос состояния.
- Нет `last_seen`, истории transitions и advanced analytics.
- Если privacy-флаг выключается после уже выставленного presence state, запись может кратко существовать в Redis до TTL или явной очистки, но policy-слой всё равно скрывает её наружу.

### Ограничения

- Нельзя считать этот slice реализацией global presence.
- Нельзя использовать текущую модель как foundation для group presence без нового ADR.
- Нельзя смешивать presence slice с typing, RTC или delivery semantics.
- Нельзя нарушать privacy-флаг ради удобства UX.

## Альтернативы

### 1. Хранить presence state в PostgreSQL

Не выбрано, потому что presence является ephemeral-состоянием, а SQL-модель в этом случае получила бы лишнюю TTL-логику и неестественную очистку.

### 2. Публиковать `last_seen` уже на foundation-этапе

Не выбрано, потому что это расширяет scope slice и требует отдельной privacy semantics.

### 3. Делать presence только в памяти процесса

Не выбрано, потому что это ухудшает воспроизводимость, не переживает горизонтальное расширение и слишком плохо готовит foundation к будущему realtime.
