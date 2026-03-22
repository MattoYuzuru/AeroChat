# ADR-071: Encrypted search recovery foundation

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-045`, `ADR-046` и `ADR-055`...`ADR-070` в AeroChat уже существуют:

- legacy plaintext search foundation через `SearchMessages` и `/app/search`;
- encrypted direct-message v2 storage/realtime/local projection foundation;
- encrypted group lane storage/realtime/local projection foundation;
- encrypted mutations, pin/unpin и unread/read recovery для encrypted direct и encrypted group lanes;
- честная граница coexistence между legacy plaintext history и encrypted forward-only lanes.

При этом searchable semantics после перехода на encrypted lanes оставались неполными:

- `SearchMessages` продолжает искать только по server-readable plaintext history;
- encrypted direct и encrypted group сообщения уже локально расшифровываются, но не попадают в usable search path;
- возврат server-side plaintext projection или plaintext search fragment для encrypted lanes нарушил бы уже принятый opaque boundary;
- backup/recovery, deep history sync и full global parity для encrypted search всё ещё отсутствуют.

Нужен следующий изолированный slice, который вернёт **usable, но bounded** поиск по encrypted direct и encrypted group lanes,
не вернёт серверу plaintext индекс,
не притворится полной parity с legacy global search
и не раздует PR до backup/recovery, RTC или history redesign.

## Решение

### 1. Для encrypted lanes фиксируется только local-only search model

Encrypted search в этом slice выполняется **только внутри client/runtime boundary**:

- server не строит plaintext search index для encrypted conversations;
- server не хранит decrypted projections, snippets или search fragments;
- query по encrypted lane обслуживается только локально после fetch + decrypt;
- searchable source of truth для encrypted lane — bounded local projection текущего browser/runtime.

Это отдельный search path рядом с legacy plaintext search, а не “магически unified backend capability”.

### 2. Shared local indexing model переиспользуется для encrypted direct и encrypted group

Для encrypted direct-message v2 и encrypted group lane вводится один и тот же базовый подход:

- indexing принимает только локально materialized decrypted message entries;
- индексируется только renderable decrypted text текущего logical message;
- tombstoned entries, decrypt failures и attachment-only сообщения без текста не становятся search hits;
- edited encrypted message ищется по текущему локально видимому text body;
- direct и group используют один и тот же query/match/fragment builder.

Этот slice сознательно **не** добавляет:

- OCR;
- transcript search;
- filename/media-content search beyond locally decrypted text;
- morphology/fuzzy search;
- server-assisted ranking.

### 3. Индекс остаётся bounded и session-local

Чтобы не создать неконтролируемый decrypted cache, фиксируются явные пределы:

- до `50` decrypted searchable messages на один encrypted lane;
- для multi-lane search по `all direct` или `all groups` индексируются только последние доступные encrypted lanes в рамках явного lane budget;
- web хранит index только в памяти текущей browser session;
- logout/reload profile очищает local encrypted search index.

Persistence в IndexedDB, backup/recovery и cross-session replay в этом PR не вводятся.

### 4. All-scope encrypted search остаётся честно неполным

При поиске по `all direct` или `all groups` web не обязан читать всю историю всех encrypted conversations.

Вместо этого:

- выбираются наиболее свежие conversations по текущему list snapshot;
- для них подтягивается bounded encrypted window;
- search results помечаются как local/bounded;
- UI явно сообщает, если encrypted scope ограничен только recent locally indexed lanes.

Следовательно:

- если нужный encrypted message старше текущего bounded окна, hit не гарантирован;
- если нужная encrypted conversation не попала в recent search budget, она тоже может не попасть в текущий local search pass;
- это не считается full global parity и не должно так описываться в UI или docs.

### 5. Search UI сохраняет текущий entrypoint, но разделяет plaintext и encrypted paths явно

`/app/search` и текущий scope selector сохраняются.

При этом search page теперь честно показывает два сосуществующих path:

- legacy plaintext results через server-backed `SearchMessages`;
- encrypted local results через client-side local index.

Следствия:

- legacy plaintext direct/group history может продолжать использовать текущий server search path;
- encrypted direct/group lanes не ходят в backend за plaintext search;
- UI может показывать одинаковый query/scope, но не притворяется единым backend search engine.

### 6. Jump/open semantics для encrypted results остаются bounded

Encrypted search result может использовать локально собранный fragment и ссылаться на stable `message_id`,
но jump/open работает только в пределах уже materialized local encrypted lane.

Если target encrypted message:

- уже есть в локальной projection открытого lane — страница скроллит и временно подсвечивает его;
- ещё не попал в локально загруженное bounded окно — UI явно сообщает об ограничении;
- не может быть расшифрован текущим runtime/profile — UI показывает честную unavailable/error degradation.

Deep history backfill, new history API и full jump parity в этом slice не реализуются.

### 7. Runtime/index boundary остаётся узкой и явной

Decrypted searchable content не должен растекаться по unrelated UI state.

Для этого в web фиксируется узкая boundary:

- загрузка encrypted search lane использует уже существующие opaque fetch + decrypt paths;
- search index живёт в отдельном local module/store;
- chat/group pages могут только priming'овать этот index уже materialized projection-данными;
- search UI читает готовые indexed entries, а не raw ciphertext и не generic app-wide decrypted state.

### 8. Honest boundary

Этот PR **решает только**:

- shared local encrypted search foundation;
- usable search recovery для encrypted direct lanes;
- usable search recovery для encrypted group lanes;
- coexistence legacy plaintext search и encrypted local search на одном entrypoint;
- bounded encrypted jump/open behavior для локально materialized targets.

Этот PR **не решает**:

- backup/recovery;
- full offline sync и deep history hydration;
- RTC;
- server-side encrypted search;
- full media search;
- full parity с legacy global search, если encrypted content ещё не локально fetched/decrypted.

## Последствия

### Положительные

- Encrypted direct и encrypted group lanes снова становятся searchable без возврата server-readable plaintext индекса.
- Один shared local model уменьшает шанс на две расходящиеся search реализации для direct и groups.
- Existing search entrypoint `/app/search` остаётся usable и честно показывает coexistence двух путей.
- Bounded local search behaviour становится reviewable, testable и документированным.

### Отрицательные

- Search UX становится явно двухконтурным: server plaintext и local encrypted path рядом.
- All-scope encrypted search intentionally incomplete и зависит от bounded recent local index.
- Browser session хранит дополнительный in-memory decrypted search state, который нужно дисциплинированно очищать.

### Ограничения

- Нельзя называть этот slice “full encrypted search parity”.
- Нельзя обещать нахождение любого старого encrypted сообщения.
- Нельзя расширять этот PR до backup/recovery, history redesign или server-side search relay.

## Альтернативы

### 1. Вернуть server-side plaintext search projections для encrypted lanes

Не выбрано, потому что это ломает opaque boundary,
создаёт скрытый plaintext shadow path
и противоречит уже принятым E2EE foundations.

### 2. Вообще не восстанавливать search, пока не появится backup/recovery и full sync

Не выбрано, потому что тогда encrypted conversations слишком долго оставались бы search-broken,
а узкий bounded local search уже даёт реальную ценность без архитектурной деградации.

### 3. Делать две независимые search реализации: одну для encrypted direct, другую для encrypted groups

Не выбрано, потому что это удваивает локальную сложность,
расходится по semantics
и не приносит пользы относительно shared local indexing/query boundary.
