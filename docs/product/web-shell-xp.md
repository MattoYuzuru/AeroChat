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
- решает, куда вести пользователя дальше: в login app или в desktop shell.

### 2. Login application

Отдельное приложение входа/регистрации в общей визуальной системе shell.

Оно не является маркетинговым landing page и не живёт в визуальном вакууме относительно остального продукта.

### 3. Desktop shell

Основная desktop-поверхность после аутентификации:

- desktop background;
- launcher / start entrypoint;
- taskbar;
- desktop icons или эквивалентные shortcut-entrypoints;
- окно или набор окон поверх desktop.

### 4. Product applications

Внутри shell открываются приложения AeroChat:

- profile;
- people;
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
- нельзя притворяться "единым глобальным поиском по всему зашифрованному контенту".

### 7. Folder model должна быть честной

Explorer и folders описывают навигацию и организацию объектов внутри shell,
но не притворяются серверной файловой системой или новой storage semantics.

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

## Основные пользовательские сценарии

### Boot и вход

Пользователь открывает AeroChat и видит:

1. короткий boot state;
2. login application, если сессии нет или она невалидна;
3. desktop shell, если сессия восстановлена.

### Ежедневная desktop-работа

Пользователь после входа:

1. видит рабочий стол с понятными app entrypoints;
2. открывает direct chat, группу, search или settings как окно;
3. может держать несколько контекстов параллельно;
4. возвращается к уже открытому окну без потери объекта.

### Навигация через Explorer

Пользователь должен иметь системный способ:

- увидеть основные категории объектов;
- открыть список direct chats, groups и people не только через pinned shortcut;
- использовать folders как понятный IA-слой над объектами продукта.

### Поиск и переход к результату

Пользователь запускает Search app, выполняет поиск и получает:

- legacy plaintext results;
- encrypted local results;
- честный переход в нужный chat/group context;
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
- boot surface;
- login/register application model;
- taskbar и launcher/start entrypoint;
- desktop shortcuts для основных приложений;
- window manager foundation c open/focus/minimize/maximize/restore/close;
- re-use существующих product screens внутри новой windowed оболочки.

### MVP applications

- profile;
- people;
- chats;
- groups;
- search;
- settings;
- explorer как системный навигационный entrypoint.

### MVP rules по окнам

- одно и то же действие не должно плодить хаотичные дубликаты одного объекта;
- direct/group threads должны открываться предсказуемо;
- taskbar должен отражать реальные открытые окна;
- повторный launch должен фокусировать или восстанавливать ожидаемое окно.

### MVP search boundaries

- Search app остаётся отдельным приложением;
- legacy/encrypted path показываются раздельно;
- shell-level launcher search не подменяет message search;
- encrypted local search не расширяется до server-assisted global model.

### MVP folders / explorer

- системные folders и derived collections;
- переход к chats, groups, people, search и settings через Explorer;
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
- custom wallpapers, theme packs, dark mode packs и user theme editor;
- server-backed custom folder hierarchy;
- unified omnibox с серверной индексацией encrypted content;
- trash / recycle bin semantics;
- file-manager claims;
- widgets, gadgets и decorative shell toys;
- полноценный global call manager сверх уже существующего bounded RTC slice.

## Что future PR не должны переоткрывать

Future implementation PR не должны заново решать:

- является ли desktop shell primary desktop surface;
- является ли mobile отдельной practical adaptation, а не literal desktop clone;
- является ли search privacy-first и двухконтурным;
- является ли Explorer навигационной моделью, а не fake filesystem;
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
