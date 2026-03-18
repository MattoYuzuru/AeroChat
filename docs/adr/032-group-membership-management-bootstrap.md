# ADR-032: Group membership management bootstrap

- Статус: Accepted
- Дата: 2026-04-09

## Контекст

После `ADR-030` и `ADR-031` в AeroChat уже существуют:

- canonical group entity внутри `aero-chat`;
- membership roles `owner` / `admin` / `member` / `reader`;
- invite links и explicit join flow;
- canonical primary thread на группу;
- text-only group messaging bootstrap без realtime;
- gateway-only web shell для групп.

Следующий архитектурно значимый slice должен завершить минимальную, но production-oriented модель управления
membership и ролями группы.

Этот этап должен:

- зафиксировать канонические правила смены ролей;
- добавить bounded commands для role management;
- добавить remove member и leave group flow;
- сохранить строгую уникальность `owner`;
- не допустить состояния ownerless group;
- дать минимальный web bootstrap для управления membership;
- не смешивать текущий slice с group realtime, calls, media, moderation system и public discovery.

Также нужно сохранить уже принятые инварианты:

- `aero-chat` остаётся владельцем group и membership domain;
- `aero-gateway` остаётся единственной внешней backend edge-точкой;
- transport остаётся proto-first и typed через ConnectRPC;
- `reader` уже является значимой read-only ролью;
- invite links не превращают группу в discoverable объект;
- admin powers не должны разрастись раньше отдельного решения.

## Решение

### 1. Канонический owner остаётся ровно один

В каждой группе в любой момент времени существует ровно один `owner`.

Следствия:

- `owner` хранится как обычная membership role внутри `group_memberships`;
- обычный promote/demote command не может назначать роль `owner`;
- удаление `owner` запрещено;
- `owner` не может покинуть группу через обычный leave flow;
- переход ownership выполняется только отдельной явной командой.

### 2. Owner leave требует явной передачи ownership

Для этого этапа выбирается строгая модель:

- `owner` не может выполнить `LeaveGroup`, пока ownership не передан другому текущему участнику;
- для выхода `owner` обязан сначала выполнить явный `TransferGroupOwnership`;
- после успешной передачи прежний `owner` понижается до `admin`;
- затем бывший `owner` может выполнить обычный `LeaveGroup`.

Это решение выбрано вместо implicit handoff, потому что:

- ownership не должен угадываться сервером;
- silent auto-promotion создаёт слабый и плохо обозримый policy layer;
- явная передача ownership безопаснее для review, UI и будущего расширения permission model.

### 3. Консервативная authorization model

На этом этапе фиксируются следующие правила:

- `owner`
  - может менять роли других участников;
  - может явно передавать ownership;
  - может удалять других участников;
  - сохраняет уже существующее право управлять invite links;
- `admin`
  - сохраняет только уже принятые права на invite links;
  - не получает role-management и remove-member powers в этом PR;
- `member`
  - обычный участник группы;
  - может только самостоятельно покинуть группу;
- `reader`
  - остаётся полноценным участником;
  - остаётся read-only в message flow;
  - может самостоятельно покинуть группу.

Любые будущие расширения admin powers требуют отдельного решения.

### 4. Явные membership commands

`ChatService` расширяется bounded-командами:

- `UpdateGroupMemberRole`
- `TransferGroupOwnership`
- `RemoveGroupMember`
- `LeaveGroup`

Surface выбран как минимальный и достаточный:

- управление membership остаётся рядом с уже существующими group commands;
- transport не вводит отдельный admin panel API;
- web-клиент продолжает работать только через `aero-gateway`.

### 5. Правила role transition

На этом этапе обычная смена роли допускает только target roles:

- `admin`
- `member`
- `reader`

Обычный `UpdateGroupMemberRole`:

- доступен только `owner`;
- применяется только к другому участнику группы;
- не может менять роль `owner`;
- не может оставлять группу без `owner`.

`TransferGroupOwnership`:

- доступен только текущему `owner`;
- целится только в уже существующего не-owner участника;
- делает target user новым `owner`;
- делает прежнего `owner` ролью `admin`.

Таким образом ownership transfer остаётся явной доменной операцией, а не частным случаем role update.

### 6. Правила remove member и leave group

`RemoveGroupMember`:

- доступен только `owner`;
- применяется только к другому участнику;
- не применяется к текущему `owner`;
- уменьшает membership и обновляет `group.updated_at`.

`LeaveGroup`:

- доступен только текущему участнику для самого себя;
- разрешён для `admin`, `member` и `reader`;
- запрещён для `owner` до явного ownership transfer;
- обновляет `group.updated_at`.

### 7. Persistence и consistency policy

Новая storage-модель не вводится.

Текущий slice использует уже существующие таблицы:

- `groups`
- `group_memberships`

Для смены ролей и ownership transfer используются явные SQL-операции и транзакции.

Ownership transfer обязан выполняться так, чтобы:

- в результате операции оставался ровно один `owner`;
- не возникало промежуточного публичного состояния с двумя `owner`;
- `group.updated_at` отражал membership management actions.

### 8. Web bootstrap

`apps/web` получает минимальное расширение существующей group page:

- показать member list c role information;
- показать bounded actions только при достаточных правах;
- дать owner UI для role change, remove member и transfer ownership;
- дать участнику UI для `LeaveGroup`;
- явно подсказать owner, что выход требует предварительной передачи ownership.

Group realtime и live membership sync в этом PR не добавляются.

## Последствия

### Положительные

- Group membership model становится завершённой и пригодной для следующего product роста.
- Уникальность `owner` закрепляется не только storage-слоем, но и явными доменными командами.
- `reader` остаётся реальной и полезной ролью, а не декоративным placeholder.
- Web-клиент получает минимально достаточный management UI без нового backend edge и без realtime.
- Admin powers остаются консервативными и не разрастаются раньше отдельного решения.

### Отрицательные

- `owner` обязан делать явную двухшаговую операцию, если хочет покинуть группу.
- `admin` пока выглядит ограниченно, потому что membership management намеренно не делегируется ему.
- После mutating actions frontend всё ещё опирается на explicit refresh, а не на live updates.

### Ограничения

- Нельзя считать этот slice group moderation system.
- Нельзя добавлять group realtime, calls, media, bans, audit log и public discovery “заодно”.
- Нельзя давать admin role-management powers без отдельного решения.
- Нельзя разрешать implicit owner handoff или ownerless group state.

## Альтернативы

### 1. Автоматически передавать ownership при уходе owner

Не выбрано, потому что это делает критичную доменную операцию неявной и создаёт плохо обозримую политику выбора нового
owner.

### 2. Разрешить admin управлять ролями уже в этом PR

Не выбрано, потому что текущий slice должен остаться консервативным и narrow, а делегирование management powers требует
отдельного policy-решения.

### 3. Представлять ownership отдельным флагом вне membership role

Не выбрано, потому что это ломает уже принятую canonical membership model из `ADR-030` и усложняет дальнейшую
permission-эволюцию.
