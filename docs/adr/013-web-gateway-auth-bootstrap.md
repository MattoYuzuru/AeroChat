# ADR-013: Web gateway auth bootstrap в `apps/web`

- Статус: Accepted
- Дата: 2026-03-23

## Контекст

После завершения foundation для `aero-gateway` проекту нужен следующий изолированный frontend slice:
минимальный, production-oriented bootstrap для `apps/web`, который начинает работать как реальный web client, но при этом не выходит за рамки уже принятых backend границ.

Этот этап должен:

- использовать `aero-gateway` как единственную backend edge-точку входа;
- поднять текущую сессию при загрузке приложения;
- дать отдельные экраны login и register;
- дать защищённый app shell после успешной аутентификации;
- дать чтение и обновление текущего профиля;
- подготовить базовую навигацию под следующие frontend slices;
- не смешивать auth bootstrap с полноценным chat UI, social graph UI, websocket delivery, desktop window system и deploy semantics.

Также важно не нарушить уже принятые ограничения:

- `aero-gateway` остаётся единственной внешней точкой входа согласно ADR-012;
- frontend shell развивается итерационно согласно ADR-005;
- auth ownership остаётся в `aero-identity` согласно ADR-006;
- sessionStorage не объявляется финальной security-моделью и не подменяет будущую edge auth / cookie-модель;
- scope PR остаётся изолированным и не тянет friends, chats, rtc и PWA-polish.

## Решение

### 1. Роль `apps/web`

`apps/web` фиксируется как первый реальный frontend bootstrap для AeroChat.

На этом этапе web-клиент отвечает за:

- публичные auth-маршруты;
- bootstrap текущей сессии;
- защищённый shell после аутентификации;
- чтение и обновление текущего профиля;
- базовую навигацию под будущие разделы.

`apps/web` не отвечает за:

- прямое обращение к `aero-identity` или `aero-chat`;
- chat timeline UI;
- friends UI;
- websocket/event delivery;
- desktop window management;
- deploy orchestration.

### 2. Backend edge policy

Frontend делает все backend-вызовы только через `aero-gateway`.

Следствия:

- web-клиент использует только gateway base URL;
- identity и chat service URLs не зашиваются во frontend;
- typed client слой знает только gateway-методы текущего slice;
- downstream ownership не переносится во frontend и не обходится напрямую.

### 3. Session bootstrap

На этом этапе принимается минимальная session bootstrap модель:

- bearer session token хранится в `sessionStorage`;
- доступ к storage изолируется за маленьким интерфейсом;
- при старте приложения frontend читает токен и вызывает `GetCurrentProfile` через gateway;
- успешный ответ гидрирует текущую authenticated session;
- `unauthenticated`-ответ очищает локальный токен и переводит приложение в public auth flow;
- recoverable gateway failures отображаются как отдельное bootstrap error state с возможностью retry.

Эта модель выбрана как минимальная и достаточная для текущего slice.

Она не считается финальной security-моделью и не препятствует будущему переходу на cookie-based edge auth или иной session transport.

### 4. Route structure

На этом этапе фиксируется следующая route structure:

- `/login`
- `/register`
- `/app`
- `/app/profile`
- `/app/chats`
- `/app/people`
- `/app/settings`

Правила:

- public routes доступны только в anonymous flow;
- authenticated session редиректится в `/app/profile`;
- protected routes требуют успешного bootstrap текущей сессии;
- неизвестный маршрут приводит к auth- или app-entry в зависимости от текущего session state.

### 5. Protected shell semantics

После успешной аутентификации frontend показывает минимальный app shell.

Shell содержит:

- верхний bar с текущим пользователем и logout action;
- базовую навигацию по будущим разделам;
- центральную защищённую зону контента;
- profile flow как первый реальный дочерний экран.

Desktop window system и multi-window UX на этом этапе не вводятся.
Shell остаётся лёгким и совместимым с дальнейшей Frutiger Aero-эволюцией.

### 6. Profile flow

Первым защищённым product slice становится current profile flow.

На этом этапе пользователь может:

- получить текущий профиль через bootstrap и явный refresh;
- обновить базовые editable fields:
  - `nickname`
  - `bio`
  - `timezone`
  - `profile_accent`
  - `status_text`
  - `birthday`
  - `country`
  - `city`
  - `avatar_url`

Privacy-флаги, devices/sessions UI, block list UI и social graph UI остаются за пределами этого PR.

### 7. Typed gateway client

Frontend получает небольшой typed API client слой под gateway identity methods текущего slice:

- `Register`
- `Login`
- `LogoutCurrentSession`
- `GetCurrentProfile`
- `UpdateCurrentProfile`

Клиент:

- работает через fetch;
- использует Connect JSON surface gateway;
- централизует обработку bearer token и gateway errors;
- не размазывает transport детали по React-компонентам.

### 8. Testing policy

Для slice добавляются практичные frontend unit tests на:

- session storage abstraction;
- current session bootstrap;
- gateway client request/error semantics.

Тяжёлый UI integration harness на этом этапе не обязателен.

## Последствия

### Положительные

- `apps/web` перестаёт быть статичным shell showcase и становится реальным frontend bootstrap.
- Архитектурная граница single edge entrypoint закрепляется не только в backend, но и во frontend.
- Появляется минимальный, но расширяемый auth flow под следующие web slices.
- Session bootstrap и protected route pattern создают основу для дальнейшего shell-развития.

### Отрицательные

- `sessionStorage` остаётся компромиссным временным решением до отдельного edge auth slice.
- На этом этапе UI ещё не покрывает devices/sessions, block list и social graph.
- Gateway client пока охватывает только identity-методы текущего frontend slice.

### Ограничения

- Нельзя добавлять прямые вызовы `aero-identity` или `aero-chat` из frontend.
- Нельзя считать этот PR реализацией chat UI, friends UI, websocket delivery или desktop shell.
- Нельзя объявлять `sessionStorage` финальной security-моделью.
- Нельзя смешивать текущий slice с deploy, passkeys, Turnstile и realtime transport.

## Альтернативы

### 1. Ходить из frontend напрямую в `aero-identity`

Не выбрано, потому что это ломает ADR-012 и размывает роль gateway как единой edge-точки входа.

### 2. Сразу делать frontend-specific BFF aggregation

Не выбрано, потому что на этом этапе достаточно thin gateway surface без новых DTO и без переноса domain ownership.

### 3. Сразу переходить на cookie-based auth

Не выбрано, потому что для текущего slice важнее минимальный и изолированный bootstrap, а полноценная edge auth модель требует отдельного решения и отдельного PR.
