# ADR-042: Foundation для unread conversation state в direct chats и groups

- Статус: Accepted
- Дата: 2026-04-19

## Контекст

После `ADR-009`, `ADR-030`, `ADR-031`, `ADR-033` и `ADR-034` в AeroChat уже существуют:

- direct read receipts foundation;
- group primary thread и group text messaging;
- gateway-only realtime transport;
- live delivery direct/group messages;
- multi-session runtime, где один пользователь может держать несколько активных web-сессий.

Но у продукта остаётся подтверждённый системный gap:

- список direct chats не знает, сколько непрочитанных сообщений есть у текущего пользователя;
- список групп не знает, сколько group messages накопилось после последней read position;
- groups вообще не имеют durable conversation-level read state;
- unread между несколькими активными сессиями одного пользователя не синхронизируется как отдельная доменная сущность;
- текущий web shell вынужден либо не показывать unread, либо импровизировать client-side эвристики без server source of truth.

Следующий slice должен закрыть именно этот foundation-gap:

- добавить реальную unread model для direct chats и groups;
- сохранить backend-first характер решения;
- не превращать unread в notification center, attention layer или broad frontend polish;
- не ломать уже принятый gateway-only внешний контракт;
- не подменять direct read foundation второй competing counter model.

Также нужно сохранить уже принятые инварианты:

- `aero-chat` остаётся владельцем chat/group/read domain;
- `aero-gateway` остаётся единственной внешней backend edge-точкой;
- transport остаётся proto-first и typed через ConnectRPC;
- unread не должен считаться через ad-hoc client-only heuristics как source of truth;
- `reader` в groups остаётся read-only в send flow, но не теряет доступ к read/unread lifecycle.

## Решение

### 1. Unread фиксируется как viewer-relative conversation state

Unread определяется только относительно текущего аутентифицированного пользователя.

Следствия:

- один и тот же direct chat или group может иметь разные unread значения у разных участников;
- unread не публикуется как global conversation counter;
- unread выдаётся только через already authenticated read/list surfaces;
- unread должен оставаться корректным для нескольких активных сессий одного и того же пользователя.

### 2. Direct unread не получает отдельную competing persistence model

Для direct chats source of truth остаётся существующий direct read foundation из `ADR-009`.

Unread count для direct chat вычисляется как число сообщений:

- принадлежащих данному direct chat;
- отправленных вторым участником, а не текущим пользователем;
- идущих строго после текущей read position пользователя по `(created_at, message_id)`.

Отдельная таблица counters для direct unread не вводится.
Unread всегда производен от уже существующей read position.

### 3. Viewer-local direct read position начинает использоваться и для unread, даже если peer receipts скрыты privacy-флагом

Unread foundation требует, чтобы пользователь мог накапливать и очищать unread независимо от того,
показывает ли он свои read receipts собеседнику.

Поэтому direct read foundation уточняется:

- внутренняя read position пользователя продолжает храниться в той же direct read storage model;
- эта позиция используется для вычисления unread самого пользователя;
- privacy-флаг `read_receipts_enabled` продолжает управлять только peer-visible read receipt exposure;
- отключённый privacy-флаг не даёт собеседнику видеть peer read position,
  но не выключает внутренний read progression как основу unread.

Это не считается второй direct unread системой,
потому что unread по-прежнему строится на той же read position и той же таблице.

### 4. Для groups вводится минимальная durable read state model

Для groups принимается smallest safe option:

- одна canonical запись на пару `group_id + user_id`;
- `last_read_message_id`;
- `last_read_message_created_at`;
- `updated_at`.

Эта запись трактуется как conversation-level read state группы,
а не как per-message seen history.

На этом этапе не вводятся:

- seen-by history по сообщениям;
- group delivery receipts;
- audit trail всех read transitions;
- aggregated notification projections.

### 5. Group unread считается от current group read position

Unread count для группы вычисляется как число group messages:

- принадлежащих canonical primary thread текущей группы;
- отправленных не текущим пользователем;
- идущих строго после текущей group read position пользователя по `(created_at, message_id)`.

Следствия:

- собственные сообщения пользователя не увеличивают его unread;
- `reader` может накапливать и очищать unread, хотя не может отправлять новые сообщения;
- unread model остаётся conversation-level и не зависит от роли отправки.

### 6. API остаётся явным и без premature generic conversation abstraction

Transport surface расширяется консервативно:

- direct list/snapshot surfaces начинают отдавать viewer-relative unread state;
- group list/snapshot surfaces начинают отдавать viewer-relative unread state;
- для groups добавляется отдельная явная команда mark-as-read;
- direct и group naming остаются раздельными.

На этом этапе не вводятся:

- generic `ConversationService`;
- общий `MarkConversationRead`;
- отдельный notification transport;
- новый внешний edge вне `aero-gateway`.

### 7. Realtime остаётся bounded и служит coherence между active sessions

Realtime layer не становится notification platform.

Он обязан обеспечить только bounded coherence:

- входящее direct/group message событие позволяет активным сессиям одного пользователя корректно продвигать unread;
- явное read действие в одной сессии должно доходить до других активных сессий того же пользователя;
- если read-related realtime event нужен для groups, он должен оставаться узким и self-scoped.

Unread sync по-прежнему остаётся process-local в рамках current single-server gateway hub и не требует distributed bus.

### 8. Web scope остаётся минимальным

На web-слое допустим только минимальный contract consumption:

- unread badge/count в списке direct chats;
- unread badge/count в списке groups;
- auto mark-as-read при открытии активного thread, если это ложится на текущую архитектуру.

Сознательно не реализуются:

- in-app toasts;
- browser notifications;
- “new messages” marker внутри thread;
- notification center;
- service worker attention model;
- broad redesign `/app/chats` или `/app/groups`.

## Последствия

### Положительные

- Direct chats и groups получают единообразную viewer-relative unread foundation.
- Direct unread не дублирует существующую read model и не плодит competing counters.
- Groups получают минимальную durable read state без seen-by history explosion.
- Multi-session web runtime получает bounded unread coherence без нового event bus.
- Web может показать unread, не invent'я client-side source of truth.

### Отрицательные

- `aero-chat` получает дополнительные unread-aware SQL queries и read state orchestration.
- Gateway и web должны аккуратно различать incoming message updates и explicit read updates.
- Privacy semantics direct read приходится уточнить: peer visibility и internal unread basis больше не совпадают полностью.

### Ограничения

- Нельзя считать этот slice notification system foundation.
- Нельзя расширять unread до push/email/browser notification behaviour.
- Нельзя добавлять per-message group seen history или analytics tables “заодно”.
- Нельзя строить direct unread на отдельной counter-only storage model.
- Нельзя ломать gateway-only внешний контракт ради unread.

## Альтернативы

### 1. Сделать отдельные direct/group unread counters и обновлять их side effect'ами

Не выбрано, потому что для direct chats это создало бы вторую competing model поверх уже существующей read position,
а для groups добавило бы лишний риск drift между counter и реальной message history.

### 2. Ограничиться только client-side вычислением unread

Не выбрано, потому что это не даёт server source of truth для list/snapshot surfaces,
хуже переживает multi-session и делает unread зависимым от локальной истории событий клиента.

### 3. Сразу вводить generic conversation abstraction для direct и groups

Не выбрано, потому что текущий codebase пока явно разделяет direct и group APIs,
и unread foundation не требует перестройки всего transport surface.
