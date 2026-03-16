# ADR-010: Foundation для typing state в direct 1:1 чатах

- Статус: Accepted
- Дата: 2026-03-20

## Контекст

После завершения foundation для direct 1:1 чатов и read receipts проекту нужен следующий изолированный slice:
минимальная, production-oriented база для typing state внутри `aero-chat`.

Этот этап должен:

- разрешить пользователю выставлять текущее typing state для direct chat;
- поддерживать явный `clear` typing state;
- автоматически истекать typing state через короткий TTL;
- уважать privacy-флаг `typing_visibility_enabled` из identity;
- не смешивать typing с presence, drafts, delivery semantics и realtime transport;
- не вводить group typing, websocket streaming и audit/history модель;
- сохранить разделение между `aero-chat` и `aero-identity`.

Также важно не нарушить уже принятые ограничения:

- `aero-chat` остаётся владельцем chat domain и typing orchestration внутри чата;
- `aero-identity` остаётся владельцем privacy-флагов пользователя;
- typing state остаётся ephemeral и не попадает в message history;
- transport остаётся proto-first и thin;
- realtime delivery и presence не внедряются в рамках этого этапа.

## Решение

### 1. Семантика typing state

Typing state рассматривается как краткоживущее ephemeral-состояние участника direct chat.

На этом этапе пользователь может:

- выполнить `SetDirectChatTyping`;
- выполнить `ClearDirectChatTyping`;
- получить текущее видимое typing state через `GetDirectChat` и ответы typing-методов.

Typing state:

- не является частью истории сообщений;
- не хранится как аудит всех typing events;
- живёт только в пределах короткого TTL;
- подходит для будущего realtime fan-out, но realtime-механизм в этом PR не реализуется.

### 2. Граница сервиса

Typing foundation реализуется внутри сервисной границы `aero-chat`.

`aero-chat` отвечает за:

- проверку membership в direct chat;
- постановку и очистку typing state;
- чтение текущего typing state;
- скрытие typing state по privacy policy.

`aero-identity` остаётся владельцем privacy-флага `typing_visibility_enabled`.

Использование identity-данных в `aero-chat` допускается только через узкую read-only boundary:
chat service читает флаг из identity-owned таблиц, но не изменяет его и не управляет lifecycle privacy settings.

### 3. Privacy policy

Typing visibility подчиняется privacy-флагу пользователя `typing_visibility_enabled`.

Следствия:

- если пользователь отключил typing visibility, новое typing state не должно публиковаться как видимое состояние;
- если у пользователя есть уже активное ephemeral typing state, оно не должно раскрываться другому участнику при выключенном флаге;
- собственный typing state пользователя с выключенным флагом также не возвращается как активное видимое состояние;
- `ClearDirectChatTyping` остаётся допустимой операцией независимо от privacy-флага.

Таким образом privacy-флаг управляет внешней видимостью typing state и не позволяет считать скрытое состояние видимым продуктовым сигналом.

### 4. Persistence model

Для foundation используется Redis как отдельный ephemeral state layer.

Redis хранит typing state по паре:

- `chat_id`
- `user_id`

Запись содержит минимальные поля:

- `updated_at`
- `expires_at`

и сама удаляется через TTL.

Эта модель выбрана как минимальная и достаточная для:

- корректной auto-expire semantics;
- отделения typing от message history;
- будущего realtime fan-out без миграции persistent SQL-модели.

На этом этапе не вводятся:

- SQL-таблицы для typing;
- presence model;
- drafts;
- group typing;
- история typing transitions.

### 5. API и выдача состояния

Chat API расширяется методами:

- `SetDirectChatTyping`
- `ClearDirectChatTyping`

Для минимизации scope текущее состояние возвращается как отдельная структура `DirectChatTypingState`, а не как расширение message rows.

Typing state возвращается в:

- `GetDirectChat`
- `SetDirectChatTyping`
- `ClearDirectChatTyping`

Структура содержит:

- собственный typing indicator пользователя;
- typing indicator второго участника только если у него включён `typing_visibility_enabled`.

### 6. Access policy

Typing-related операции доступны только участникам соответствующего direct chat.

Следствия:

- нельзя выставить typing state в чужом чате;
- нельзя увидеть typing state чужого чата;
- non-participant не получает состояние даже если Redis-ключ существует;
- group semantics не добавляются.

## Последствия

### Положительные

- Появляется минимальный, но реальный foundation для typing state.
- Ephemeral модель согласуется с архитектурной ролью Redis из ADR-001 и ADR-004.
- Privacy settings из identity становятся доменно значимыми и для typing slice.
- База подходит для дальнейшей realtime-доставки без преждевременного transport overhaul.

### Отрицательные

- На этом этапе нет websocket/event delivery и клиенту нужен явный запрос состояния.
- Нет истории transitions и advanced analytics.
- Если privacy-флаг выключается после уже выставленного typing state, запись может кратко существовать в Redis до TTL или явной очистки, но policy-слой всё равно скрывает её наружу.

### Ограничения

- Нельзя считать этот slice реализацией presence.
- Нельзя использовать typing state как draft recovery.
- Нельзя распространять текущую модель на group chats без нового ADR.
- Нельзя нарушать privacy-флаг ради удобства UX.

## Альтернативы

### 1. Хранить typing state в PostgreSQL

Не выбрано, потому что typing является ephemeral-состоянием, а SQL-модель в этом случае получила бы лишнюю TTL-логику и неестественную очистку.

### 2. Делать typing только в памяти процесса

Не выбрано, потому что это ухудшает воспроизводимость, не переживает горизонтальное расширение и слишком плохо готовит foundation к будущему realtime.

### 3. Реализовать typing сразу через websocket/event streaming

Не выбрано, потому что это расширяет scope slice и смешивает foundation состояния с transport delivery.
