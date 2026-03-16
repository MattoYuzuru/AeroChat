# ADR-012: Foundation для gateway / BFF как единой edge-точки входа

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После завершения foundation для identity, social graph, direct chat, read receipts, typing и presence
проекту нужен следующий изолированный slice:
минимальный, production-oriented foundation для `aero-gateway` как единой внешней точки входа в текущие backend slices.

Этот этап должен:

- превратить `aero-gateway` из пустого health-only сервиса в реальный thin edge;
- дать frontend и будущим внешним клиентам один внешний entrypoint;
- сохранить domain ownership внутри `aero-identity` и `aero-chat`;
- не превращать gateway в god-service;
- не внедрять websocket/event delivery, deploy semantics, groups, rtc, media и crypto logic;
- сохранить transport proto-first и typed через ConnectRPC.

Также важно не нарушить уже принятые ограничения:

- `aero-identity` остаётся владельцем identity, sessions, block list и social graph;
- `aero-chat` остаётся владельцем direct chats, messages, read receipts, typing и presence;
- gateway может заниматься только edge transport concerns, auth propagation и минимальной orchestration;
- frontend-specific application logic не внедряется в backend gateway на этом этапе.

## Решение

### 1. Роль gateway

`aero-gateway` фиксируется как **single external edge entrypoint** для текущих backend slices.

Gateway отвечает за:

- приём внешних ConnectRPC запросов;
- явную маршрутизацию в downstream services;
- минимальную transport orchestration;
- проксирование auth/session заголовков;
- edge-level health и readiness.

Gateway не отвечает за:

- доменную валидацию identity или chat;
- хранение domain state;
- session ownership;
- social graph, chat, receipts, typing или presence semantics;
- websocket/event fan-out.

### 2. Внешний API surface

На этом этапе gateway публикует typed ConnectRPC surface:

- `aerochat.identity.v1.IdentityService`
- `aerochat.chat.v1.ChatService`

Через эти сервисы наружу доступны уже реализованные capability slices:

- register;
- login;
- logout current session;
- get/update current profile;
- list devices/sessions;
- revoke session/device;
- list blocked users;
- block/unblock user;
- social graph methods;
- direct chat methods;
- read receipts methods;
- typing methods;
- presence methods.

Gateway не вводит новый transport contract и не дублирует proto-модель downstream сервисов.

### 3. Downstream wiring

Gateway конфигурируется явными downstream endpoint’ами:

- `aero-identity`
- `aero-chat`

Для вызовов используются typed ConnectRPC clients.

Маршрутизация остаётся явной:

- identity-методы идут только в `aero-identity`;
- chat-методы идут только в `aero-chat`.

На этом этапе не добавляются:

- кросс-доменные агрегированные read models;
- frontend-specific response shaping;
- orchestration, которая переносит domain ownership в gateway.

### 4. Auth/session propagation

Gateway не валидирует session token самостоятельно и не дублирует auth logic downstream сервисов.

Принята модель:

- внешний клиент отправляет bearer session token в gateway;
- gateway явно проксирует `Authorization` header в нужный downstream;
- downstream service остаётся source of truth для auth/session validation и permission checks;
- register/login возвращают downstream auth payload без дополнительной gateway-семантики.

Это сохраняет единую модель ownership и не требует переносить session logic в edge layer раньше времени.

### 5. Health и readiness

Health gateway остаётся process-level.

Readiness gateway становится dependency-aware:

- gateway считается ready только если доступны `aero-identity` и `aero-chat`;
- проверка выполняется через downstream `Ping` calls;
- отказ хотя бы одного downstream делает gateway `not_ready`.

Это решение выбрано как минимальное и достаточное для edge entrypoint без внедрения deployment-specific логики.

### 6. CORS policy

Gateway получает минимальную конфигурируемую CORS-обвязку для будущего web client.

На этом этапе:

- CORS выключен по умолчанию, если список origin не задан;
- разрешаются только явно перечисленные origins;
- поддерживается preflight для ConnectRPC HTTP вызовов;
- CORS остаётся edge concern и не проникает в downstream domain services.

### 7. Ограничения этапа

В рамках этого slice не реализуются:

- websocket/event delivery;
- realtime fan-out;
- groups;
- rtc/calls;
- media attachments;
- deploy topology;
- frontend BFF-агрегации и view-specific contracts.

## Последствия

### Положительные

- Появляется единая внешняя точка входа для текущего backend foundation.
- Downstream services сохраняют ownership над своими доменами.
- Frontend и другие клиенты получают стабильный typed edge surface.
- Gateway readiness начинает отражать реальную готовность внешнего entrypoint.
- Архитектура остаётся расширяемой для следующих edge slices.

### Отрицательные

- Появляется дополнительный сетевой hop между внешним клиентом и downstream сервисами.
- Gateway добавляет отдельный runtime-конфиг и отдельную точку наблюдения.
- На этом этапе gateway ещё не даёт frontend-specific aggregation value beyond routing/orchestration.

### Ограничения

- Gateway нельзя использовать как место переноса domain logic.
- Нельзя смешивать этот slice с websocket transport и realtime delivery.
- Нельзя добавлять в gateway ownership над auth, social graph или chat state.
- Нельзя превращать gateway в универсальный orchestration layer для всех будущих фич без отдельных ADR.

## Альтернативы

### 1. Оставить клиентов ходить напрямую в `aero-identity` и `aero-chat`

Не выбрано, потому что проекту нужна единая внешняя edge-точка входа и место для transport concerns будущего web client.

### 2. Сразу сделать REST BFF с отдельными frontend-ориентированными DTO

Не выбрано, потому что это преждевременно меняет transport model, дублирует typed contracts и расширяет scope без реальной необходимости.

### 3. Перенести auth/session validation в gateway

Не выбрано, потому что это размывает domain ownership `aero-identity`, дублирует уже существующую модель и преждевременно превращает gateway в более тяжёлый сервис.
