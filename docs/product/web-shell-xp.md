# Web Shell XP

## Назначение

Этот документ фиксирует продуктовый канон нового web shell для `apps/web`.

Он нужен, чтобы будущие implementation PR могли:

- двигаться маленькими slice'ами;
- не переоткрывать модель shell в каждом PR;
- не смешивать product vision и архитектурные инварианты;
- не делать ложных claims про "веб-ОС" или finished desktop wrapper.

Этот документ является **product-spec**.

Архитектурные решения, которые нельзя переобсуждать в каждом PR, вынесены в:

- `ADR-079` — desktop shell как primary desktop web surface;
- `ADR-080` — desktop object model и window instance rules;
- `ADR-081` — XP-first theme engine и boot/login application model;
- `ADR-082` — Explorer, Search и folder-based organization model;
- `ADR-083` — practical mobile shell adaptation.

## Продуктовое видение

### Что строится

На desktop AeroChat должен перестать выглядеть как обычная sidebar SPA и стать лёгким desktop-like workspace:

- после входа пользователь попадает не в абстрактную страницу, а в desktop shell;
- основные product-области открываются как приложения и окна;
- shell помогает параллельно держать несколько разговоров и рабочих контекстов;
- визуальный язык отсылает к Windows XP / early glossy desktop UX, но остаётся современным веб-интерфейсом.

### Чем shell не является

Shell не является:

- эмулятором операционной системы;
- обещанием desktop wrapper или native runtime;
- fake filesystem;
- отдельным продуктом поверх чата.

Это web surface для identity, people, direct chats, groups, search, settings и call-aware сценариев,
а не "веб-ОС внутри браузера".

### Главный продуктовый эффект

Пользователь на desktop должен ощущать:

- ясную "точку входа" в продукт;
- узнаваемую визуальную идентичность AeroChat;
- понятный способ открыть несколько разговоров параллельно;
- предсказуемые правила, где искать чаты, группы, людей и поиск;
- честные privacy boundaries, особенно вокруг search и encrypted lanes.

## Карта поверхностей

Новая модель делит web experience на пять поверхностей:

### 1. Boot surface

Короткая системная поверхность, которая:

- показывает запуск приложения;
- скрывает технический bootstrap сессии;
- различает first-run, explicit reboot-to-boot и обычный ежедневный вход;
- при первом запуске или явном reboot-to-boot выводит пользователя в BIOS-like chooser темы;
- после chooser решает, куда вести пользователя дальше: в login app или в desktop shell;
- при валидной сессии и неизменной теме может дать fast-entry bypass сразу в desktop shell.

### 2. Login application

Отдельное приложение входа/регистрации в общей визуальной системе shell.

Оно не является маркетинговым landing page и не живёт в визуальном вакууме относительно остального продукта.
Это канонический pre-auth surface после boot/chooser, а не временный экран "до настоящего продукта".

### 3. Desktop shell

Основная desktop-поверхность после аутентификации:

- desktop background;
- launcher / start entrypoint;
- taskbar;
- desktop icons или эквивалентные shortcut-entrypoints;
- окно или набор окон поверх desktop;
- primary communication surface, а не декоративный launcher поверх старой SPA-навигации.

### 4. Product applications

Внутри shell открываются приложения AeroChat:

- self chat `Я`;
- profile/info surface;
- people;
- friend requests;
- direct chats;
- groups;
- search;
- settings;
- explorer;
- future call-related surfaces там, где это уже поддерживается продуктом.

### 5. Mobile adaptation

На мобильных устройствах сохраняется тот же продуктовый язык, но shell адаптируется в practical full-screen model без desktop window simulation.

## Hard UX Rules

### 1. Desktop shell — главный desktop entrypoint

На достаточно широких экранах authenticated user попадает в desktop shell, а не в старую боковую навигацию как primary experience.

### 2. Login и register — это приложения, а не отдельный визуальный режим

До аутентификации AeroChat должен показывать boot/login flow в той же продуктовой системе,
а не как случайный отдельный экран.

### 3. Shell обслуживает продукт, а не заменяет его

В центре внимания остаются:

- сообщения;
- группы;
- люди;
- поиск;
- настройки;
- ongoing call awareness.

Shell не должен разрастаться в декоративную систему, которая затрудняет доступ к chat-first сценариям.

### 4. Окна должны быть полезными, а не театральными

Window chrome, drag, minimize, maximize и restore допустимы только там, где они реально помогают:

- держать несколько разговоров рядом;
- быстро переключаться между context'ами;
- не терять active thread или search result.

### 5. Никаких fake OS claims

Документация, UI-тексты и implementation не должны утверждать, что AeroChat:

- заменяет ОС;
- даёт полноценный файловый менеджер;
- даёт native desktop guarantees;
- реализует multi-process или system-level app model.

### 6. Search остаётся privacy-first

Shell не меняет уже принятые search boundaries:

- legacy plaintext search остаётся server-backed;
- encrypted search остаётся local-only и bounded;
- shell search не должен незаметно отправлять каждый ввод пользователя в backend;
- точный login всегда приоритизируется над похожими результатами;
- похожие результаты допустимы только как bounded assist, а не как public directory discovery;
- ввод invite link должен открывать preview группы до join, а не выполнять join вслепую;
- там, где это уместно, результат сначала открывает profile/info surface, а не сразу создаёт chat;
- нельзя притворяться "единым глобальным поиском по всему зашифрованному контенту" или публичным каталогом людей.

### 7. Folder model должна быть честной

Explorer и folders описывают навигацию и организацию объектов внутри shell,
но не притворяются серверной файловой системой или новой storage semantics.

Custom folders для shell не являются garnish-фичей:

- это core UX-механизм организации ярлыков и разговоров;
- folder хранит ссылки/shortcut'ы, а не переносит сообщения или группы в новое хранилище;
- один и тот же chat может присутствовать в нескольких folders;
- удаление folder никогда не удаляет chat, friendship или group membership.

### 8. Mobile не копирует desktop буквально

На телефоне нельзя ужимать taskbar, desktop icons и resize handles в неудобный miniature desktop.

Mobile shell обязан оставаться practical:

- fullscreen;
- touch-friendly;
- быстрым;
- понятным с первого входа.

### 9. Performance важнее декоративного избытка

XP-first эстетика допустима только при сохранении лёгкости:

- shell не должен мешать слабым устройствам;
- heavy modules открываются по требованию;
- визуальные эффекты не должны замедлять core chat path;
- мобильная адаптация не должна деградировать из-за desktop-эффектов.

### 10. Текущие продуктовые границы сохраняются

Новый shell не переписывает фундамент репозитория:

- `aero-gateway` остаётся единственной внешней edge-точкой;
- текущие маршруты и page-level product modules могут переиспользоваться;
- encrypted/plaintext coexistence остаётся честным;
- shell не объявляет PWA, offline-first или desktop wrapper готовыми.

### 11. Boot, chooser и fast-entry имеют разные semantics

Канон boot flow в MVP жёстко различает три режима:

- first-run или explicit reboot-to-boot: boot -> BIOS-like chooser темы -> login app или desktop shell в зависимости от валидности сессии;
- обычный вход без смены темы и с валидной сессией: короткий boot -> fast-entry bypass сразу в desktop shell;
- вход без валидной сессии: boot и при необходимости chooser -> login/register application.

Смена темы не применяется посреди активного desktop workspace:

- новая тема становится pending choice;
- применение происходит только после reboot-to-boot или logout/login.

### 12. Desktop — это primary communication surface

Desktop обязан быть функциональным рабочим пространством:

- новые friend/direct targets и новые groups автоматически появляются на desktop как shell entrypoints;
- desktop entity переживает reload и не считается одноразовой декоративной иконкой;
- remove from desktop означает только hide from desktop;
- скрытый объект остаётся доступен через Explorer, Search и системные folders;
- обязательные системные entrypoints shell включают `Я`, `Создать группу`, Search, Explorer, Friend Requests и Settings;
- `Создать группу` остаётся отдельным singleton app и может быть скрыто с рабочего стола без удаления самого entrypoint'а.

### 13. Переполнение desktop должно быть bounded

Desktop использует фиксированную grid-модель:

- иконки не должны бесконечно уменьшаться при росте числа объектов;
- при переполнении видимой области новые объекты маршрутизируются в shell-local overflow folders по умолчанию, прежде всего `Контакты` и `Группы`;
- это правило остаётся локальной UX/presentation семантикой shell и не требует новых backend contracts.

### 14. Explorer — организатор, а не message reader

Explorer в MVP нужен как messenger organizer / manager surface:

- он покрывает folders, contacts, groups, requests и files/media entrypoints;
- он не притворяется filesystem clone;
- он не является каноническим message-thread reader;
- отдельные media viewer apps допустимы позже, но не входят в текущий MVP.

### 15. Window model остаётся bounded и предсказуемой

Для MVP shell придерживается консервативного правила:

- одновременно может быть открыто не более 10 окон;
- открытие 11-го окна не auto-close'ит LRU и не сворачивает окна молча;
- пользователь получает bounded system notice и должен сам закрыть, свернуть или сфокусировать нужное окно;
- это ограничение не должно ломать future draft recovery и window-state persistence.

### 16. Start, taskbar, tray и context menus являются частью канона

Даже в MVP интеракционная модель должна быть явной:

- Start остаётся launcher-first entrypoint;
- позже в нём могут появиться recent apps/chats, но это не обязательно для первого slice;
- taskbar показывает активные и свернутые окна;
- maximize не скрывает taskbar;
- правая tray-зона может содержать clock/date и shell-level placeholders для UI sounds и network/activity;
- desktop entity context menus входят в intended UX и не считаются лишней декоративной деталью.

## Основные пользовательские сценарии

### Boot и вход

Пользователь открывает AeroChat и видит:

1. короткий boot state;
2. BIOS-like chooser темы при first-run или explicit reboot-to-boot;
3. login/register application, если сессии нет или она невалидна;
4. desktop shell, если сессия восстановлена или только что создана.

Для ежедневного входа действует fast-entry правило:

- при валидной сессии и неизменной теме boot может вести сразу в desktop shell;
- pending theme change применяется только через reboot/logout path, а не hot-swap внутри активного desktop.

### Ежедневная desktop-работа

Пользователь после входа:

1. видит рабочий стол с системными entrypoints `Я`, `Создать группу`, Search, Explorer, Friend Requests и Settings;
2. получает на desktop новые friend/direct targets и новые groups автоматически;
3. открывает direct chat, группу, search или settings как окно;
4. может держать несколько контекстов параллельно в пределах bounded window cap;
5. возвращается к уже открытому окну без потери объекта;
6. при hide/remove from desktop не теряет доступ к сущности через Explorer, Search и folders.

### Навигация через Explorer

Пользователь должен иметь системный способ:

- увидеть основные категории объектов;
- открыть список direct chats, groups, people, requests и media entrypoints не только через pinned shortcut;
- использовать folders как понятный IA-слой над объектами продукта;
- создавать свои folders для организации shortcut'ов и чатов без storage move semantics.

### Поиск и переход к результату

Пользователь запускает Search app, выполняет поиск и получает:

- exact-login-first user lookup без public-directory drift;
- bounded похожие результаты только как assist;
- group invite preview перед join при вводе invite link;
- legacy plaintext results;
- encrypted local results;
- честный переход в нужный profile/info или chat/group context;
- честную деградацию, если encrypted target не materialized локально.

### Mobile use

Пользователь на телефоне:

- проходит тот же boot/login flow;
- попадает в practical launcher/home surface;
- открывает приложения fullscreen;
- не сталкивается с forced desktop simulation.

## MVP

MVP нового shell включает только то, что нужно для первого реального product slice.

### MVP surface

- desktop shell как primary surface на desktop;
- XP-first visual theme без theme marketplace и без кастомизатора;
- boot surface c BIOS-like chooser для first-run и reboot path;
- login/register application model;
- desktop как primary communication surface;
- taskbar, start/launcher и базовая tray-зона;
- desktop shortcuts и context menus для основных приложений и chat/group entities;
- window manager foundation c open/focus/minimize/maximize/restore/close;
- жёсткий лимит в 10 открытых окон без LRU auto-close;
- shell-local fixed grid и overflow routing в системные folders;
- re-use существующих product screens внутри новой windowed оболочки.

### MVP applications

- self chat `Я`;
- profile/info surface в одном оконном семействе;
- people;
- friend requests;
- chats;
- groups;
- search;
- settings;
- explorer как системный навигационный entrypoint;
- custom folders как core shell UX.

### MVP rules по окнам

- одно и то же действие не должно плодить хаотичные дубликаты одного объекта;
- direct/group threads должны открываться предсказуемо;
- taskbar должен отражать реальные открытые окна;
- повторный launch должен фокусировать или восстанавливать ожидаемое окно;
- 11-е окно должно boundedly отклоняться через system notice, а не через скрытый auto-close.

### MVP search boundaries

- Search app остаётся отдельным приложением;
- legacy/encrypted path показываются раздельно;
- shell-level launcher search не подменяет message search;
- encrypted local search не расширяется до server-assisted global model.

### MVP folders / explorer

- системные folders, overflow folders и custom folders shell-local уровня;
- переход к chats, groups, people, requests, search, settings и files/media entrypoints через Explorer;
- custom folders хранят references/shortcuts и могут содержать один chat в нескольких местах;
- badge folder показывает количество chat targets с unread, а не сумму сообщений;
- без nested folders в V1;
- без server-backed custom folder storage;
- без fake file operations.

### MVP mobile adaptation

- full-screen shell adaptation;
- единая модель boot/login/app launch;
- без drag/resize windows;
- без desktop-like clutter на маленьком экране.

## Deferred

Следующие вещи сознательно **не входят** в этот documentation-driven MVP:

- PWA install flow, service worker и offline model;
- push notifications;
- desktop wrapper;
- multi-workspace / multi-desktop model;
- advanced snapping, tiling и keyboard-heavy power-user window management;
- theme packs beyond XP;
- custom wallpapers, wallpaper manager, advanced sounds и user theme editor;
- server-backed custom folder hierarchy;
- unified omnibox с серверной индексацией encrypted content;
- trash / recycle bin semantics;
- pinned folder model;
- dedicated media viewer applications;
- file-manager claims;
- widgets, gadgets и decorative shell toys;
- полноценный global call manager сверх уже существующего bounded RTC slice.

## Что future PR не должны переоткрывать

Future implementation PR не должны заново решать:

- является ли desktop shell primary desktop surface;
- является ли mobile отдельной practical adaptation, а не literal desktop clone;
- является ли search privacy-first и двухконтурным;
- является ли Explorer навигационной моделью, а не fake filesystem;
- являются ли custom folders core shell UX, а не garnish;
- является ли desktop primary communication surface, а не просто launcher wall;
- является ли overflow shell-local и bounded;
- являются ли login/register частью общей shell-модели;
- является ли XP-first theme базовой визуальной системой по умолчанию.

## Как читать этот документ вместе с ADR

Используйте этот документ для ответа на вопросы:

- какой продуктовый опыт строится;
- какие сценарии обязаны появиться;
- что входит в MVP;
- что отложено.

Используйте `ADR-079`...`ADR-083` для ответа на вопросы:

- какие архитектурные границы нельзя нарушать;
- как трактовать объекты shell и правила инстансов;
- как theme/boot/login связаны с приложением;
- где проходят search и folder boundaries;
- как desktop-модель адаптируется на mobile.
