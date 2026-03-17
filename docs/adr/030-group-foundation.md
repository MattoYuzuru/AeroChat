# ADR-030: Foundation для groups, membership roles и invite links

- Статус: Accepted
- Дата: 2026-04-07

## Контекст

После публичного alpha launch в AeroChat уже существуют:

- identity/auth foundation;
- social graph foundation;
- direct chat foundation;
- gateway realtime transport;
- direct chat realtime;
- people/social graph realtime;
- web shell c profile/settings/devices bootstrap.

Следующий архитектурно значимый slice должен добавить минимальную, но production-oriented основу для групп.

Этот этап должен:

- ввести canonical group entity;
- зафиксировать ownership внутри корректной сервисной границы;
- добавить membership model с устойчивыми ролями;
- добавить invite link model без security theater;
- ввести явный join-by-link flow;
- дать web bootstrap для создания, просмотра и join групп;
- не превращаться в реализацию полного group messaging продукта.

Также важно сохранить уже принятые инварианты:

- `aero-gateway` остаётся единственной внешней backend edge-точкой;
- `aero-identity` остаётся владельцем account/session/social graph;
- `aero-chat` владеет chat/conversation domain;
- transport остаётся proto-first;
- криптография не импровизируется;
- публичный group discovery не вводится;
- calls, media, rtc и E2EE не смешиваются с этим slice.

## Решение

### 1. Владение groups закрепляется за `aero-chat`

Group foundation размещается внутри сервисной границы `aero-chat`.

Причины:

- группа является conversation container и частью chat domain, а не identity domain;
- membership roles и invite links напрямую влияют на будущие group chat, channel-like semantics и group call policies;
- перенос ownership в `aero-identity` смешал бы account/social graph responsibility с conversation/container model;
- выделение отдельного group-сервиса на этом этапе дало бы лишнюю операционную и кодовую сложность без достаточной пользы.

`aero-gateway` в этом slice остаётся только edge/BFF слоем и не получает ownership группы.

### 2. Каноническая модель группы

На foundation-этапе вводится отдельная сущность `group`.

Минимальная canonical model:

- `id`
- `name`
- `created_by_user_id`
- `created_at`
- `updated_at`

Группа не является публично discoverable объектом.
Попадание пользователя в группу возможно только через явное создание владельцем или через явный join по invite link.

### 3. Membership model и роли

Для участия в группе вводится отдельная сущность `group_membership`.

Каждое membership хранит:

- `group_id`
- `user_id`
- `role`
- `joined_at`

На этом этапе фиксируются четыре стабильные роли:

- `owner`
- `admin`
- `member`
- `reader`

Инварианты:

- в группе существует ровно один `owner`;
- `owner` является обычным membership role, а не внешним флагом;
- `reader` является полноценной membership role уже сейчас, даже если reader UX пока минимален;
- роли хранятся явно и не вычисляются косвенно.

Это создаёт совместимую основу для будущих promote/demote flows, channel-like modes и group policy expansion.

### 4. Invite link model

Invite links вводятся как отдельная group-owned сущность.

Каждый invite link:

- принадлежит одной группе;
- создаётся участником с достаточными правами;
- несёт целевую membership role;
- может быть отключён/отозван;
- использует только opaque random secret;
- не использует самодельный криптографический протокол.

На этом этапе invite link не делает группу публично discoverable.
Ссылка работает только как capability для явного join flow.

`owner` через invite link не выдаётся.
Invite link может создавать только роли:

- `admin`
- `member`
- `reader`

Сервер хранит безопасное server-side представление секрета и не использует секрет как долгоживущий открытый идентификатор в базе.

### 5. Начальные правила авторизации

Минимальные authorization rules на этом этапе:

- любой аутентифицированный пользователь может создать группу;
- список групп и чтение конкретной группы доступны только её участникам;
- список участников группы доступен только её участникам;
- создание invite link доступно `owner` и `admin`;
- `owner` может создавать invite links для `admin`, `member`, `reader`;
- `admin` может создавать invite links для `member` и `reader`;
- список invite links доступен `owner` и `admin`;
- отключение invite link доступно `owner` и `admin`;
- join по invite link доступен только аутентифицированному пользователю и выполняется явно отдельной командой;
- join не обходит membership checks и не создаёт public discovery path.

На этом этапе управление ролями участников остаётся ограниченным.
Полный promote/demote flow будет отдельным slice.

### 6. Transport и web bootstrap

Foundation публикуется через существующий `ChatService` в `aero-chat` и проксируется через `aero-gateway`.

Web bootstrap остаётся gateway-only и добавляет только минимальный shell:

- create group;
- list user groups;
- open group page;
- list members;
- create/list/disable invite links при наличии прав;
- explicit join-by-link flow.

Group realtime fan-out на этом этапе не требуется.

### 7. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- group messages;
- group typing/read/presence realtime;
- group calls и RTC policies;
- media и attachment semantics для групп;
- E2EE group protocol;
- public search/discovery групп;
- полноценное управление ролями через promote/demote;
- расширенные invite link policy вроде expiry/max-uses.

## Последствия

### Положительные

- У групп появляется чёткий и совместимый с chat domain ownership.
- Membership roles фиксируются до появления group messaging, а не поверх уже сложившейся хаотичной модели.
- `reader` появляется как реальная роль заранее, что снижает будущий архитектурный долг.
- Invite links остаются безопасной capability-моделью без public discovery.
- Web-клиент получает минимальный bootstrap без redesign shell и без второго backend edge.

### Отрицательные

- `ChatService` и `aero-chat` становятся шире по surface area уже на foundation-этапе.
- До отдельного slice с role management часть admin/owner semantics остаётся ограниченной.
- Invite links пока не имеют расширенных policy knobs вроде expiry/max-uses.

### Ограничения

- Нельзя считать этот slice реализацией полного group chat продукта.
- Нельзя вводить group messages, calls, media или E2EE “заодно”.
- Нельзя добавлять публичный group directory или discovery flow.
- Нельзя переносить ownership группы в `aero-gateway` или `aero-identity` без нового ADR.

## Альтернативы

### 1. Держать groups в `aero-identity`

Не выбрано, потому что это смешало бы account/social graph domain с conversation/container domain и усложнило бы будущую эволюцию group chat и call policies.

### 2. Сразу выделить отдельный group-service

Не выбрано, потому что на текущем этапе это добавляет лишнюю инфраструктурную и кодовую сложность без достаточной продуктовой необходимости.

### 3. Отложить `reader` до появления group messaging

Не выбрано, потому что тогда будущая channel-like semantics появилась бы как поздний ломающий слой вместо заранее зафиксированной роли.

### 4. Делать invite links через публичный slug или discoverable group identifier

Не выбрано, потому что это противоречит политике отсутствия public group discovery и увеличивает поверхность нежелательного раскрытия group existence.
