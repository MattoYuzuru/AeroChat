# ADR-079: Desktop shell как primary desktop web surface

- Статус: Accepted
- Дата: 2026-03-24

## Контекст

На март 2026 года `apps/web` уже является рабочим SPA-клиентом с route-based workspace:

- `/login` и `/register` дают auth bootstrap;
- `/app/profile`, `/app/chats`, `/app/groups`, `/app/search`, `/app/people`, `/app/settings` дают usable product slices;
- shell сегодня остаётся лёгкой page-oriented оболочкой, а не desktop-like продуктовой поверхностью.

При этом в каноне проекта уже зафиксировано направление из `ADR-005`:

- desktop-like shell на ПК;
- practical mobile adaptation;
- performance-first ограничение;
- отказ от буквальной эмуляции ОС.

Для дальнейшей реализации нужен новый канон, который:

- делает desktop shell primary desktop surface;
- не ломает gateway-only web architecture;
- не подменяет продукт фейковой "веб-ОС";
- позволяет разбить работу на много узких PR без повторного спора о базовой модели.

## Решение

### 1. На desktop primary authenticated surface становится desktop shell

Для desktop/wide-screen сценариев authenticated user после boot/login попадает в desktop shell как в главный продуктовый entrypoint.

Следствия:

- боковая route-nav из текущего `AppShell` перестаёт быть целевой финальной desktop-моделью;
- основные product-capabilities открываются внутри shell как приложения или окна;
- old page-oriented shell допускается только как текущая реализация до поэтапной замены.

### 2. Shell остаётся веб-оболочкой продукта, а не эмулятором ОС

Desktop shell разрешает:

- wallpaper/background surface;
- launcher/start entrypoint;
- taskbar;
- окна и window focus;
- одновременную работу с несколькими контекстами.

Но shell не объявляется:

- операционной системой;
- desktop wrapper;
- файловой системой;
- средой выполнения сторонних приложений.

### 3. Product domains открываются как shell applications

К shell applications относятся прежде всего:

- profile;
- people;
- chats;
- groups;
- search;
- settings;
- explorer;
- future call-related UI только там, где это уже подтверждено продуктом.

Shell не создаёт отдельный второй продукт поверх этих доменов, а лишь меняет основной desktop entrypoint и способ композиции экранов.

### 4. Gateway-only и текущие service boundaries сохраняются

Новый shell не меняет текущую системную архитектуру:

- `aero-gateway` остаётся единственной внешней edge-точкой;
- ownership identity/chat/rtc не переносится во frontend;
- encrypted/plaintext coexistence не переписывается ради shell;
- search boundaries из `ADR-071` сохраняются.

### 5. Route model остаётся опорной, но не равной всему layout state

Веб-маршруты продолжают существовать как deep-link surface для product entrypoint'ов и конкретных объектов,
но не обязаны сериализовать полный desktop layout.

Следствия:

- route может открывать нужное приложение или конкретный chat/group object;
- local shell state может хранить window placement, focus order и minimized state отдельно;
- implementation не обязана превращать URL в полную сериализацию всех окон на рабочем столе.

### 6. Desktop shell внедряется поэтапно

Этот ADR фиксирует только базовый курс:

- primary desktop surface;
- windowed app model;
- сохранение существующих product domains.

Он не требует внедрять всё одним PR и не санкционирует массовый frontend rewrite.

## Последствия

### Положительные

- У проекта появляется недвусмысленный desktop UX canon для дальнейших PR.
- Future implementation PR могут строить shell частями, не споря о главной модели.
- Сохраняется уникальная визуально-продуктовая идентичность AeroChat.

### Отрицательные

- Frontend state и routing станут сложнее, чем в чистой page-based SPA.
- Потребуется дисциплина, чтобы shell не начал диктовать backend или product semantics.

### Ограничения

- Нельзя продолжать описывать page-nav shell как целевой desktop UX.
- Нельзя называть новую поверхность "веб-ОС" или "desktop wrapper".
- Нельзя смешивать shell migration с opportunistic refactor всех web modules.

## Альтернативы

### 1. Оставить desktop shell только декоративной темой поверх sidebar SPA

Не выбрано, потому что тогда уникальное desktop-like направление проекта оставалось бы чисто косметическим и не давало бы реального product effect.

### 2. Сразу делать буквальную ОС-эмуляцию

Не выбрано, потому что это противоречит `ADR-005`, ухудшает производительность и создаёт ложные product claims.

### 3. Держать один и тот же page shell для desktop и mobile

Не выбрано, потому что это снова размывает desktop direction и мешает practical mobile adaptation.
