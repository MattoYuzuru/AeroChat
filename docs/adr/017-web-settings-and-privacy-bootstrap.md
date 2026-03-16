# ADR-017: Web settings and privacy bootstrap в `apps/web`

- Статус: Accepted
- Дата: 2026-03-27

## Контекст

После завершения web direct chat polish foundation проекту нужен следующий изолированный frontend slice:
минимальный, production-oriented settings bootstrap в `apps/web`, который поднимает первый реальный privacy/preferences UI
поверх уже существующих gateway и profile контрактов.

Этот этап должен:

- использовать `aero-gateway` как единственную backend edge-точку входа;
- добавить защищённый маршрут `/app/settings`;
- дать пользователю явное управление privacy flags, которые уже поддерживаются backend foundation;
- вынести лёгкие account preferences в отдельный settings flow без awkward duplication внутри `ProfilePage`;
- сохранить лёгкий glossy shell и page-scoped состояние без тяжёлого data framework;
- не смешивать settings slice с devices/sessions, block list, notifications, passkeys, realtime и desktop window system.

Также важно не нарушить уже принятые ограничения:

- `aero-gateway` остаётся единственной внешней точкой входа согласно ADR-012 и ADR-013;
- ownership privacy flags и current profile остаётся в `aero-identity` согласно ADR-006;
- read receipts, typing и presence продолжают принадлежать `aero-chat` только на уровне domain consumption, но не требуют
  отдельного realtime transport для settings UI;
- frontend shell развивается итерационно согласно ADR-005 и ADR-016;
- scope PR остаётся изолированным и не тянет sessions management, block list, notifications и deploy semantics.

## Решение

### 1. Роль `/app/settings`

`/app/settings` фиксируется как первый защищённый settings экран в `apps/web`.

На этом этапе страница отвечает за:

- загрузку актуального current profile snapshot через gateway;
- редактирование privacy flags текущего пользователя:
  - `read_receipts_enabled`
  - `presence_enabled`
  - `typing_visibility_enabled`
- редактирование лёгких account preferences:
  - `profile_accent`
  - `timezone`
  - `status_text`
- явные loading / save pending / success / error состояния.

Страница не отвечает за:

- devices и sessions management;
- block list UI;
- notifications UI;
- account deletion;
- passkeys и auth transport redesign;
- websocket/realtime delivery;
- desktop window system.

### 2. Route structure

Route structure остаётся минимальной:

- `/app/profile` продолжает отвечать за публично-ориентированные profile fields;
- `/app/settings` отвечает за приватность и личные предпочтения;
- дополнительные вложенные settings routes не вводятся;
- shell navigation обновляется без перестройки protected routing foundation.

Это решение выбрано как минимальное и достаточное для текущего slice без преждевременного усложнения маршрутизации.

### 3. Backend edge policy

Frontend делает все settings-related backend-вызовы только через `aero-gateway`.

Следствия:

- `apps/web` использует только gateway base URL;
- frontend не знает URL `aero-identity` или `aero-chat`;
- settings flow использует уже существующие `GetCurrentProfile` и `UpdateCurrentProfile`;
- gateway client расширяется только на уровне уже существующего typed surface без нового transport contract.

### 4. Разделение profile и settings responsibility

Чтобы избежать awkward duplication между `ProfilePage` и settings flow, принимается следующая граница:

- `ProfilePage` остаётся экраном публично-видимой identity-card информации:
  - `nickname`
  - `avatar_url`
  - `bio`
  - `birthday`
  - `country`
  - `city`
- `SettingsPage` становится экраном персональных предпочтений и privacy:
  - `read_receipts_enabled`
  - `presence_enabled`
  - `typing_visibility_enabled`
  - `profile_accent`
  - `timezone`
  - `status_text`

Это даёт чистую и устойчивую модель:

- profile flow не перегружается system-like настройками;
- settings flow не дублирует публичную profile card;
- backend остаётся с одним current-profile patch API.

### 5. Frontend state model

Settings state изолируется и не встраивается в auth context, people flow или chats flow.

На этом этапе принимается следующая модель:

- auth context остаётся source of truth для текущей сессии и последнего hydrated profile;
- `/app/settings` использует page-scoped form state;
- при открытии страницы выполняется явный refresh current profile через gateway;
- save выполняется через текущий `UpdateCurrentProfile` patch-flow;
- после успешного save auth profile snapshot обновляется и локальная форма переинициализируется;
- complex cache, optimistic sync и cross-page store не вводятся.

Эта модель выбрана как минимальная и достаточная для текущего slice.

### 6. UI policy

Settings UI строится как лёгкий control-panel экран:

- спокойные glossy surfaces;
- desktop-like grouped panels;
- понятные form controls;
- явные explanatory texts для privacy flags;
- restrained polish без отдельного theme engine.

На этом этапе не вводятся:

- heavy UI libraries;
- анимированный desktop window system;
- pseudo-system preferences tree;
- сложный theme/customization framework.

### 7. Loading и error policy

Settings UI обязан явно различать:

- initial loading current profile snapshot;
- recoverable gateway error при загрузке;
- локальный pending state при сохранении;
- успешное сохранение;
- локальные validation/backend errors.

Это нужно, чтобы settings flow выглядел как реальная рабочая часть продукта, а не как placeholder.

### 8. Testing policy

Для slice добавляются практичные frontend tests на:

- gateway client request semantics для settings patch payload;
- изолированную settings state logic там, где это возможно без тяжёлого UI harness.

Полноценный browser-level integration harness в этом PR не обязателен.

## Последствия

### Положительные

- `apps/web` получает первый реальный settings/privacy flow поверх уже готовых identity контрактов.
- Privacy toggles становятся доступны пользователю без расширения backend surface area.
- `ProfilePage` и `SettingsPage` получают более чистое разделение ответственности.
- Следующие slices с devices/sessions, notifications и block list смогут опираться на уже готовый settings entrypoint.

### Отрицательные

- На этом этапе settings flow всё ещё опирается на explicit refresh/save без realtime-синхронизации между вкладками.
- Update текущего профиля по-прежнему использует общий current-profile contract, а не отдельные settings-specific методы.
- Settings UI пока не покрывает более тяжёлые account management сценарии.

### Ограничения

- Нельзя добавлять прямые вызовы `aero-identity` или `aero-chat` из frontend.
- Нельзя смешивать этот slice с devices/sessions, block list, notifications, account deletion и passkeys.
- Нельзя внедрять websocket/realtime transport или desktop window system в рамках этого PR.
- Нельзя превращать settings bootstrap в тяжёлый framework-driven control center.

## Альтернативы

### 1. Оставить privacy fields внутри `ProfilePage`

Не выбрано, потому что тогда profile flow продолжал бы смешивать публичную карточку и личные system-like настройки.

### 2. Делать settings вместе с devices/sessions management

Не выбрано, потому что это ломает изоляцию roadmap slice и тянет дополнительные identity capabilities в один PR.

### 3. Ввести отдельные backend методы только для privacy toggles

Не выбрано, потому что текущий `UpdateCurrentProfile` уже поддерживает нужные optional поля, а новый transport surface на
этом этапе не даёт реальной пользы.
