# ADR-007: Foundation для social graph, friend requests и friendships

- Статус: Accepted
- Дата: 2026-03-17

## Контекст

После завершения identity foundation проекту нужен следующий изолированный slice:
минимальная, production-oriented база для социальных связей между пользователями.

Этот этап должен:

- добавить friend requests и friendships;
- использовать точный неизменяемый `login` как единственный способ добавления;
- не вводить публичный каталог пользователей;
- не вводить fuzzy search, nickname discovery и иные механики поиска;
- не создавать чаты автоматически;
- не смешивать social graph с group, rtc, media и crypto implementation.

Также важно сохранить уже принятые ограничения:

- `aero-chat` не должен получать responsibility за social graph на этом этапе;
- block list из identity foundation должен жёстко влиять на friend relations;
- transport должен оставаться proto-first и thin;
- persistence должна оставаться явной и типизированной через PostgreSQL + sqlc.

## Решение

### 1. Граница сервиса

Social graph foundation на этом этапе размещается внутри сервисной границы `aero-identity`.

Причины:

- friend flow завязан на неизменяемый `login`;
- block list уже живёт в `aero-identity`;
- chat creation пока не реализуется;
- отдельный сервис для social graph на этом этапе увеличил бы операционную и кодовую сложность без достаточной пользы.

Это не означает, что chat logic переносится в `aero-identity`.
`aero-chat` остаётся отдельной границей для следующего этапа, когда появится реальная chat domain model.

### 2. Модель social graph

На этапе foundation вводятся две relation-сущности:

- `user_friend_requests` для активных заявок в друзья;
- `user_friendships` для подтверждённых двусторонних связей.

Friend request:

- создаётся только по точному `login`;
- существует только как активная заявка;
- после accept/decline/cancel удаляется из active storage;
- в системе не хранится как длинная история статусов на этом этапе.

Friendship:

- хранится как симметричная связь между двумя пользователями;
- не создаёт чат автоматически;
- не несёт group/chat metadata;
- может быть удалена отдельной операцией remove friend.

### 3. Exact-login only policy

Добавление в друзья допускается только по точному неизменяемому `login`.

На этом этапе запрещены:

- публичный user directory;
- поиск по nickname;
- fuzzy search;
- suggestion engine;
- discovery по profile fields.

Сервер может делать lookup пользователя только как внутреннюю часть exact-login friend flow.

### 4. Block interaction policy

Block relation имеет приоритет над social graph.

Следствия:

- нельзя отправить friend request, если хотя бы одна сторона заблокировала другую;
- нельзя принять запрос, если между сторонами появился block;
- при установке block удаляются активные friend requests между парой;
- при установке block удаляется существующая friendship между парой.

Таким образом block не является только UI-флагом, а приводит social graph в согласованное состояние.

### 5. Persistence

Для social graph foundation используется PostgreSQL.

Хранение проектируется так, чтобы:

- не было двух активных запросов между одной и той же парой;
- симметричная friendship была представлена одной canonical pair-записью;
- SQL оставался явным и проверяемым;
- sqlc продолжал генерировать типизированный access layer.

### 6. Transport

Social graph API расширяет существующий `IdentityService` через protobuf и ConnectRPC методами:

- `SendFriendRequest`
- `AcceptFriendRequest`
- `DeclineFriendRequest`
- `CancelOutgoingFriendRequest`
- `ListIncomingFriendRequests`
- `ListOutgoingFriendRequests`
- `ListFriends`
- `RemoveFriend`

Transport layer:

- извлекает auth context текущей сессии;
- принимает exact login или пустой request body для list-операций;
- делегирует решения доменному service слою;
- не содержит бизнес-логики social graph.

## Последствия

### Положительные

- Появляется минимальный social graph foundation без преждевременного chat coupling.
- Exact-login модель остаётся строгой и приватной.
- Block list становится доменно значимой политикой, а не декоративным флагом.
- Следующий PR с 1:1 chat сможет опираться на готовую friendship foundation, но не обязан автоматически использовать её для chat creation.

### Отрицательные

- На этом этапе нет истории friend request status transitions.
- Нет discovery-UX и быстрого нахождения пользователей без точного `login`.
- Бизнес-операции social graph пока живут в том же сервисе, что и identity foundation, что потребует дисциплины при дальнейшем росте.

### Ограничения

- Нельзя считать social graph публичным каталогом пользователей.
- Нельзя автоматически создавать чат при подтверждении дружбы.
- Нельзя использовать social graph как основу для group semantics.
- Нельзя ослаблять block policy ради удобства friend flow.

## Альтернативы

### 1. Делать social graph сразу в `aero-chat`

Не выбрано, потому что chat creation ещё не реализуется, а friend flow на этом этапе теснее связан с `login` и block list из `aero-identity`.

### 2. Хранить friend request как status history table

Не выбрано, потому что для foundation slice достаточно active request storage без лишней историзации.

### 3. Сразу добавить поиск пользователей

Не выбрано, потому что это расширяет scope PR, ухудшает privacy model и противоречит roadmap текущего этапа.
