# ADR-014: Web social graph bootstrap в `apps/web`

- Статус: Accepted
- Дата: 2026-03-24

## Контекст

После завершения web gateway auth bootstrap проекту нужен следующий изолированный frontend slice:
минимальный, production-oriented People flow в `apps/web`, который поднимает social graph возможности поверх уже
готовых backend-контрактов, но не смешивает их с direct chat UI, realtime и desktop window system.

Этот этап должен:

- использовать `aero-gateway` как единственную backend edge-точку входа;
- добавить защищённый маршрут `/app/people`;
- дать отправку friend request только по точному неизменяемому `login`;
- показать входящие заявки, исходящие заявки и текущих друзей;
- позволить accept, decline, cancel и remove friend;
- сохранить лёгкий shell и изолированное frontend-состояние people flow;
- не вводить public directory, fuzzy search, nickname discovery, websocket/realtime и direct chat thread UI.

Также важно не нарушить уже принятые ограничения:

- `aero-gateway` остаётся единственной внешней точкой входа согласно ADR-012;
- ownership social graph остаётся в `aero-identity` согласно ADR-007;
- будущий direct chat остаётся отдельным slice согласно ADR-008;
- frontend shell развивается итерационно согласно ADR-005;
- scope PR остаётся изолированным и не тянет block management UI, desktop windows и realtime transport.

## Решение

### 1. Роль `People` в `apps/web`

`/app/people` фиксируется как первый защищённый social graph экран в `apps/web`.

На этом этапе страница отвечает за:

- форму отправки friend request по точному `login`;
- чтение текущего состояния incoming requests;
- чтение текущего состояния outgoing requests;
- чтение текущего списка friends;
- явные actions accept, decline, cancel и remove.

Страница не отвечает за:

- публичный просмотр пользователей;
- поиск по nickname или иным profile fields;
- block management UI;
- создание direct chat;
- realtime-подписки и live updates.

### 2. Backend edge policy

Frontend делает все people-related backend-вызовы только через `aero-gateway`.

Следствия:

- `apps/web` использует только gateway base URL;
- frontend не знает URL `aero-identity` или `aero-chat`;
- typed client слой расширяется методами `IdentityService`, уже опубликованными gateway;
- transport детали Connect JSON централизуются в gateway client, а не размазываются по React-компонентам.

### 3. Route structure

На этом этапе route structure остаётся минимальной:

- `/app/people` — единственная точка входа в People slice;
- отдельные вложенные роуты для incoming/outgoing/friends не вводятся;
- неизвестные protected routes продолжают вести в app entry;
- `chats`, `settings` и desktop window system остаются вне scope этого PR.

Это решение выбрано как минимальное и достаточное для текущего slice без преждевременного усложнения shell-маршрутизации.

### 4. UI-семантика people flow

People UI строится вокруг strict exact-login policy.

Следствия:

- пользователь вручную вводит неизменяемый `login`;
- интерфейс не предлагает suggestions и не показывает public user directory;
- карточки incoming/outgoing/friend используют минимальные profile fields из уже существующего identity transport;
- успешные mutating actions не создают чат автоматически и не открывают chat UI.

### 5. Frontend state model

People state изолируется от auth state.

На этом этапе принимается следующая модель:

- auth context остаётся source of truth только для текущей сессии и токена;
- people data хранится в отдельном page-scoped hook/state;
- initial load выполняет явный fetch incoming/outgoing/friends через gateway;
- после mutating action выполняется повторный refresh people snapshot;
- UI может отслеживать отдельные loading/error состояния для initial load, send form и per-item action.

Эта модель выбрана как минимальная и достаточная для текущего slice.

Она не считается финальной cache/data-sync стратегией и не мешает будущему переходу на более развитую клиентскую модель,
если она действительно понадобится позже.

### 6. Loading, empty и error policy

People UI обязан явно различать:

- initial loading списка;
- recoverable gateway error при загрузке;
- пустые списки incoming/outgoing/friends;
- локальные ошибки mutating actions;
- локальный pending state для отправки новой заявки и item-level actions.

Это нужно, чтобы protected shell не выглядел как статичный placeholder и при этом не требовал тяжёлого UI framework.

### 7. Testing policy

Для slice добавляются практичные frontend tests на:

- gateway client request/response semantics для social graph методов;
- изолированную people state logic там, где это возможно без тяжёлого UI harness.

Полноценный browser-level UI integration harness в этом PR не обязателен.

## Последствия

### Положительные

- `apps/web` получает первый реальный social graph flow поверх уже готовых gateway-контрактов.
- Exact-login only политика закрепляется не только в backend, но и во frontend UX.
- People slice остаётся изолированным от auth state и не тащит за собой direct chat UI.
- Следующий PR с direct chat creation сможет опираться на уже готовый friends view.

### Отрицательные

- После mutating actions frontend делает повторную загрузку people snapshot, что добавляет лишние запросы по сравнению с
  более сложным optimistic state.
- На этом этапе нет realtime-обновлений, поэтому изменения видны только после явного refresh внутри page flow.
- Block management и chat creation остаются за пределами UI, хотя backend foundation уже существует.

### Ограничения

- Нельзя добавлять прямые вызовы `aero-identity` или `aero-chat` из frontend.
- Нельзя внедрять public user discovery или fuzzy search.
- Нельзя создавать direct chat автоматически после accept friend request.
- Нельзя смешивать этот slice с websocket/realtime transport и desktop window system.

## Альтернативы

### 1. Делать people UI сразу вместе с direct chat thread

Не выбрано, потому что это ломает изоляцию roadmap slice и смешивает social graph с chat lifecycle.

### 2. Добавить отдельные вложенные маршруты для каждого people-подраздела

Не выбрано, потому что для текущего минимального scope достаточно одного защищённого экрана с явными секциями.

### 3. Хранить people state внутри auth context

Не выбрано, потому что это размывает ответственность auth bootstrap и делает следующий frontend рост менее управляемым.
