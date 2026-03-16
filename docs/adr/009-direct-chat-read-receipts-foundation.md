# ADR-009: Foundation для read receipts в direct 1:1 чатах

- Статус: Accepted
- Дата: 2026-03-19

## Контекст

После завершения foundation для direct 1:1 чатов проекту нужен следующий изолированный slice:
минимальная, production-oriented база для read receipts внутри `aero-chat`.

Этот этап должен:

- разрешить пользователю помечать direct chat как прочитанный до конкретного `message_id`;
- хранить минимальное состояние read position на пользователя;
- уважать privacy-флаг `read_receipts_enabled` из identity;
- не смешивать read receipts с delivery semantics, presence, typing и realtime transport;
- не вводить group receipts, историю audit-событий и аналитические модели;
- сохранить разделение между `aero-chat` и `aero-identity`.

Также важно не нарушить уже принятые ограничения:

- `aero-chat` остаётся владельцем chat domain и message state;
- `aero-identity` остаётся владельцем privacy flags пользователя;
- transport остаётся proto-first и thin;
- persistence остаётся явной и типизированной через PostgreSQL + sqlc;
- realtime delivery и websocket/event streaming не внедряются в рамках этого этапа.

## Решение

### 1. Семантика read receipts

Read receipt рассматривается как отдельное состояние прочтения, а не как подтверждение доставки.

На этом этапе пользователь может выполнить операцию `MarkDirectChatRead` и продвинуть свою read position до конкретного сообщения внутри direct chat.

Состояние прочтения:

- хранится отдельно от message delivery;
- относится к пользователю и direct chat;
- не является историей всех событий прочтения;
- обновляется только вперёд по message order;
- готово к будущей realtime-доставке, но не публикуется realtime-механизмом в этом PR.

### 2. Граница сервиса

Read receipts foundation реализуется внутри сервисной границы `aero-chat`.

`aero-chat` отвечает за:

- валидацию membership в direct chat;
- проверку принадлежности `message_id` конкретному чату;
- хранение и чтение read position;
- скрытие peer read state при выключенном privacy-флаге.

`aero-identity` остаётся владельцем privacy-флага `read_receipts_enabled`.

Использование identity-данных в `aero-chat` допускается только через узкую read-only boundary:
chat service читает флаг из identity-owned таблиц, но не изменяет его и не управляет lifecycle privacy settings.

### 3. Privacy policy

Read receipts подчиняются privacy-флагу пользователя `read_receipts_enabled`.

Следствия:

- если пользователь отключил read receipts, операция mark-as-read не должна создавать новое receipt state;
- если пользователь отключил read receipts, другой участник direct chat не должен видеть его read position;
- если у пользователя существует ранее сохранённая read position, но флаг отключён, это состояние не должно возвращаться наружу;
- собственный read state пользователя с выключенным флагом также не считается активным receipt state и не должен использоваться как источник для peer visibility.

Таким образом privacy-флаг управляет не только отображением, но и фактом генерации новых receipts.

### 4. Persistence model

Для foundation используется PostgreSQL-таблица `direct_chat_read_receipts`.

Таблица хранит одну canonical запись на пару:

- `chat_id`
- `user_id`

И минимальные поля позиции:

- `last_read_message_id`
- `last_read_message_created_at`
- `updated_at`

Эта модель выбрана как минимальная и достаточная для:

- privacy-aware выдачи текущего read state;
- монотонного продвижения read position;
- будущего realtime fan-out без смены базовой схемы хранения.

На этом этапе не вводятся:

- per-message delivery states;
- audit history read events;
- отдельные analytics tables;
- групповые read receipts.

### 5. API и выдача состояния

Chat API расширяется новым методом:

- `MarkDirectChatRead`

Для минимизации scope read state выдаётся как отдельная структура состояния direct chat, а не как массовое расширение всех message rows.

Read state возвращается в:

- `GetDirectChat`
- `MarkDirectChatRead`

Структура содержит:

- собственную read position пользователя;
- read position второго участника только если у него включены read receipts.

### 6. Access policy

Receipt-related операции доступны только участникам соответствующего direct chat.

Следствия:

- нельзя пометить read position в чужом чате;
- нельзя увидеть read state чужого чата;
- `message_id` должен принадлежать тому же `chat_id`;
- group semantics не добавляются.

## Последствия

### Положительные

- Появляется минимальный, но реальный foundation для read receipts.
- Privacy settings из identity становятся доменно значимыми и в chat slice.
- Схема хранения остаётся компактной и пригодной для sqlc.
- Модель можно позже расширить realtime-доставкой без пересборки базовой semantics.

### Отрицательные

- На этом этапе нет realtime fan-out и клиенту нужно явно запрашивать состояние.
- Нет истории transitions и advanced analytics.
- Если пользователь отключил read receipts после прошлых сохранений, старые записи остаются в storage и только скрываются policy-слоем.

### Ограничения

- Нельзя считать read receipts подтверждением доставки сообщения.
- Нельзя использовать этот slice как foundation для presence или typing.
- Нельзя распространять текущую модель на group chats без нового ADR.
- Нельзя нарушать privacy-флаг ради удобства отображения peer state.

## Альтернативы

### 1. Хранить read receipt на каждое сообщение

Не выбрано, потому что для foundation slice это избыточно по объёму данных и сложности без практической пользы.

### 2. Возвращать read state в каждой строке списка сообщений

Не выбрано, потому что это раздувает transport и storage projection раньше, чем появляется реальная потребность.

### 3. Делать read receipts только как realtime-эпhemeral состояние

Не выбрано, потому что проекту нужен воспроизводимый persistent foundation и корректное состояние для офлайн-пользователей.
