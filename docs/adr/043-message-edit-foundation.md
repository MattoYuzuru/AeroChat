# ADR-043: Foundation для редактирования сообщений в direct chats и groups

- Статус: Accepted
- Дата: 2026-04-20

## Контекст

После `ADR-008`, `ADR-031`, `ADR-033`, `ADR-039` и `ADR-042` в AeroChat уже существуют:

- direct chats и group primary thread;
- text-only, text + attachment и attachment-only message semantics;
- gateway-only realtime delivery для direct/group message updates;
- tombstone delete для direct messages;
- viewer-relative unread/read foundation.

Но у продукта остаётся подтверждённый gap:

- автор не может исправить уже отправленное сообщение;
- direct и group message snapshots не дают стабильного explicit edited marker;
- web и future clients не имеют канонического transport contract для edit flow;
- текущие realtime families умеют доставлять message updates, но edit semantics в них пока не зафиксирована.

Следующий slice должен закрыть именно этот foundation-gap:

- добавить реальное редактирование сообщений для direct chats и groups;
- сохранить backend-first характер изменения;
- не превращать edit в delete-and-resend semantics;
- не раздувать scope до edit history, replies, search, notifications и redesign thread UI;
- не ломать текущую attachment model, permission boundaries и gateway-only внешний контракт.

Также нужно сохранить уже принятые инварианты:

- `aero-chat` остаётся владельцем message lifecycle;
- `aero-gateway` остаётся единственной внешней backend edge-точкой;
- transport остаётся proto-first и typed через ConnectRPC;
- safe markdown policy и запрет raw HTML сохраняются;
- attachment lifecycle не переопределяется edit flow;
- edit не считается audit/history subsystem.

## Решение

### 1. Редактирование остаётся явной message mutation, а не delete-and-resend

Для direct chats и groups вводятся отдельные явные команды редактирования:

- `EditDirectChatMessage`
- `EditGroupMessage`

Edit:

- изменяет существующую message row in-place;
- не создаёт новый `message_id`;
- не генерирует новую message history entry;
- не считается delete + resend;
- не меняет автора, attachments и created timestamp.

Это сохраняет стабильность message identity для read/unread state, realtime reducers и future extensions.

### 2. Edit eligibility фиксируется консервативно

Редактирование разрешено только при одновременном выполнении условий:

- пользователь аутентифицирован;
- пользователь является автором сообщения;
- сообщение остаётся text-capable;
- новое text payload после нормализации не пустое;
- message scope по-прежнему доступен текущему пользователю по уже существующим permission boundary.

Дополнительно фиксируются узкие правила по scope:

#### Direct chats

- edit доступен только участнику соответствующего direct chat;
- сохраняются текущие write boundary:
  - friendship должна оставаться активной;
  - block хотя бы в одну сторону запрещает edit;
- tombstoned message не редактируется.

#### Groups

- edit доступен только текущему участнику группы;
- edit не требует, чтобы текущая роль всё ещё имела право отправлять новые сообщения;
- если автор уже отправил сообщение и позже был понижен до `reader`, это сообщение остаётся edit-able для него, пока membership сохраняется;
- потеря membership делает edit недоступным;
- `reader` не получает send rights обратно: правило касается только редактирования уже собственного сообщения.

Это выбрано как smallest safe option:
role downgrade не отнимает ownership уже созданного message content,
но membership boundary по-прежнему обязателен.

### 3. Attachment semantics на edit не расширяются

В этом slice edit меняет только text payload сообщения.

Следствия:

- existing attachments остаются неизменными;
- add/remove attachment на edit не поддерживается;
- `text + attachment` сообщение редактирует только текст;
- `attachment-only` сообщение без text payload не считается text-capable и не редактируется;
- synthetic text semantics для attachment-only message не вводится.

Это сохраняет уже принятую attachment lifecycle model и не смешивает message edit с media redesign.

### 4. Edited marker становится explicit и стабильным

Message snapshots для direct chats и groups расширяются explicit полем:

- `edited_at`

`edited_at`:

- отсутствует у сообщений без edit;
- обновляется при успешном edit;
- является source of truth для user-facing edited marker;
- не подменяется эвристикой по `updated_at`.

`updated_at` продолжает отражать mutation timestamp строки и используется для существующей coherence message update flows,
но клиент не должен делать вывод “сообщение редактировалось” только по `updated_at`.

### 5. Persistence model остаётся минимальной

Выбран smallest safe persistence change:

- добавить nullable `edited_at` в `direct_chat_messages`;
- добавить nullable `edited_at` в `group_messages`;
- обновлять `text_content`, `updated_at` и `edited_at` in-place при edit.

Не вводятся:

- отдельная edit history table;
- event-sourcing model;
- audit browsing API;
- second message table;
- attachment mutation tables.

При успешном edit conversation activity timestamps тоже обновляются,
чтобы существующие list/realtime projections сохраняли согласованность с уже принятым `message.updated` подходом.

### 6. Realtime reuse остаётся узким

Новый отдельный websocket event family не вводится.

Редактирование публикуется через уже существующие семьи:

- `direct_chat.message.updated`
- `group.message.updated`

Payload продолжает нести актуальный message snapshot,
а `reason` расширяется explicit edit reason:

- `message_edited`

Это сохраняет reducer-safe совместимость:

- active sessions получают обновлённый text payload и `edited_at`;
- web не обязан подписываться на новый event type;
- gateway не превращается в новый notification layer.

### 7. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- edit history и audit browsing;
- moderation-specific edit policy;
- replies;
- search index update semantics;
- notifications/toasts/push;
- attachment add/remove on edit;
- multi-file editing semantics;
- frontend redesign thread UI;
- edit of tombstoned direct messages;
- generic conversation mutation abstraction.

## Последствия

### Положительные

- Direct chats и groups получают реальный foundation для редактирования сообщений.
- Edited marker становится explicit и transport-stable.
- Existing realtime transport переиспользуется без нового event family.
- Attachment model не ломается и не получает скрытую edit semantics.
- Role downgrade до `reader` не ломает ownership уже отправленного group message content.

### Отрицательные

- `updated_at` conversation activity теперь реагирует и на edit, а не только на создание/удаление/pin.
- На этом этапе нет edit history и пользователь не может увидеть прошлые версии текста.
- Group edit policy зависит от текущего membership, что требует явной документации для leave/remove сценариев.

### Ограничения

- Нельзя считать этот slice edit history system.
- Нельзя добавлять attachment lifecycle redesign “заодно”.
- Нельзя использовать `updated_at` как замену explicit edited marker.
- Нельзя обходить friendship/block/membership checks ради удобства edit UX.

## Альтернативы

### 1. Реализовать edit как delete-and-resend

Не выбрано, потому что это ломает стабильность `message_id`,
искажает read/unread semantics
и делает edit неотличимым от нового сообщения.

### 2. Ввести полноценную edit history table уже сейчас

Не выбрано, потому что это резко расширяет scope storage, transport и UI без необходимости для foundation slice.

### 3. Разрешить edit attachment-only сообщений через synthetic text field

Не выбрано, потому что у текущей message model нет безопасной канонической text semantics для attachment-only path,
а такое решение стало бы скрытым redesign attachment model.

### 4. Запретить group edit после downgrade до `reader`

Не выбрано, потому что это делает ownership уже отправленного content зависимым от поздней role mutation,
хотя membership и author identity остаются прежними.
При этом membership boundary всё равно сохраняется,
поэтому выбран более узкий и продуктово ожидаемый вариант:
автор может редактировать свой текст, пока остаётся участником группы.
