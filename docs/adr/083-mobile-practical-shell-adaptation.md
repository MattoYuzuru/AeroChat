# ADR-083: Mobile practical shell adaptation

- Статус: Accepted
- Дата: 2026-03-24

## Контекст

`ADR-005` уже фиксировал, что mobile UX не должен буквально копировать desktop shell.

После принятия desktop shell canon в `ADR-079`...`ADR-082` это ограничение нужно уточнить,
иначе future implementation PR могут:

- попытаться ужать taskbar, desktop icons и multiple windows в узкий экран;
- ухудшить touch UX ради визуальной верности desktop;
- разойтись в pre-auth/post-auth flows между desktop и mobile.

Нужна отдельная архитектурная договорённость о practical mobile adaptation.

## Решение

### 1. Mobile shell сохраняет тот же продуктовый канон, но не literal desktop form

На mobile AeroChat остаётся тем же продуктом:

- boot;
- login/register;
- launcher/home surface;
- product apps;
- search;
- settings.

Но форма подачи адаптируется под touch/fullscreen usage.

### 2. На mobile primary model — fullscreen app flow

Основное правило:

- в foreground находится одно полноэкранное приложение или screen context;
- окна как draggable/resizable desktop entities не являются обязательной mobile capability;
- foreground navigation важнее параллельного размещения нескольких окон на экране.

### 3. Mobile launcher может быть проще desktop launcher

На mobile допустимы:

- compact home surface;
- grid/list of apps;
- recent entrypoints;
- quick access к chats/groups/search/settings.

Не требуются:

- literal desktop wallpaper c свободным размещением иконок;
- taskbar в desktop-виде;
- resize handles;
- overlapping windows.

### 4. Object model сохраняется, presentation меняется

`application`, `launch_target`, `folder` и canonical target semantics из desktop shell сохраняются.

Меняется только форма presentation:

- вместо desktop window может использоваться fullscreen panel;
- restore/focus semantics могут выражаться через navigation stack или recent app surface;
- direct/group targets остаются теми же объектами, что и на desktop.

### 5. Search, privacy и encrypted boundaries одинаковы на всех form factors

Mobile adaptation не меняет search model:

- legacy plaintext search остаётся server-backed;
- encrypted search остаётся local-only и bounded;
- mobile UI не получает поблажек на privacy boundary ради "универсального поиска".

### 6. Theme engine остаётся общей, но mobile не обязан повторять весь desktop chrome

Mobile reuse'ит XP-first theme engine,
но может использовать более спокойный и компактный chrome.

Допустима адаптация:

- taskbar -> compact launcher/navigation surface;
- large chrome -> tighter mobile frame;
- desktop window header -> mobile app header.

### 7. Mobile shell не должен тормозить и не должен быть desktop burden

Любой desktop-oriented эффект или паттерн должен быть отброшен на mobile, если он:

- ухудшает touch ergonomics;
- мешает быстрому входу в chat;
- визуально захламляет экран;
- бьёт по производительности на слабых устройствах.

## Последствия

### Положительные

- Один продуктовый канон сохраняется на desktop и mobile без раздвоения доменной модели.
- Mobile implementation получает ясную свободу не копировать desktop буквально.
- Future PR могут строить responsive/adaptive shell без спора о базовой философии.

### Отрицательные

- Часть "desktop магии" неизбежно будет ослаблена на мобильных устройствах.
- Потребуется отдельная дисциплина, чтобы держать parity смыслов без parity формы.

### Ограничения

- Нельзя обещать literal desktop shell на телефоне.
- Нельзя ухудшать mobile usability ради визуального фетиша по desktop XP.
- Нельзя делать отдельную backend product model только ради mobile shell.

## Альтернативы

### 1. Один-в-один переносить desktop shell на mobile

Не выбрано, потому что это даёт плохой touch UX и прямо противоречит уже принятому курсу из `ADR-005`.

### 2. Сделать для mobile полностью другой продуктовый IA

Не выбрано, потому что тогда desktop и mobile начнут расходиться уже на уровне моделей приложений и target semantics.

### 3. Вообще отказаться от shell-модели на mobile

Не выбрано, потому что проекту всё ещё нужен единый продуктовый язык и единая boot/login/app structure.
