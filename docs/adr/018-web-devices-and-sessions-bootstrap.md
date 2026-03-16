# ADR-018: Web devices and sessions bootstrap в `apps/web`

- Статус: Accepted
- Дата: 2026-03-28

## Контекст

После завершения web settings and privacy bootstrap проекту нужен следующий изолированный frontend slice:
минимальный, production-oriented devices/sessions flow в `apps/web`, который поднимает уже существующие identity
capabilities поверх `aero-gateway`, но не смешивает их с passkeys, account deletion, notifications, realtime и desktop
window system.

Этот этап должен:

- использовать `aero-gateway` как единственную backend edge-точку входа;
- расширить уже существующий маршрут `/app/settings`, а не вводить новый account center;
- дать пользователю просмотр текущего списка устройств и связанных сессий;
- дать явный revoke device или revoke session;
- сохранить лёгкий glossy settings UI и page-scoped состояние без тяжёлого data framework;
- не смешивать текущий slice с auth transport redesign, passkeys, cross-tab forced logout handling и block management UI.

Также важно не нарушить уже принятые ограничения:

- `aero-gateway` остаётся единственной внешней точкой входа согласно ADR-012 и ADR-013;
- ownership devices, sessions и revoke semantics остаётся в `aero-identity` согласно ADR-006;
- existing settings route и visual direction остаются в рамках ADR-017;
- frontend shell продолжает развиваться итерационно и performance-first согласно ADR-005 и ADR-016;
- session token остаётся opaque bearer token и не должен становиться источником ad-hoc client-side auth redesign.

## Решение

### 1. Роль devices/sessions внутри `/app/settings`

`/app/settings` остаётся единственной точкой входа в settings flow и получает дополнительную секцию
`Устройства и сессии`.

На этом этапе страница отвечает за:

- загрузку devices snapshot через gateway;
- показ device cards и вложенных session rows;
- явный revoke для выбранного устройства или сессии;
- локальные loading / refresh / success / error / pending состояния;
- сохранение уже существующего privacy/preferences flow без регрессии.

Страница не отвечает за:

- passkeys;
- account deletion;
- notifications UI;
- block management UI;
- cross-tab logout fan-out;
- websocket/realtime delivery.

### 2. Route structure

Route structure остаётся минимальной:

- `/app/settings` продолжает быть single-route settings entrypoint;
- отдельные вложенные routes для `devices`, `privacy` или `sessions` не вводятся;
- shell navigation не перестраивается;
- `ProfilePage` и `SettingsPage` сохраняют уже принятую границу ответственности.

Это решение выбрано как минимальное и достаточное для текущего slice без преждевременного усложнения маршрутизации.

### 3. Backend edge policy

Frontend делает все devices/sessions-вызовы только через `aero-gateway`.

Следствия:

- `apps/web` использует только gateway base URL;
- frontend не знает URL `aero-identity`;
- typed client слой расширяется только уже существующими методами `IdentityService`:
  - `ListDevices`
  - `RevokeSessionOrDevice`
- новый transport contract, frontend-specific DTO и direct downstream calls не вводятся.

### 4. Frontend state model

Devices/sessions state изолируется и не встраивается в auth context.

На этом этапе принимается следующая модель:

- auth context остаётся source of truth только для bearer token и current profile snapshot;
- `/app/settings` использует отдельный page-scoped reducer/hook для devices snapshot;
- initial load устройств выполняется отдельно от profile refresh;
- после revoke frontend делает явный повторный fetch devices snapshot через gateway;
- item-level pending state хранится отдельно для device и session targets;
- complex cache, optimistic sync и shared cross-page store не вводятся.

Эта модель выбрана как минимальная и достаточная для текущего slice.

### 5. Current device/session semantics

Если текущая сессия или устройство нельзя определить чисто из уже существующего auth context, frontend не должен это
угадывать.

На текущем этапе:

- web auth bootstrap хранит bearer token и current profile;
- hydrated session/device snapshot в auth context не поддерживается;
- session token не используется как client-side contract для извлечения current session id;
- UI использует нейтральное описание вместо фейкового выделения `текущего устройства`.

Это сохраняет границу между auth bootstrap и devices management и не превращает opaque token в публичный frontend API.

### 6. Revoke UX policy

Revoke device или session остаётся явным и осторожным user action.

На этом этапе:

- revoke запускается только по кнопке в конкретной строке;
- перед действием показывается явное confirm-подтверждение;
- device revoke формулируется как отзыв всего устройства и всех его сессий;
- session revoke формулируется как закрытие конкретной сессии;
- после успешного revoke выполняется повторная загрузка snapshot;
- если revoke затронул текущую web-сессию и gateway начинает отвечать `unauthenticated`, frontend завершает локальную
  сессию без попытки реализовать cross-tab orchestration.

### 7. UI policy

Devices/sessions UI следует текущему settings direction:

- спокойные glossy panels;
- grouped system-like rows;
- restrained desktop-inspired chrome;
- явные status pills для active/revoked состояния;
- ясные loading / empty / error panels без отдельного UI framework.

При этом не вводятся:

- полноценное preferences tree;
- desktop window system;
- сложный account center;
- heavy component library.

## Последствия

### Положительные

- `apps/web` получает реальный devices/sessions management поверх уже существующих backend-контрактов.
- Settings route становится устойчивой точкой роста для следующих account-related slices.
- Devices state остаётся изолированным от auth и не размывает auth bootstrap responsibility.
- Gateway-only frontend architecture закрепляется и для account/session management UX.

### Отрицательные

- Текущая сессия не маркируется в UI, пока auth context не гидрирует session/device snapshot отдельным решением.
- После revoke frontend делает дополнительный snapshot reload вместо более сложного optimistic sync.
- Cross-tab logout, notifications и более глубокий account lifecycle остаются за пределами текущего PR.

### Ограничения

- Нельзя добавлять прямые вызовы `aero-identity` из frontend.
- Нельзя парсить opaque session token как продуктовый frontend contract.
- Нельзя смешивать текущий slice с passkeys, account deletion, notifications и realtime transport.
- Нельзя превращать settings bootstrap в тяжёлый multi-route settings framework.

## Альтернативы

### 1. Делать devices/sessions отдельным nested route внутри `/app/settings`

Не выбрано, потому что для текущего минимального scope достаточно одной страницы с явными секциями.

### 2. Хранить devices snapshot внутри auth context

Не выбрано, потому что это размывает ответственность auth bootstrap и создаёт ненужную связность между сессией и
settings UI.

### 3. Пытаться вычислять текущую сессию через структуру bearer token

Не выбрано, потому что token остаётся opaque transport-артефактом и не должен становиться публичной frontend
семантикой.
