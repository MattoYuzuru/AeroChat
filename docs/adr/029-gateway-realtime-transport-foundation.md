# ADR-029: Gateway-based realtime transport foundation через WebSocket

- Статус: Accepted
- Дата: 2026-04-06

## Контекст

После публичного alpha launch текущие web flows уже покрывают:

- direct chats;
- people / social graph;
- profile и settings;
- devices и sessions;
- presence snapshot foundation.

Но у продукта остаётся подтверждённый UX-разрыв:

- direct chats требуют ручного refresh или повторного открытия;
- social graph изменения не доставляются живо;
- foundation для presence уже существует, но live transport ещё отсутствует;
- gateway остаётся единственной внешней edge-точкой, но не умеет держать bounded realtime session.

Нужен следующий узкий slice:

- добавить первую production-oriented realtime delivery foundation;
- не переносить command semantics из текущих ConnectRPC API в WebSocket;
- не перестраивать auth model;
- не вводить distributed event bus;
- не смешивать этот шаг с groups, media, RTC или E2EE.

Также нужно сохранить уже принятые инварианты:

- `aero-gateway` остаётся единственным публичным backend edge;
- `aero-identity` остаётся source of truth для session validation;
- `aero-chat` и `aero-identity` продолжают владеть своими доменами;
- текущие ConnectRPC/HTTP команды остаются основным transport surface для mutations;
- realtime слой на старте должен быть bounded и расширяемым, а не “новой архитектурой всего приложения”.

## Решение

### 1. Публичный realtime entrypoint добавляется в `aero-gateway`

`aero-gateway` публикует один публичный WebSocket endpoint:

- внутренний путь gateway: `/realtime`
- внешний web path через текущий edge contract: `/api/realtime`

Это сохраняет уже существующую gateway-only routing модель:

- браузер продолжает знать только gateway base URL;
- downstream URLs не раскрываются;
- existing `/api` strip-prefix и dev nginx routing не требуют второго backend edge.

### 2. WebSocket используется только для server-to-client realtime events

Текущие ConnectRPC/HTTP методы остаются source of truth для:

- login/register/logout;
- social graph mutations;
- direct chat commands;
- read / typing / presence updates;
- profile/settings changes.

WebSocket слой на этом этапе не заменяет текущий API surface и не становится transport для domain commands.

Он используется только для:

- удержания long-lived realtime session;
- server-to-client push delivery;
- lifecycle событий соединения;
- будущего fan-out user-scoped событий.

### 3. Аутентификация websocket-сессии использует текущую session model

WebSocket session аутентифицируется текущим opaque bearer session token.

Для браузерного клиента token передаётся не через query string и не через новый cookie flow,
а через `Sec-WebSocket-Protocol` вместе с продуктовым subprotocol:

- `aerochat.realtime.v1`
- `aerochat.auth.<opaque-session-token>`

Gateway:

- извлекает opaque token из handshake;
- не валидирует token самостоятельно;
- проверяет его через уже существующий `IdentityService/GetCurrentProfile`;
- использует результат как source of truth для user/session validity.

Следствия:

- auth ownership остаётся в `aero-identity`;
- не появляется второй session model в edge;
- token не попадает в URL и не становится query-contract.

### 4. Realtime foundation остаётся process-local внутри gateway

На первом этапе вводится лёгкий in-process realtime hub в `aero-gateway`.

Hub отвечает только за:

- регистрацию websocket-сессий;
- хранение user-scoped active connections в памяти процесса;
- неблокирующую доставку событий в текущие соединения;
- clean shutdown и удаление закрытых сессий.

На этом этапе не вводятся:

- Redis pub/sub;
- Kafka / NATS / отдельная event platform;
- cross-node delivery guarantees;
- durable event replay.

Это допустимо, потому что текущий production/runtime target остаётся single-server и один экземпляр gateway является
достаточной bounded foundation для следующих realtime slices.

### 5. Вводится минимальный event envelope

Realtime payload на старте фиксируется как лёгкий JSON envelope:

- `id`
- `type`
- `issuedAt`
- `payload`

На bootstrap-этапе gateway обязан уметь отправить хотя бы lifecycle событие:

- `connection.ready`

Это событие подтверждает:

- успешный handshake;
- валидную аутентификацию;
- готовность конкретной realtime session принимать будущие user-scoped события.

Полный каталог продуктовых realtime event types в этом ADR не фиксируется.
Он будет расширяться отдельными следующими slices, но обязан оставаться совместимым с этим envelope contract.

### 6. Lifecycle и heartbeat входят в foundation сразу

Gateway websocket layer обязан поддерживать:

- явное открытие и регистрацию соединения;
- периодический server-side ping;
- обработку pong и close frames;
- clean disconnect при закрытии браузера, сетевом разрыве или shutdown сервиса;
- bounded write path с timeout и защитой от slow consumer.

Если клиент перестаёт отвечать или outbound buffer переполняется, соответствующая realtime session закрывается,
а hub удаляет её из active registry.

### 7. Origin policy для WebSocket остаётся edge concern

Если в gateway уже задан allowlist origins для web runtime, тот же allowlist используется и для cross-origin WebSocket
handshake.

Это сохраняет existing edge security semantics:

- origin policy остаётся concern gateway;
- downstream сервисы не знают о WebSocket;
- не вводится отдельный ad-hoc security contract для realtime route.

### 8. Frontend получает только минимальный bootstrap connection

`apps/web` может держать один websocket connection на уровне authenticated shell.

Этот connection:

- поднимается только при наличии валидной gateway session;
- использует текущий gateway base URL;
- не вводит новый data framework;
- пока не заменяет существующие явные refresh flows.

На этом этапе web-клиент не обязан реализовывать полный live reducer для chats или people.
Достаточно безопасно поднимать connection и быть готовым к приёму future events.

## Последствия

### Положительные

- Появляется первый реальный realtime transport layer без переноса domain ownership в gateway.
- Direct chats, people и presence получают общую bounded точку роста для live fan-out.
- Existing ConnectRPC command surface остаётся стабильным и не требует redesign.
- Browser-клиент получает один websocket entrypoint вместо набора ad-hoc realtime каналов.
- Single-server runtime получает production-oriented foundation без лишней event infrastructure.

### Отрицательные

- На этом этапе hub работает только в памяти одного процесса gateway.
- Сразу не появляется полный live UX для chats и people: нужны следующие slices с публикацией конкретных domain events.
- WebSocket auth bootstrap добавляет ещё один edge transport concern, который нужно сопровождать в тестах и docs.

### Ограничения

- Нельзя считать этот slice полной realtime delivery платформой.
- Нельзя переносить product commands в websocket transport в рамках этого решения.
- Нельзя вводить query-string auth, cookie redesign или второй session source of truth.
- Нельзя смешивать этот slice с distributed event bus, groups, RTC signaling, media delivery или E2EE.

## Альтернативы

### 1. Оставить только polling / ручной refresh

Не выбрано, потому что подтверждённый product gap уже упирается именно в отсутствие bounded realtime transport.

### 2. Сразу внедрить Redis pub/sub или внешний event bus

Не выбрано, потому что это расширяет scope и operational complexity раньше, чем появился даже базовый websocket edge.

### 3. Делать WebSocket напрямую до `aero-chat` или `aero-identity`

Не выбрано, потому что это ломает уже принятый gateway-only external edge contract и размазывает realtime surface по
нескольким публичным точкам входа.

### 4. Передавать session token в query string

Не выбрано, потому что это делает токен частью URL contract и повышает риск его утечки в логи, history и proxy traces.
