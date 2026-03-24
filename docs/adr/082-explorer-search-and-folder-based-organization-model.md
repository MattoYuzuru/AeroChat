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

Explorer — это не файловый менеджер и не backend storage browser.

Explorer в AeroChat отвечает за:

- обзор основных категорий объектов;
- переход к collections и folders;
- открытие product targets из одной канонической navigational surface;
- организацию shell entrypoint'ов поверх уже существующих product domains.

### 2. Folder model описывает navigation/organization, а не storage semantics

Folders в shell — это:

- системные контейнеры;
- derived collections;
- организационные узлы интерфейса.

Folders не означают:

- серверную файловую систему;
- новый объект хранения для сообщений;
- новый backend domain для media/files.

### 3. Для MVP фиксируются системные folders

MVP folder model опирается на системные folders уровня shell:

- `Рабочий стол`;
- `Чаты`;
- `Группы`;
- `Люди`;
- `Поиск`;
- `Настройки`.

Допускаются derived views внутри Explorer:

- recent chats;
- pinned entrypoints;
- grouped collections по типу объекта.

Server-backed custom folder hierarchy в MVP не вводится.

### 4. Search остаётся отдельным приложением, а не omnibox-магией

Message search остаётся отдельным `Search` app.

Это значит:

- launcher или start menu могут помогать открыть Search;
- shell может искать приложения, folders и shortcuts локально;
- полноценный message search не должен стартовать на каждый символ ввода в глобальной строке shell.

### 5. Privacy-first search boundaries сохраняются без ослабления

Shell обязан сохранить уже принятые правила `ADR-071`:

- legacy plaintext search — server-backed;
- encrypted search — local-only и bounded;
- encrypted query не превращается в скрытый backend request;
- UI явно различает search paths;
- нельзя обещать full global parity для encrypted content.

### 6. Explorer и Search открывают canonical targets

Explorer folder item, launcher result и Search result должны открывать:

- соответствующее приложение;
- соответствующий объект;
- canonical window target по правилам `ADR-080`.

Это предотвращает дублирование несвязанных окон и делает navigation model предсказуемой.

### 7. Folder organization на desktop сначала остаётся shell-local

Любая дополнительная организация shortcut'ов и folder entrypoint'ов в MVP трактуется как shell-local presentation state.

Следствия:

- новые backend contracts не требуются;
- существующие direct/group/people/search/settings data models не переписываются;
- future custom folders можно рассматривать отдельно, если появится реальная продуктовая потребность.

## Последствия

### Положительные

- Пользователь получает понятный навигационный слой сверх набора иконок.
- Search остаётся мощным, но честным относительно privacy и encrypted boundaries.
- Реализация Explorer не требует придумывать fake filesystem или новый backend domain.

### Отрицательные

- MVP Explorer намеренно проще, чем привычный файловый менеджер desktop ОС.
- Пользовательская кастомизация organization model будет ограниченной до отдельного решения.

### Ограничения

- Нельзя называть Explorer файловым менеджером.
- Нельзя вводить folder semantics, которые намекают на backend storage migration без ADR.
- Нельзя превращать shell search в скрытый server-side encrypted search proxy.

## Альтернативы

### 1. Ограничиться только desktop shortcuts без Explorer

Не выбрано, потому что тогда shell быстро становится хрупким и плохо масштабируется при росте числа surfaces.

### 2. Построить полноценный fake filesystem

Не выбрано, потому что это вводит ложные ожидания и не соответствует реальным продуктовым объектам AeroChat.

### 3. Сделать один unified omnibox для apps, chats и encrypted messages

Не выбрано, потому что это либо ломает privacy boundaries, либо притворяется capability, которой у продукта нет.
