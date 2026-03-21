# ADR-046: Web message search bootstrap через существующий SearchMessages API

- Статус: Accepted
- Дата: 2026-03-21

## Контекст

После `ADR-045` в системе уже существует backend foundation для поиска текста сообщений:

- `aero-chat` владеет search persistence и visibility rules;
- `aero-gateway` остаётся единственной внешней edge-точкой;
- direct chats и groups уже имеют отдельные web bootstrap pages;
- web-клиент уже умеет открывать конкретный direct chat или group по route params;
- текущий thread bootstrap в web остаётся bounded и не тянет глубокую историю.

Следующий изолированный slice должен дать пользователю реальный web entrypoint для поиска сообщений,
не превращая PR в redesign shell,
не вводя новый global state framework
и не перестраивая message history loading architecture.

Этот этап должен:

- добавить минимальный защищённый search entrypoint в `apps/web`;
- использовать уже существующий `SearchMessages` API как source of truth;
- поддержать explicit scope:
  - все direct chats;
  - один direct chat;
  - все группы;
  - одна группа;
- показать компактные результаты, достаточные для ориентации и перехода;
- дать bounded jump/highlight поведение без deep history backfill.

## Решение

### 1. Вводится отдельная защищённая страница `/app/search`

Web search bootstrap реализуется как отдельный route внутри существующего protected shell:

- `/app/search`

Это выбранный smallest safe option:

- не требует command palette;
- не лезет в layout `ChatsPage` и `GroupsPage`;
- не меняет shell navigation model фундаментально;
- оставляет будущий redesign search UX отдельным этапом.

### 2. Search form остаётся локальным и explicit

Страница поиска держит состояние локально и не вводит общий client-side store.

Форма включает:

- текстовый query input;
- explicit scope selector:
  - все личные чаты;
  - один личный чат;
  - все группы;
  - одна группа;
- минимальный `select` для конкретного direct chat или группы, когда это требуется выбранным scope.

Для заполнения selector'ов web-клиент использует уже существующие list API:

- `ListDirectChats`
- `ListGroups`

Search bootstrap не вводит отдельный metadata/search bootstrap endpoint.

### 3. Search execution идёт только через `aero-gateway`

Клиент не ходит напрямую в `aero-chat`.

Страница вызывает существующий gateway-forwarded метод:

- `SearchMessages`

Пагинация остаётся cursor-based через уже принятый контракт:

- `page_cursor`
- `next_page_cursor`
- `has_more`

Search page не добавляет ranking, merged heterogeneous transport или client-side relevance logic.

### 4. Result rendering остаётся compact и jump-oriented

Каждый результат показывает только необходимый минимум:

- тип scope: direct или group;
- label контейнера:
  - direct chat label строится из уже загруженного списка direct chats;
  - group label строится из уже загруженного списка групп;
- compact author summary;
- created time;
- edited marker или edited time;
- compact match fragment;
- explicit action для открытия результата.

Большой surrounding-history preview,
in-thread full-text highlight,
expanded reply chain
и отдельный search analytics слой не вводятся.

### 5. Jump реализуется через route params и bounded highlight

Search result открывает соответствующий thread через уже существующие страницы:

- `/app/chats?chat=<id>&message=<message_id>&from=search`
- `/app/groups?group=<id>&message=<message_id>&from=search`

Direct/group страницы получают узкую дополнительную семантику:

- если target message уже присутствует в текущем loaded thread snapshot,
  страница скроллит к нему и временно подсвечивает его;
- подсветка bounded и автоматически исчезает;
- если target message отсутствует в текущей загруженной истории,
  пользователь получает явное уведомление об ограничении.

### 6. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- command palette или global omnibox;
- search suggestions и recent searches;
- unified mixed direct+group merged response;
- ranking redesign;
- fuzzy или morphology search;
- media/attachment/filename/transcript search;
- full deep-link history backfill;
- generic thread navigation system;
- search-specific realtime.

## Последствия

### Положительные

- Web получает реальный, usable entrypoint для уже готового search backend foundation.
- Existing direct/group pages переиспользуются без нового conversation abstraction.
- Переход в результат поиска работает без transport redesign и без второго search-only UI shell.
- Ограничения текущего bounded history loading становятся явными и документированными.

### Отрицательные

- Search result labels зависят от отдельной загрузки direct/group lists на клиенте.
- Jump не гарантирует показ любого найденного сообщения, если оно старше текущего loaded thread window.
- `ChatsPage` и `GroupsPage` получают дополнительную route-driven UI-логику подсветки.

### Ограничения

- Нельзя считать этот slice завершённой search product surface.
- Нельзя обещать надёжный jump в произвольную глубину истории.
- Нельзя расширять PR до shell redesign, search ranking или нового history loading backend contract.

## Альтернативы

### 1. Встроить поиск прямо в `ChatsPage` и `GroupsPage`

Не выбрано, потому что это быстро раздувает scope,
смешивает несколько product areas
и усложняет существующие pages раньше необходимости.

### 2. Делать search overlay или command palette уже сейчас

Не выбрано, потому что это тянет новый interaction layer,
отдельные keyboard flows
и больше shell-поверхности, чем нужно для bootstrap slice.

### 3. Сразу внедрять глубокий jump с backfill истории

Не выбрано, потому что это уже отдельная задача по history architecture,
которая существенно шире текущего search bootstrap PR.
