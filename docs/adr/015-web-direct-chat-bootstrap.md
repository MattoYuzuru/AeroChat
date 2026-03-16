# ADR-015: Web direct chat bootstrap в `apps/web`

- Статус: Accepted
- Дата: 2026-03-25

## Контекст

После завершения web social graph bootstrap проекту нужен следующий изолированный frontend slice:
минимальный, production-oriented direct chat flow в `apps/web`, который поднимает первый реальный chat UI поверх уже
готовых backend-контрактов, но не смешивает его с websocket/realtime, desktop window system, groups и media.

Этот этап должен:

- использовать `aero-gateway` как единственную backend edge-точку входа;
- добавить защищённый маршрут `/app/chats`;
- разрешить явное создание direct chat только из уже существующего friend relation;
- показать список текущих direct chats;
- показать минимальный thread выбранного direct chat;
- поддержать загрузку сообщений, отправку текста, delete-for-everyone и pin/unpin;
- сохранить лёгкий shell и изолированное frontend-состояние chat flow;
- не внедрять websocket/realtime updates, groups, media attachments, drafts и desktop windows.

Также важно не нарушить уже принятые ограничения:

- `aero-gateway` остаётся единственной внешней точкой входа согласно ADR-012;
- ownership friendship остаётся в `aero-identity` согласно ADR-007;
- ownership direct chats и message state остаётся в `aero-chat` согласно ADR-008;
- read receipts, typing и presence не требуют realtime-предположений и не должны тянуть websocket transport;
- frontend shell развивается итерационно согласно ADR-005.

## Решение

### 1. Роль `/app/chats` в `apps/web`

`/app/chats` фиксируется как первый защищённый direct chat экран в `apps/web`.

На этом этапе страница отвечает за:

- чтение списка direct chats текущего пользователя;
- выбор активного чата;
- явное создание direct chat из уже существующего friend action;
- чтение message history выбранного чата;
- отправку текстового сообщения;
- delete-for-everyone для сообщения автора;
- pin/unpin message state;
- явные loading / empty / error состояния.

Страница не отвечает за:

- websocket subscriptions и live updates;
- group chats;
- media attachments;
- drafts;
- desktop multi-window shell;
- advanced message rendering.

### 2. Backend edge policy

Frontend делает все chat-related backend-вызовы только через `aero-gateway`.

Следствия:

- `apps/web` использует только gateway base URL;
- frontend не знает URL `aero-chat` или `aero-identity`;
- typed client слой расширяется методами `ChatService`, уже опубликованными gateway;
- transport детали Connect JSON централизуются в gateway client, а не размазываются по React-компонентам.

### 3. Явное создание direct chat

Создание direct chat остаётся явным user action.

На этом этапе trigger происходит из friend card в `/app/people`:

- пользователь явно нажимает action открытия чата;
- frontend переходит в `/app/chats` с указанием конкретного friend target;
- `Chats` flow ищет существующий direct chat с этим пользователем;
- если chat уже существует, он открывается;
- если chat ещё не существует, frontend выполняет `CreateDirectChat` через gateway и затем открывает созданный thread.

Таким образом chat creation не становится скрытым side effect friendship lifecycle.

### 4. Route structure

На этом этапе route structure остаётся минимальной:

- `/app/chats` — единственная точка входа в direct chat slice;
- отдельные вложенные маршруты для списка и thread не вводятся;
- выбранный чат или friend target могут задаваться через query params;
- неизвестные protected routes продолжают вести в app entry.

Это решение выбрано как минимальное и достаточное для текущего slice без преждевременного усложнения shell-маршрутизации.

### 5. Frontend state model

Chats state изолируется и не встраивается в auth state или people state.

На этом этапе принимается следующая модель:

- auth context остаётся source of truth только для текущей сессии и токена;
- people flow остаётся отдельным page-scoped состоянием;
- `Chats` flow хранит отдельно:
  - список direct chats;
  - состояние выбранного чата;
  - message list выбранного чата;
  - локальные pending/error flags для composer и message actions;
- initial load делает явный fetch chat list через gateway;
- при выборе чата выполняется явная загрузка chat snapshot и messages;
- после mutating actions выполняется точечный refresh thread и chat list без глобального cache-framework.

Эта модель выбрана как минимальная и достаточная для текущего slice.

Она не считается финальной data-sync стратегией и не мешает будущему переходу на более развитую клиентскую модель, если
она действительно понадобится позже.

### 6. Thread UI policy

Thread UI остаётся минимальным и безопасным.

Следствия:

- поддерживаются только текстовые сообщения;
- message text рендерится безопасно и без raw HTML;
- без полноценного markdown-render pipeline текст может показываться как plain text с сохранением переносов;
- tombstone deletion отображается как отдельное состояние удалённого сообщения;
- pin/unpin показываются как минимальные message-level actions;
- read state может отображаться только в пассивной минимальной форме без realtime-претензий.

### 7. Loading, empty и error policy

Chats UI обязан явно различать:

- initial loading списка чатов;
- recoverable gateway error при загрузке списка;
- пустой список direct chats;
- loading / empty / error состояния выбранного thread;
- локальные ошибки composer и message actions;
- локальный pending state для send/delete/pin/unpin и create-chat action.

Это нужно, чтобы protected shell выглядел как реальное рабочее приложение, но не требовал тяжёлого UI framework.

### 8. Testing policy

Для slice добавляются практичные frontend tests на:

- gateway client request/response semantics для chat методов;
- chats state logic там, где это возможно без тяжёлого UI harness.

Полноценный browser-level UI integration harness в этом PR не обязателен.

## Последствия

### Положительные

- `apps/web` получает первый реальный direct chat flow поверх уже готовых gateway-контрактов.
- Friendship и chat lifecycle остаются разделёнными не только в backend, но и во frontend UX.
- Chats state остаётся изолированным от auth и people flow.
- Следующий PR с realtime updates сможет опираться на уже работающий chat list/thread foundation.

### Отрицательные

- После mutating actions frontend делает дополнительные reload-запросы вместо более сложного optimistic sync.
- Без websocket или polling user-facing state обновляется только по явным действиям и manual refresh.
- Thread UI пока не покрывает drafts, edit, media, groups и advanced markdown rendering.

### Ограничения

- Нельзя добавлять прямые вызовы `aero-chat` или `aero-identity` из frontend.
- Нельзя внедрять websocket/realtime transport в рамках этого slice.
- Нельзя создавать direct chat неявно при social graph событиях.
- Нельзя смешивать этот slice с groups, media attachments и desktop window system.

## Альтернативы

### 1. Делать direct chat UI сразу вместе с realtime transport

Не выбрано, потому что это ломает изоляцию roadmap slice и смешивает chat foundation с transport delivery.

### 2. Добавить отдельные вложенные маршруты для chat list и thread

Не выбрано, потому что для текущего минимального scope достаточно одного защищённого экрана с query-driven selection.

### 3. Хранить chats state внутри auth context или people flow

Не выбрано, потому что это размывает ответственность текущих slices и делает дальнейший frontend рост менее управляемым.
