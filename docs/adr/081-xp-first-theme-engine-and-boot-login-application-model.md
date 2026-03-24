# ADR-081: XP-first theme engine и boot/login application model

- Статус: Accepted
- Дата: 2026-03-24

## Контекст

После `ADR-079` и `ADR-080` нужно отдельно зафиксировать две вещи:

- какой визуальный язык является каноническим для нового shell;
- как в эту модель входят boot, login и register.

Без этого future PR могут:

- сделать shell как набор случайных one-off стилей;
- оставить auth flow полностью отдельным от shell-модели;
- раньше времени строить theme customizer, dark-mode matrix или pseudo-system preferences center.

Нужен минимальный, но жёсткий канон.

## Решение

### 1. Базовой визуальной системой принимается XP-first theme

Новый shell использует **XP-first** направление:

- светлая glossy palette;
- мягкий desktop chrome;
- узнаваемые taskbar/window/login surfaces;
- отсылка к Windows XP / early Aero без буквального копирования.

Это становится основным visual canon для desktop shell и связанных pre-auth surfaces.

### 2. Theme engine остаётся централизованным token-driven слоем

Theme engine должен строиться вокруг общего token/chrome слоя:

- цвета;
- surface gradients;
- border/chrome rules;
- depth/shadow rules;
- wallpaper/background primitives;
- window/taskbar/start/login variants.

Следствия:

- нельзя разводить тему как набор несвязанных page-specific CSS решений;
- нельзя строить shell поверх heavy UI framework;
- существующая token architecture в `apps/web` должна эволюционировать, а не заменяться стихийно.

### 3. Для MVP тема одна

До отдельного решения в продукте есть один канонический shell theme:

- XP-first;
- light-first;
- без user theme marketplace;
- без wallpaper editor;
- без dark-mode parity claims.

Изменяемость темы и персонализация остаются deferred scope.

### 4. Boot — это часть приложения, а не технический placeholder

Boot surface является полноценной частью app model.

Она отвечает за:

- initial visual entry;
- session bootstrap state;
- переход к login app или desktop shell.

Boot surface не должна выглядеть как generic loading screen из unrelated дизайна.

### 5. Login и register входят в ту же application model

`/login` и `/register` трактуются как состояния auth application внутри общей shell-системы:

- с общей темой;
- с общими chrome-принципами;
- без отдельного маркетингового layout language.

При этом до аутентификации не требуется показывать desktop с taskbar и окнами в полном виде.

### 6. Pre-auth и post-auth различаются по surface, но не по design system

Канон выглядит так:

- pre-auth: boot surface и auth app;
- post-auth: desktop shell и product apps.

Обе стадии принадлежат одному продукту и одной theme engine.

### 7. Theme engine не должен ломать performance policy

XP-first тема допускает:

- gradients;
- glossy highlights;
- узнаваемый chrome;
- controlled motion.

Но не допускает:

- постоянный дорогой blur everywhere;
- тяжёлую анимационную систему ради декора;
- сложный theme runtime, который замедляет core routes;
- desktop-only визуальные решения, ухудшающие mobile adaptation.

## Последствия

### Положительные

- Shell и auth flow будут ощущаться как части одного продукта.
- Visual direction фиксируется достаточно рано и перестаёт быть предметом вкусовых споров в каждом PR.
- Будущие PR могут вводить taskbar/window/login surfaces на общей token базе.

### Отрицательные

- До отдельного решения продукт сознательно ограничивает theme flexibility.
- Часть visual polish придётся делать дисциплинированно, а не через быстрые one-off стили.

### Ограничения

- Нельзя превращать текущий shell PR-ряд в theme marketplace project.
- Нельзя отделять login/register в визуально чуждый мини-продукт.
- Нельзя объявлять dark mode, wallpaper personalization или full customization частью MVP без отдельного решения.

## Альтернативы

### 1. Оставить только общий vague glossy style без конкретного арт-направления

Не выбрано, потому что тогда shell снова будет дрейфовать между случайными вариантами и потеряет узнаваемую идентичность.

### 2. Сразу строить полноценный theme/customization framework

Не выбрано, потому что это резко расширяет scope и не нужно для первого shell MVP.

### 3. Оставить auth flow полностью отдельным от shell

Не выбрано, потому что тогда boot/login experience разрывает продуктовый образ и мешает цельному входу в AeroChat.
