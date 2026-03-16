# ADR-016: Web direct chat polish foundation в `apps/web`

- Статус: Accepted
- Дата: 2026-03-26

## Контекст

После завершения web direct chat bootstrap проекту нужен следующий изолированный frontend slice:
минимальная, production-oriented polish foundation для `/app/chats` и связанного shell UI в `apps/web`.

Этот этап должен:

- улучшить текущее UX списка чатов и выбранного thread;
- подтянуть визуальную систему `profile`, `people` и `chats` к более цельному AeroChat-направлению;
- сделать состояния empty/loading/error/selected-thread более явными и пригодными для повседневного использования;
- улучшить представление сообщений, pinned state, composer, read state, typing state и presence state;
- при необходимости дать минимальный safe markdown subset для текстовых сообщений;
- не смешивать polish slice с websocket/realtime transport, media, groups, desktop window system и новыми backend capabilities.

Также важно не нарушить уже принятые ограничения:

- `aero-gateway` остаётся единственной backend edge-точкой входа согласно ADR-012;
- ownership direct chats, read receipts, typing и presence остаётся в `aero-chat` согласно ADR-008, ADR-009, ADR-010 и ADR-011;
- frontend shell продолжает развиваться итерационно и performance-first согласно ADR-005;
- raw HTML rendering для пользовательских сообщений по-прежнему запрещён;
- scope PR остаётся изолированным и не тянет drafts, media attachments, groups и realtime delivery.

## Решение

### 1. Роль polish slice

`apps/web` получает отдельный polish foundation поверх уже существующего direct chat flow.

На этом этапе frontend отвечает за:

- более устойчивый master-detail layout для `/app/chats`;
- лучшую мобильную адаптацию узких экранов без desktop window system;
- более понятное отображение thread snapshot состояний;
- более цельный glossy visual language внутри защищённого shell.

Frontend по-прежнему не отвечает за:

- websocket subscriptions;
- polling для live updates;
- drafts recovery;
- media attachments;
- groups;
- desktop multi-window shell.

### 2. Layout policy для `/app/chats`

Chats UI остаётся single-route экраном `/app/chats`, но получает более явную master-detail семантику.

На широких экранах допускается одновременный показ:

- списка чатов;
- выбранного thread;
- пустого состояния thread, если чат ещё не выбран.

На узких экранах UI должен:

- показывать список чатов как основной входной экран;
- переходить к выбранному thread query-driven способом;
- позволять вернуться из thread к списку без отдельной route restructure.

Это решение выбрано как минимальное и достаточное для polish slice без внедрения нового window management или сложной маршрутизации.

### 3. Message presentation policy

Представление сообщений должно оставаться лёгким и безопасным.

На этом этапе:

- сообщения показываются как компактные bubble-like карточки;
- own/peer messages различаются визуально, но без тяжёлых эффектов;
- tombstone продолжает отображаться как отдельное удалённое состояние;
- pin/unpin остаётся message-level действием;
- pinned messages получают отдельный компактный блок над timeline;
- read state для сообщений показывается только минимально и без претензии на realtime.

### 4. Safe markdown subset

Для текстовых сообщений допускается минимальный клиентский safe markdown subset без новой тяжёлой зависимости.

На этом этапе разрешается локальный lightweight renderer для ограниченного подмножества:

- абзацы и переводы строк;
- простые списки;
- `strong`;
- `emphasis`;
- inline code;
- безопасные `http`/`https` links.

Запрещено:

- raw HTML rendering;
- небезопасные схемы ссылок;
- внедрение heavy markdown framework без отдельной необходимости и отдельного решения.

### 5. Snapshot state policy

Read state, typing state и presence state продолжают считаться snapshot-состояниями, а не live transport.

Следствия:

- read state показывается как пассивный индикатор видимого peer progress;
- typing state показывается только как краткий hint на момент запроса;
- presence state показывается как минимальный visible presence signal без `last_seen`;
- UI не должен притворяться realtime-потоком там, где его нет.

### 6. Visual system policy

Visual language `apps/web` сдвигается ближе к AeroChat:

- светлые glossy surfaces;
- restrained Frutiger Aero influence;
- old Windows-like chrome в header и panel surfaces;
- спокойные desktop-like панели вместо абстрактного bootstrap-ощущения.

При этом сохраняются ограничения:

- не добавляется heavy UI library;
- blur, gradients и chrome используются умеренно;
- слабые устройства не должны страдать от decorative overhead;
- стили должны опираться на существующую token/CSS architecture, а не на новый framework.

## Последствия

### Положительные

- `/app/chats` становится заметно ближе к реальному product UI, не меняя архитектурные границы.
- Shell начинает выглядеть более цельно между `profile`, `people` и `chats`.
- Safe markdown subset появляется без raw HTML и без тяжёлой зависимости.
- Следующие slice с realtime и desktop shell смогут опираться на уже более зрелый visual foundation.

### Отрицательные

- Часть состояний всё ещё остаётся query-driven и explicit-refresh-driven без live delivery.
- Минимальный markdown renderer покрывает только ограниченный subset и потребует дальнейшего развития позже.
- Визуальный polish остаётся foundation, а не финальным art direction.

### Ограничения

- Нельзя внедрять websocket или polling в рамках этого slice.
- Нельзя вводить drafts, media attachments, groups и desktop window system.
- Нельзя использовать raw HTML или небезопасные URL schemes для message rendering.
- Нельзя превращать visual polish в тяжёлый дизайн-фреймворк или набор несистемных one-off стилей.

## Альтернативы

### 1. Отложить polish до realtime slice

Не выбрано, потому что тогда следующий realtime PR опирался бы на слабый и плохо читаемый базовый UI.

### 2. Подключить полноценный markdown/rendering framework

Не выбрано, потому что для foundation polish достаточно лёгкого safe subset без новой тяжёлой зависимости.

### 3. Сразу делать desktop window system вместе с polish

Не выбрано, потому что это расширяет scope PR, смешивает разные roadmap slices и усложняет текущий shell раньше времени.
