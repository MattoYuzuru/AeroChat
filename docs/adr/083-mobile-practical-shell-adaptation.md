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

### 8. Ошибка отправки остаётся в активной переписке

Feedback composer размещается один раз внутри его существующего scroll
viewport, а не в overview, который скрывается при открытии mobile conversation.
После отказа отправки собственный viewport composer показывает feedback без
scroll страницы/history и без перехвата keyboard focus. Длинная ошибка имеет
bounded собственный scroll и доступна через Tab; textarea связывается с ней
через уникальный aria-describedby. Изменение текста очищает ошибку как раньше.
Черновик, send state, crypto и read semantics этим не меняются; history и
textarea сохраняют принятые минимальные размеры, даже если composer требуется
прокрутить для следующего действия.

### Уточнение 13 октября 2026: pinned summary и бюджет composer (Accepted)

В выбранной mobile direct/self conversation optional pinned summary не получает
неограниченную высоту за счёт history или composer. History сохраняет минимум
48 CSS px полезного viewport без padding. Composer резервирует видимую высоту
текущего textarea в пределах существующего max-height вместе со своим padding;
после обычного Tab-фокуса textarea целиком виден, имеет ширину не меньше 140 CSS px
и высоту не меньше 39 CSS px. Reply/attachment/error остаются в собственном scroll
composer и не прокручивают страницу или history.

При нехватке высоты pinned summary получает bounded presentation: ordinal и
действия перехода остаются доступны, preview/metadata могут иметь собственный
scroll или визуальное сокращение с сохранением доступного текста и существующего
перехода к сообщению. Кнопки не меньше 32 CSS px целиком видны после Tab-фокуса;
нельзя скрывать сам pin или менять tombstone/read/crypto semantics ради geometry
PASS. Desktop presentation и backend contracts этим не меняются.

Representative fixture обязан включать actual production DOM pinned row:
ordinal, timestamp, длинный preview и tombstone. Synthetic DOM/CSS проверка
дополняет actual owned message-page geometry; она не заменяет iOS/Android OS
keyboard/touch или native browser zoom.

### Уточнение 13 октября 2026: pinned summary в коротком landscape (Accepted)

При коротком landscape с одной строкой composer optional pin и history делят
остаток высоты thread grid после header и composer. Auto row pin не может
вытеснять textarea за clipping boundary thread. History сохраняет 48 CSS px,
composer — существующий минимум 50 CSS px; размеры действий не уменьшаются.
Pinned row резервирует текущую высоту кнопки и border, без вертикального
padding контейнера. Card имеет bounded собственный scroll для ordinal,
metadata и preview с сохранением всего текста, tombstone и перехода к сообщению.
Уточнение применяется только к direct/self с pin при высоте до 500 CSS px и
ширине 500–1179 CSS px; portrait, group и desktop presentation не меняются.

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
