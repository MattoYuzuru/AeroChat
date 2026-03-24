# ADR-082: Explorer, Search и folder-based organization model

- Статус: Accepted
- Дата: 2026-03-24

## Контекст

После `ADR-079`...`ADR-081` shell получает desktop surface, object model и theme canon.

Остаются два критичных вопроса product IA:

- как пользователь ориентируется в объектах shell помимо pinned shortcuts;
- как совместить Explorer и Search с уже принятыми privacy/search boundaries.

Без отдельного решения легко скатиться либо в fake filesystem,
либо в "глобальный поиск по всему" с ложными claims относительно encrypted data.

## Решение

### 1. Explorer становится системным навигационным приложением shell

Explorer — это не файловый менеджер, не backend storage browser и не message-thread reader.

Explorer в AeroChat отвечает за:

- обзор основных категорий объектов;
- переход к collections и folders;
- открытие product targets из одной канонической navigational surface;
- организацию shell entrypoint'ов поверх уже существующих product domains;
- messenger-manager сценарии для contacts, groups, requests и files/media entrypoints.

Explorer не обязан:

- читать и рендерить message thread как основную задачу;
- имитировать filesystem tree;
- подменять собой отдельные product applications.

### 2. Folder model описывает navigation/organization, а не storage semantics

Folders в shell — это:

- системные контейнеры;
- derived collections;
- custom organizational nodes;
- организационные узлы интерфейса.

Folders не означают:

- серверную файловую систему;
- новый объект хранения для сообщений;
- новый backend domain для media/files.

Дополнительные канонические правила:

- folder хранит references/shortcuts, а не переносит chat или group в другое место хранения;
- один и тот же chat может существовать в нескольких folders;
- удаление folder никогда не удаляет chat, group или friendship;
- nested folders не входят в V1.

### 3. Custom folders являются core shell UX, но остаются shell-local в MVP

Custom folders не считаются garnish-возможностью.

Они нужны как основной пользовательский способ:

- разложить chats и groups по своим логическим наборам;
- убрать desktop clutter без потери discoverability;
- строить свой рабочий messenger layout поверх канонических объектов.

Для MVP действуют ограничения:

- custom folders живут как shell-local organization state;
- server-backed hierarchy и sync между устройствами не вводятся;
- unread badge folder показывает количество chat targets с unread, а не сумму unread сообщений.

### 4. Для MVP фиксируются системные folders и collections

MVP folder model опирается на системные folders уровня shell:

- `Рабочий стол`;
- `Контакты`;
- `Группы`;
- `Запросы`;
- `Файлы и медиа`;
- `Поиск`;
- `Настройки`.

Допускаются derived views внутри Explorer:

- recent chats;
- pinned entrypoints;
- grouped collections по типу объекта.

Trash и отдельный pinned-folder surface остаются deferred.

### 5. Search остаётся отдельным приложением, а не omnibox-магией

Message search остаётся отдельным `Search` app.

Это значит:

- launcher или start menu могут помогать открыть Search;
- shell может искать приложения, folders и shortcuts локально;
- полноценный message search не должен стартовать на каждый символ ввода в глобальной строке shell.

### 6. Privacy-first search boundaries и lookup semantics сохраняются без ослабления

Shell обязан сохранить уже принятые правила `ADR-071`:

- legacy plaintext search — server-backed;
- encrypted search — local-only и bounded;
- encrypted query не превращается в скрытый backend request;
- UI явно различает search paths;
- точный login всегда приоритизируется в user lookup;
- похожие результаты допустимы только как bounded assist, а не как public social discovery;
- invite link input должен открывать preview группы перед join;
- результат поиска человека там, где это уместно, открывает сначала profile/info surface;
- нельзя обещать full global parity для encrypted content или публичный каталог пользователей.

### 7. Explorer и Search открывают canonical targets

Explorer folder item, launcher result и Search result должны открывать:

- соответствующее приложение;
- соответствующий объект;
- canonical window target по правилам `ADR-080`.

Это предотвращает дублирование несвязанных окон и делает navigation model предсказуемой.

### 8. Folder organization на desktop сначала остаётся shell-local

Любая дополнительная организация shortcut'ов и folder entrypoint'ов в MVP трактуется как shell-local presentation state.

Следствия:

- новые backend contracts не требуются;
- существующие direct/group/people/search/settings data models не переписываются;
- future server-backed custom folders можно рассматривать отдельно, если появится реальная продуктовая потребность.

### 9. Explorer scope может расширяться позже, но в понятных границах

После MVP Explorer может получить дополнительные surface'ы:

- trash;
- pinned folder;
- richer media management.

Но dedicated media viewer apps остаются отдельным deferred направлением, а не обязанностью MVP Explorer.

## Последствия

### Положительные

- Пользователь получает понятный навигационный слой сверх набора иконок.
- Search остаётся мощным, но честным относительно privacy и encrypted boundaries.
- Custom folders получают статус core UX и перестают читаться как второстепенный garnish.
- Реализация Explorer не требует придумывать fake filesystem или новый backend domain.

### Отрицательные

- MVP Explorer намеренно проще, чем привычный файловый менеджер desktop ОС.
- Пользовательская кастомизация organization model будет ограниченной до отдельного решения.

### Ограничения

- Нельзя называть Explorer файловым менеджером.
- Нельзя вводить folder semantics, которые намекают на backend storage migration без ADR.
- Нельзя трактовать folder deletion как удаление самих chat/group объектов.
- Нельзя превращать shell search в скрытый server-side encrypted search proxy.

## Альтернативы

### 1. Ограничиться только desktop shortcuts без Explorer

Не выбрано, потому что тогда shell быстро становится хрупким и плохо масштабируется при росте числа surfaces.

### 2. Построить полноценный fake filesystem

Не выбрано, потому что это вводит ложные ожидания и не соответствует реальным продуктовым объектам AeroChat.

### 3. Сделать один unified omnibox для apps, chats и encrypted messages

Не выбрано, потому что это либо ломает privacy boundaries, либо притворяется capability, которой у продукта нет.
