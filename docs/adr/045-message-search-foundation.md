# ADR-045: Foundation для поиска сообщений в direct chats и groups

- Статус: Accepted
- Дата: 2026-03-21

## Контекст

После `ADR-008`, `ADR-030`, `ADR-031`, `ADR-042`, `ADR-043` и `ADR-044` в AeroChat уже существуют:

- direct chats и группы с каноническим primary thread;
- text-only, text + attachment и attachment-only message semantics;
- tombstone delete semantics для direct messages;
- explicit `edited_at` для direct/group messages;
- reply и quoted preview foundation;
- gateway-only внешний backend контракт.

Следующий изолированный slice должен добавить реальный backend foundation для поиска текста сообщений,
не превращая проект в search platform и не ломая уже принятые permission boundaries.

Этот этап должен:

- поддержать поиск внутри конкретного direct chat;
- поддержать поиск внутри конкретной группы;
- поддержать поиск по всем direct chats, доступным текущему пользователю;
- поддержать поиск по всем группам, где пользователь сейчас состоит;
- искать только по текущему stored text сообщения;
- не смешивать direct и group transport в generic conversation abstraction;
- вернуть компактный payload, достаточный для будущего jump/highlight/bootstrap UI.

Также нужно сохранить уже принятые инварианты:

- `aero-chat` остаётся владельцем message persistence и visibility rules;
- `aero-gateway` остаётся единственной внешней backend edge-точкой;
- transport остаётся proto-first и typed через ConnectRPC;
- tombstone semantics direct messages не обходится поиском;
- attachment-only сообщения без текста не получают synthetic search semantics;
- поиск не превращается в OCR, media transcript, thread search или notification subsystem.

## Решение

### 1. Вводится один явный search RPC с explicit scope

Для этого slice добавляется один метод:

- `SearchMessages`

`SearchMessages` принимает:

- `query`;
- explicit scope:
  - `direct_scope` с optional `chat_id`;
  - `group_scope` с optional `group_id`;
- pagination cursor и `page_size`.

Смысл scope остаётся узким и прямым:

- `direct_scope + chat_id` -> поиск внутри конкретного direct chat;
- `direct_scope + empty chat_id` -> поиск по всем доступным direct chats;
- `group_scope + group_id` -> поиск внутри конкретной группы;
- `group_scope + empty group_id` -> поиск по всем группам текущего пользователя.

Generic conversation abstraction не вводится,
потому что текущий codebase уже явно разделяет direct и group APIs,
а search foundation не требует их принудительно унифицировать.

### 2. Ищется только актуальный текст сообщения

В этом этапе search target ограничивается только текущим текстом сообщения:

- direct message `text_content`;
- group message `text_content`.

Следствия:

- edited messages ищутся по текущему stored text;
- attachment-only messages без текста не дают hit'ы;
- filename search, OCR, transcript search и media search не реализуются;
- reply preview и attachment metadata не становятся отдельными searchable fields;
- historic edit versions не индексируются.

### 3. Visibility rules повторяют уже существующие read boundaries

Поиск не вводит новую модель доступа.

#### Direct chats

Результаты direct search доступны только для direct chats,
которые текущий пользователь уже может читать как участник чата.

Search не расширяет write policy и не переопределяет существующее различие между:

- read access к уже существующей истории;
- write restrictions по friendship/block.

То есть search следует текущей direct read visibility model,
а не invent'ит новую search-only политику.

#### Groups

Результаты group search доступны только в группах,
где пользователь состоит на момент запроса.

Потеря membership делает group search для такой группы недоступным.

#### Delete / tombstone semantics

- tombstoned direct messages не возвращаются как обычные search hits;
- search не должен утекать existence inaccessible chats, groups или messages через отдельные counts.

### 4. Result payload остаётся компактным и jump-oriented

Каждый search hit возвращает только viewer-safe минимум:

- scope type: `direct` или `group`;
- direct chat id или group id;
- `group_thread_id` для group hit;
- `message_id`;
- compact author summary;
- `created_at`;
- `edited_at`, если сообщение редактировалось;
- `match_fragment`;
- explicit position block с `message_id` и `message_created_at`.

Не возвращаются:

- полная conversation history вокруг hit;
- thread expansion;
- reply chain;
- large bootstrap snapshot;
- search aggregation / clustering.

### 5. Pagination и ordering остаются простыми и детерминированными

Search ordering фиксируется как:

- `created_at DESC`
- `message_id DESC`

Pagination cursor тоже строится на тех же полях:

- `message_created_at`
- `message_id`

Это выбрано как smallest safe option:

- порядок легко объяснить;
- курсор стабилен;
- поведение удобно тестировать;
- не требуется внедрять ranking engine.

В этом slice сознательно не вводятся:

- fuzzy ranking;
- ML ranking;
- popularity / interaction signals;
- per-scope heterogeneous merge between direct и group results.

### 6. Persistence остаётся PostgreSQL-native

Для direct и group messages добавляется PostgreSQL full-text foundation:

- generated `tsvector` column для message text;
- GIN index по search vector;
- явные SQL queries для direct и group search.

Поиск выполняется PostgreSQL-native средствами:

- `websearch_to_tsquery('simple', ...)`
- `@@`
- `ts_headline(...)` для compact fragment

Выбран `simple` config как минимальный и предсказуемый foundation,
который не заставляет рано выбирать language-specific stemming policy.

Следствия текущего этапа:

- поиск чувствителен к token/lexeme границам, а не к произвольным substring'ам;
- нет language-specific morphology;
- нет typo tolerance и fuzzy matching;
- ranking по релевантности не считается целью этого slice.

### 7. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- search UX/product completion в web;
- search result highlighting UI;
- mixed direct+group unified query в одном ответе;
- search counts и analytics;
- external search engine;
- background indexing service;
- OCR / filename / media / transcript search;
- thread search и reply-chain search;
- saved searches, recent searches и suggestions;
- realtime search subscriptions/events.

## Последствия

### Положительные

- AeroChat получает реальный backend foundation для message text search без внешней инфраструктуры.
- Direct и groups остаются явно разделёнными в transport и domain model.
- Edited messages автоматически остаются searchable по текущему тексту.
- Result payload уже пригоден для будущего jump/highlight/bootstrap UI.
- SQL остаётся reviewable и testable внутри текущего PostgreSQL/sqlc stack.

### Отрицательные

- Search semantics пока intentionally narrow: без morphology, fuzzy matching и ranking.
- `aero-chat` получает дополнительный search-specific SQL/read model слой.
- Full-text foundation добавляет schema/index changes, которые нужно поддерживать в миграциях.

### Ограничения

- Нельзя считать этот slice завершённым search product UX.
- Нельзя расширять его до media search, notifications, moderation или external indexing.
- Нельзя обходить current participant/membership visibility rules ради “удобного” global search.
- Нельзя возвращать tombstoned direct messages как обычные видимые hit'ы.

## Альтернативы

### 1. Реализовать search через `ILIKE` и полный in-memory post-filter

Не выбрано, потому что это хуже масштабируется,
даёт более слабый foundation для будущего развития
и подталкивает к менее явным и менее тестируемым query paths.

### 2. Сразу вводить внешний search engine

Не выбрано, потому что это резко расширяет infra scope,
добавляет operational complexity
и не нужно для текущего foundation slice.

### 3. Сразу объединить direct и groups в generic conversation search abstraction

Не выбрано, потому что текущий codebase пока явно разделяет эти bounded contexts на transport-уровне,
а принудительная унификация здесь добавила бы awkward abstraction раньше необходимости.
