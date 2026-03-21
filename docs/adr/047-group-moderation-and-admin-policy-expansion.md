# ADR-047: Group moderation foundation и расширение admin policy

- Статус: Accepted
- Дата: 2026-03-21

## Контекст

После `ADR-030`, `ADR-031`, `ADR-032`, `ADR-033`, `ADR-034`, `ADR-042`, `ADR-043`, `ADR-044`, `ADR-045` и `ADR-046`
в AeroChat уже существуют:

- canonical group entity и primary thread внутри `aero-chat`;
- membership roles `owner` / `admin` / `member` / `reader`;
- explicit ownership transfer и bounded membership management;
- gateway-only realtime delivery для group shell;
- group typing и unread foundation;
- message edit, replies и message search foundation.

Но у groups сохраняется архитектурный и продуктовый gap:

- policy matrix ролей формально не зафиксирована как единое решение;
- часть правил разбросана по отдельным checks и прошлым bootstrap slices;
- `admin` остаётся слишком узкой ролью для реальной эксплуатации группы;
- у группы нет durable moderation capability между “ничего не делать” и “удалить участника”;
- reader-only send policy уже существует, но нет отдельного moderation state для временного ограничения write access без потери membership.

Следующий slice должен:

- явно зафиксировать policy matrix ролей;
- расширить admin powers, не ломая owner-only invariants;
- добавить минимальную, но реальную moderation capability;
- сохранить backend-first характер решения;
- не превращать PR в community-management suite.

Также нужно сохранить уже принятые инварианты:

- `aero-chat` остаётся владельцем group/membership/message domain;
- `aero-gateway` остаётся единственной внешней backend edge-точкой;
- transport остаётся proto-first;
- уникальность `owner` и explicit ownership transfer не ломаются;
- invite links, primary thread и existing realtime foundation сохраняются;
- search/read/list shell access участника не должны ломаться из-за write restriction.

## Решение

### 1. Policy matrix ролей фиксируется явно

В рамках этого slice принимается следующая матрица:

- `owner`
  - может управлять invite links для ролей `admin`, `member`, `reader`;
  - может менять роли других участников между `admin`, `member`, `reader`;
  - может передавать ownership;
  - может удалять любого не-owner участника;
  - может ограничивать write access любого не-owner участника;
  - может отправлять group messages и group typing;
  - не удаляется обычным remove flow;
  - не может покинуть группу без explicit ownership transfer.
- `admin`
  - может управлять invite links для ролей `member`, `reader`;
  - может удалять участников с ролями `member` и `reader`;
  - может ограничивать write access участников с ролями `member` и `reader`;
  - может отправлять group messages и group typing;
  - не может менять роли;
  - не может передавать ownership;
  - не может трогать `owner` и не может обойти owner-only invariants.
- `member`
  - может читать group shell, history, search results и unread/read state;
  - может отправлять group messages и group typing, пока на него не наложено write restriction;
  - может только выполнить self-leave.
- `reader`
  - может читать group shell, history, search results и unread/read state;
  - не может отправлять group messages;
  - не может выполнять group typing;
  - может только выполнить self-leave.

Матрица фиксируется не только в документации, но и в коде как явная policy model.

### 2. Добавляется отдельный durable moderation state: write restriction

Для текущего этапа выбирается smallest safe option:

- membership сохраняется;
- роль membership не подменяется moderation state;
- в `group_memberships` появляется отдельный durable флаг write restriction;
- restriction применяется только к возможности писать в primary thread.

Семантика restriction:

- restricted user остаётся участником группы;
- restricted user продолжает видеть group shell, messages, roster, unread/read state и search;
- restricted user не может отправлять новые group messages;
- restricted user не может отправлять attachment-only и text+attachment group messages;
- restricted user не может выполнять group typing;
- restriction не превращается в ban, leave, remove или public mute history.

### 3. Moderation powers остаются bounded

Вводятся явные команды:

- `RestrictGroupMember`
- `UnrestrictGroupMember`

Правила:

- `owner` может restrict/unrestrict любого non-owner участника;
- `admin` может restrict/unrestrict только `member` и `reader`;
- self-target запрещён;
- target `owner` запрещён;
- target вне текущей группы недопустим;
- cross-group target не поддерживается;
- existing ownership transfer и role-management invariants сохраняются;
- ownership нельзя передать write-restricted target без отдельного явного решения.

### 4. Restriction не считается полной message mutation policy

Этот slice решает только bounded write restriction для новых group messages и typing.

Он сознательно не расширяется до:

- ban/blacklist history;
- timed mute expiration jobs;
- moderation reason storage;
- audit/event history browser;
- appeals и join approval flows;
- полного пересмотра edit/delete policy.

Group message edit остаётся в существующей модели:
автор продолжает управлять уже отправленным сообщением, пока membership сохраняется.
Это решение выбрано, чтобы не смешивать moderation foundation с redesign message mutation policy.

### 5. Realtime delivery остаётся narrow и recipient-aware

Moderation changes публикуются через existing gateway websocket foundation.

Для этого этапа добавляется отдельный bounded event:

- `group.moderation.updated`

Payload остаётся recipient-aware и содержит:

- актуальный `group` snapshot;
- актуальный `thread` snapshot;
- `member`, к которому применено изменение;
- `selfMember` для получателя;
- explicit `reason`:
  - `member_restricted`
  - `member_unrestricted`

Дополнительно:

- после restriction очищается текущий group typing target user;
- gateway публикует новый `group.typing.updated`, чтобы все активные сессии сошлись без ручного refresh;
- restricted user получает updated thread snapshot с `canSendMessages = false`.

### 6. API и web scope остаются минимальными

Внешний контракт по-прежнему проходит только через `aero-gateway`.

Transport получает только минимально необходимые изменения:

- explicit moderation commands;
- explicit restriction state на `GroupMember`;
- explicit viewer-relative group permissions в `Group`.

Web получает только минимальное consumption:

- показ restriction state в roster;
- bounded restrict/unrestrict actions там, где они разрешены;
- корректное disabled composer / typing для restricted user.

Полный moderation dashboard и redesign `GroupsPage` не вводятся.

## Последствия

### Положительные

- Group role policy становится явной и reviewable.
- `admin` получает реальную bounded operational usefulness без поломки owner invariants.
- Появляется первая durable moderation capability без потери membership.
- Existing group realtime foundation переиспользуется без нового transport слоя.
- Restriction хорошо композируется с будущими channel-like и policy-oriented slices.

### Отрицательные

- `group_memberships` получает дополнительное состояние и требует обновления read models.
- Gateway получает ещё один narrow realtime event type.
- Moderation policy на этом этапе остаётся intentionally narrow и не покрывает full community management.

### Ограничения

- Нельзя считать этот slice полноценной moderation platform.
- Нельзя расширять его до bans, timed mutes, audit browser, appeals, notifications или channels “заодно”.
- Нельзя разрешать admin менять роли или ownership без отдельного решения.
- Нельзя ломать unique owner invariant или implicit ownership handoff.

## Альтернативы

### 1. Делать restriction через смену роли в `reader`

Не выбрано, потому что moderation state и membership role решают разные задачи.
Такой подход смешал бы policy semantics и сделал бы moderation плохо обратимой.

### 2. Ввести отдельную moderation history table уже сейчас

Не выбрано, потому что это резко расширяет storage/query scope и тянет audit semantics,
которые не нужны для foundation slice.

### 3. Оставить admin без новых powers и ограничиться owner-only moderation

Не выбрано, потому что задача этого slice именно в явном расширении admin policy,
но без разрушения owner-only invariants.
