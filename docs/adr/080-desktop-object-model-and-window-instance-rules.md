# ADR-080: Desktop object model и window instance rules

- Статус: Accepted
- Дата: 2026-03-24

## Контекст

После принятия `ADR-079` desktop shell становится primary desktop surface.

Без явной object model future PR быстро разойдутся в базовых вопросах:

- что считается приложением, окном, shortcut или folder;
- когда повторный launch должен открыть новое окно, а когда сфокусировать существующее;
- как связать shell state с route/deep-link model;
- как не породить хаотические дубликаты chat/group/search окон.

Нужна стабильная модель объектов и инстансов, достаточная для поэтапной реализации.

## Решение

### 1. В shell фиксируется ограниченный набор первичных объектов

Первичными объектами shell считаются:

- `application` — тип product surface, который может быть запущен;
- `window_instance` — живой экземпляр приложения на desktop;
- `launch_target` — объект или контекст, для которого запускается приложение;
- `shortcut` — desktop/start/explorer entrypoint;
- `folder` — навигационный контейнер shell;
- `search_result` — ссылка на объект или сообщение, открывающая соответствующий app target.

Shell сознательно не вводит filesystem entity, file handle или system process model.

### 2. Каждое окно обязано иметь стабильный identity key

У `window_instance` есть:

- `window_id` — уникальный runtime id инстанса;
- `app_id` — идентификатор приложения;
- `launch_key` — ключ повторного открытия;
- `target` — конкретный объект или screen context;
- `state` — open, focused, minimized, maximized, closed.

Каноническое правило:

- `window_id` различает живые инстансы;
- `launch_key` определяет, должен ли повторный launch переиспользовать уже открытое окно.

### 3. Повторный launch работает через launch policy

Для каждого `app_id` фиксируется launch policy одного из трёх типов:

- `singleton` — один экземпляр на весь shell;
- `singleton_per_target` — один экземпляр на конкретный объект;
- `multi_instance` — допускаются независимые окна одного типа.

### 4. Для MVP принимаются следующие launch policies

- `self_chat` — `singleton`;
- `profile` — `singleton`;
- `people` — `singleton`;
- `friend_requests` — `singleton`;
- `settings` — `singleton`;
- `search` — `singleton`;
- `explorer` — `singleton_per_target`;
- `direct_chat` — `singleton_per_target`;
- `group_chat` — `singleton_per_target`.

Это означает:

- self chat `Я`, Friend Requests, Search и Settings являются обязательными системными app targets shell;
- повторное открытие Settings не создаёт второе окно, а фокусирует/восстанавливает существующее;
- повторное открытие одного и того же direct chat или group chat не плодит дубликаты;
- разные direct chats и разные groups могут жить в отдельных окнах;
- Explorer может иметь отдельные окна для разных folders, если это понадобится конкретному slice.

### 5. Desktop population и persistence подчиняются явным правилам

Desktop entity является shortcut'ом, pinned или auto-populated на рабочую поверхность shell.

Для MVP действуют следующие правила:

- обязательные системные desktop entrypoints включают `Я`, Search, Explorer, Friend Requests и Settings;
- новый friend/direct target и новая group автоматически появляются на desktop, если для них есть место в видимой grid;
- desktop entrypoint переживает reload как shell-local persisted state;
- remove from desktop означает только hide shortcut с desktop;
- hide/remove from desktop не удаляет chat, friendship, group membership или сам объект;
- скрытый объект остаётся discoverable через Explorer, Search и системные folders.

Эти правила нужны, чтобы desktop был primary communication surface, а не декоративной обложкой над launcher.

### 6. Переполнение desktop остаётся bounded и shell-local

Для desktop grid принимается консервативная модель:

- видимая desktop area использует фиксированную сетку;
- иконки не должны бесконечно уменьшаться по мере роста числа объектов;
- когда видимая desktop grid заполнена, новые friend/direct targets и groups отправляются в системные overflow folders, прежде всего `Контакты` и `Группы`;
- overflow routing остаётся shell-local presentation state и не создаёт новых backend contracts.

### 7. Taskbar отражает живые window instances, а не абстрактные приложения

Taskbar item привязан к `window_instance`.

Следствия:

- свернутое окно остаётся в taskbar;
- закрытое окно исчезает из taskbar;
- фокус и restore происходят через конкретный window instance;
- maximized window не скрывает taskbar;
- shell не обязан с первого MVP вводить сложный app-grouping в taskbar.

### 8. Shortcut открывает target, а не безымянную копию окна

Shortcut обязан знать:

- `app_id`;
- `launch_target`, если он конкретный;
- ожидаемую launch policy.

Поэтому:

- shortcut direct chat открывает нужный chat object;
- shortcut системного Search app возвращает существующее search window, если оно уже открыто;
- shortcut folder в Explorer открывает соответствующий folder target, а не абстрактный пустой Explorer.

### 9. Route остаётся deep-link источником для active target

Для MVP route обязан описывать:

- какой app target должен открыться;
- какой target находится в foreground при прямом входе по URL;
- как восстановить продуктовый entrypoint при reload.

Route не обязан описывать:

- координаты всех окон;
- z-order всего desktop;
- все minimized instances.

Это local shell responsibility.

### 10. Search result и system notifications открывают canonical target window

Если shell получает action уровня "открыть direct chat", "открыть group", "открыть settings" или "показать message result",
он обязан:

- найти окно по соответствующему `launch_key`;
- если окно уже существует, сфокусировать и восстановить его;
- если окна нет, создать новый instance по launch policy.

### 11. Window cap для MVP ограничен и не использует скрытый LRU eviction

В MVP shell допускает не более 10 одновременно открытых окон.

Если пользователь пытается открыть 11-е окно:

- shell не закрывает и не сворачивает существующие окна автоматически;
- shell не применяет скрытый LRU eviction;
- действие boundedly отклоняется с system notice;
- пользователь должен явно закрыть, свернуть или сфокусировать нужное окно сам.

Это ограничение не должно ломать future-совместимость с draft recovery и window-state persistence.

### 12. Close и minimize имеют разные semantics

- `minimize` сохраняет окно живым и доступным через taskbar;
- `close` уничтожает instance и его runtime-only placement state;
- повторный launch после `close` создаёт новый instance по тем же правилам launch policy.

## Последствия

### Положительные

- Window model становится предсказуемой и пригодной для маленьких PR.
- Chat/group/search flows получают единые правила повторного открытия.
- Desktop population и overflow semantics перестают быть ad hoc решением каждого slice.
- Local shell state можно строить без попытки сериализовать весь desktop в URL.

### Отрицательные

- Придётся поддерживать отдельный runtime layer для instance management.
- Некоторые current page components нужно будет адаптировать под target-based launch semantics.

### Ограничения

- Нельзя делать ad hoc правила инстансов на уровне каждого компонента без общей launch policy.
- Нельзя плодить дубликаты одного и того же direct/group/search target по умолчанию.
- Нельзя бесконечно уменьшать desktop icons вместо явной overflow-модели.
- Нельзя auto-close'ить окно ради открытия 11-го instance без явного решения пользователя.
- Нельзя требовать, чтобы URL хранил полный desktop layout.

## Альтернативы

### 1. Всегда открывать новое окно на любой launch

Не выбрано, потому что это быстро приводит к хаосу, особенно для chats, groups и settings.

### 2. Держать строго по одному окну на приложение

Не выбрано, потому что desktop shell теряет смысл для параллельной работы с несколькими разговорами и folder contexts.

### 3. Полностью сериализовать весь desktop layout в route

Не выбрано, потому что это чрезмерно усложняет web-модель и плохо соответствует incremental implementation.
