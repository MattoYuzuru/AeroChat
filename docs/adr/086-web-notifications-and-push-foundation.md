# ADR-086: Web notifications и push foundation

- Статус: Accepted
- Дата: 2026-03-28

## Контекст

`README`, `roadmap` и audit уже фиксируют, что notifications/PWA остаются подтверждённым продуктовым gap:

- unread foundation есть, но это не notification transport;
- `apps/web` уже имеет settings entrypoint, desktop/mobile shell и realtime delivery;
- incoming friend requests уже живут как realtime-события через `aero-gateway`;
- service worker и browser push пока не реализованы;
- пользователю нужен минимальный, но реальный notification slice:
  - global actions `Включить везде` и `Выключить везде` в настройках;
  - per-chat toggle без UI redesign;
  - browser permission request в явной точке взаимодействия;
  - push для direct/group messages и friend requests;
  - отсутствие OS-level notifications, если приложение уже открыто и видно пользователю;
  - сохранение unread badges в shell как in-app attention layer.

Также нужно сохранить уже принятые инварианты:

- внешний backend edge остаётся одним через `aero-gateway`;
- unread не подменяется notification-center моделью;
- shell остаётся XP/mobile launcher style и не превращается в новый heavy settings center;
- encrypted lanes не могут внезапно получить server-side plaintext preview без нарушения crypto boundary.

## Решение

### 1. Notifications вводятся как отдельный platform slice поверх existing unread foundation

Notification slice не перестраивает unread model и не заменяет realtime.

Он добавляет:

- browser push subscription lifecycle;
- global notification preference текущего пользователя;
- viewer-local per-direct/per-group notification preference;
- service worker delivery/open behavior;
- shell badge aggregation.

Unread остаётся source of truth для in-app badges и suppression semantics,
но не считается сам по себе notification transport.

### 2. Global preference принадлежит identity, per-conversation preference принадлежит chat domain

Принимается следующее разделение:

- `aero-identity` хранит глобальный пользовательский флаг push/browser notifications и web-push subscriptions;
- `aero-chat` хранит viewer-local preference по direct chats и groups;
- `apps/web` читает глобальный флаг через current profile/settings,
  а per-chat flags получает из chat/group snapshots и меняет явными chat RPC.

Это сохраняет ownership:

- account/device/browser subscription semantics остаются около identity;
- conversation-specific behaviour остаётся у chat domain.

### 3. Push отправляют сами доменные сервисы, а не gateway

Несмотря на то, что внешний edge один, push dispatch не переносится в `aero-gateway`.

Причины:

- gateway не должен получать приватный доступ к subscription storage как к своей доменной модели;
- для message notifications источник истины находится в `aero-chat`;
- для friend-request notifications источник истины находится в `aero-identity`;
- shared Postgres уже используется сервисами, поэтому оба сервиса могут читать общие subscription rows без отдельного internal-auth transport slice.

Оба сервиса используют shared Go helper для Web Push delivery, но ownership событий остаётся у доменных сервисов.

### 4. Anti-abuse policy: push отправляется только когда conversation переходит в unread state

Чтобы не превратить feature в spam machine, для message notifications принимается минимальная строгая политика:

- push на direct/group message отправляется только если для конкретного получателя unread count по conversation стал равен `1`;
- если у пользователя уже есть unread в этом conversation, новые message pushes не отправляются;
- после mark-as-read следующий новый message снова может породить один push;
- friend request остаётся единичным событием и не требует отдельного cooldown layer.

Это даёт bounded attention model без новой jobs-платформы и без сложного rate-limiter storage.

### 5. Видимое приложение suppress'ит OS-level notification на стороне service worker

Если AeroChat уже открыт и видим пользователю, service worker не показывает OS-level notification.

Для этого service worker:

- на событии `push` проверяет открытые window clients текущего origin;
- если есть хотя бы один `visible` client, не вызывает `showNotification`;
- при этом server-side push dispatch всё равно допустим, потому что suppression происходит локально и не требует нового foreground-presence backend transport.

In-app unread badges при этом продолжают работать как usual.

### 6. Preview policy остаётся честной относительно encrypted lanes

Server-side notification preview допускается только там, где у сервера действительно есть безопасный bounded text preview.

Следствия:

- для plaintext-compatible message path допускается короткий truncated preview;
- для encrypted direct/group lanes push payload не притворяется plaintext preview и использует generic copy;
- sender/group identity и timestamp допускаются как notification metadata;
- richer encrypted preview возможен только в будущем PWA/runtime slice с локальным decrypt-capable background model, но не в этом PR.

### 7. Service worker вводится узко, без полного PWA slice

В текущем PR service worker отвечает только за:

- получение push payload;
- suppress/showNotification policy;
- `notificationclick` navigation в canonical route-backed target.

Он сознательно не означает:

- finished PWA install flow;
- offline model;
- cache strategy;
- background sync subsystem;
- full mobile wrapper semantics.

При этом settings UI и runtime code должны уже оставлять место под будущий раздел `PWA`.

### 8. Shell badges показывают количество unread targets, а не сумму сообщений

Desktop/mobile shell badges для `Чаты`, `Группы` и related entrypoints показывают количество targets,
в которых есть unread state, а не сумму всех непрочитанных сообщений.

Это согласовано с уже принятым shell rule для custom folders и не раздувает attention layer.

## Последствия

### Положительные

- Пользователь получает реальные browser notifications и background push foundation без нового внешнего push-сервиса.
- Settings и chat info surfaces получают честные notification controls.
- Friend requests и new unread conversations начинают работать как полноценные attention events.
- Shell badges остаются согласованными между desktop и mobile launcher.
- Будущий PWA/install slice сможет опереться на уже существующий service worker и notification settings surface.

### Отрицательные

- `aero-identity` и `aero-chat` получают дополнительную ответственность по push dispatch.
- Subscription lifecycle и notification failures нужно учитывать как отдельную platform concern.
- Encrypted lanes пока не получают full message-preview parity в push payload.

### Ограничения

- Нельзя объявлять текущий PR finished PWA/offline implementation.
- Нельзя добавлять email/SMS/notification-center subsystem "заодно".
- Нельзя подменять encrypted privacy boundary server-visible plaintext preview.
- Нельзя превращать gateway в новый notification-owned domain.

## Альтернативы

### 1. Делать notifications только как browser `Notification` при открытой вкладке

Не выбрано, потому что это не покрывает closed/background state и не даёт честный phone/desktop push behaviour.

### 2. Вынести всё в новый отдельный notification service

Не выбрано, потому что это резко расширяет scope:
новый сервис, новый deploy/runtime contract, внутренний auth и event routing.

### 3. Отправлять push на каждое сообщение

Не выбрано, потому что это создаёт очевидный abuse/spam risk и не соответствует requested UX.
