# ADR-036: Media edge и upload runtime bootstrap для direct-to-object-storage media foundation

- Статус: Accepted
- Дата: 2026-04-13

## Контекст

После `ADR-025` и `ADR-035` в AeroChat уже существуют:

- shared `k3s + Traefik` edge для production launch-target;
- `docker-compose.server` как основной single-server runtime;
- `attachment` как first-class entity;
- `upload intent` и presigned `PUT` URLs;
- `MinIO` как S3-compatible storage внутри compose runtime.

Но media foundation пока остаётся неполной с точки зрения реального browser/runtime contract:

- browser-visible endpoint для object storage не зафиксирован как канонический production edge;
- shared-edge topology пока маршрутизирует только web и gateway;
- CORS для browser upload/download against object storage не настроен;
- server env contract для media edge недостаточно явный;
- operator runbook не описывает, как именно сделать presigned upload path браузерно-работоспособным на VPS.

Следующий slice должен закрыть именно этот runtime gap, не расширяя продуктовый scope.

Этот этап должен:

- сохранить direct-to-object-storage upload через presigned URL;
- не превращать `aero-gateway` в primary binary proxy;
- зафиксировать production-credible browser-visible media origin;
- встроить media edge в текущую shared `Traefik` topology;
- задать bucket privacy и CORS contract;
- не тянуть attachment UI, preview pipeline, cleanup jobs и CDN concerns.

Также нужно сохранить уже принятые ограничения:

- `aero-gateway` остаётся единственной backend edge-точкой для application RPC;
- raw media traffic не должен становиться основным gateway path;
- object storage listing/public discovery не вводятся;
- storage protocol остаётся обычным S3-compatible, без custom transport semantics.

## Решение

### 1. Для production фиксируется отдельный media subdomain

Канонический browser-visible media endpoint для production фиксируется как отдельный origin:

- `https://media.<primary-domain>`

Для текущего target deployment примерным значением является:

- `https://media.aero.keykomi.com`

Этот origin используется только для S3-compatible object storage traffic:

- presigned `PUT` upload;
- future presigned `GET` / `HEAD` download;
- MinIO health probes через edge.

Application origin и media origin намеренно разделяются:

- `https://<primary-domain>` обслуживает web shell и `/api`;
- `https://media.<primary-domain>` обслуживает object storage API.

### 2. Media edge не проходит через `aero-gateway`

`aero-gateway` остаётся orchestration boundary только для:

- `CreateAttachmentUploadIntent`;
- `CompleteAttachmentUpload`;
- authorization и chat-scoped metadata semantics.

Primary upload/download path для бинаря остаётся прямым:

- browser → shared `Traefik` → MinIO API upstream.

Это сохраняет уже принятую direct-to-object-storage модель и не делает gateway основным relay для media payload.

### 3. Shared-edge topology расширяется отдельным upstream для MinIO API

В `server/prod-like` runtime публикуется ещё один host upstream:

- `${AERO_SHARED_EDGE_HOST_IP}:${AERO_MEDIA_HOST_PORT}` → `minio:9000`

Shared `Traefik` маршрутизирует host `media.<primary-domain>` в этот upstream через отдельные:

- `Service` без selector;
- `EndpointSlice`;
- `Ingress`.

`MinIO Console` (`:9001`) наружу не публикуется и не включается в shared-edge contract.

### 4. Browser-visible endpoint для presign обязан совпадать с media edge

`aero-chat` продолжает использовать два разных storage endpoint:

1. internal endpoint
   - для service-to-storage доступа внутри compose runtime;
   - пример: `minio:9000`

2. browser-visible presign endpoint
   - для URL, которые получает браузер;
   - в production обязан указывать на media subdomain;
   - пример: `https://media.aero.keykomi.com`

Presigned URL не должен указывать на:

- `minio:9000`;
- loopback address;
- внутренний compose DNS;
- основной application domain.

### 5. Bucket остаётся private, anonymous listing и public discovery запрещены

На этом этапе bucket policy фиксируется консервативно:

- bucket не становится public;
- anonymous listing отключён;
- anonymous object download не вводится;
- доступ к объектам ожидается только по presigned URL.

Это означает:

- browser может загрузить или скачать объект только при наличии валидной presigned ссылки;
- storage edge не становится публичным файловым каталогом.

### 6. CORS настраивается на object storage bucket как часть runtime bootstrap

Browser upload/download against отдельный media origin требует CORS именно на storage edge.

Для bucket применяется явная CORS-конфигурация:

- `AllowedOrigin` содержит только явно заданные application origins;
- wildcard origin по умолчанию не допускается;
- разрешаются только методы:
  - `PUT`
  - `GET`
  - `HEAD`
- `AllowedHeader` остаётся широким, чтобы не ломать presigned/browser headers;
- `ExposeHeader` включает минимум `ETag`;
- CORS bootstrap выполняется автоматически в compose runtime через `mc`.

Source of truth для allowed origins задаётся отдельной runtime-переменной и не должен вычисляться “по памяти”.

### 7. Runtime bootstrap выполняется отдельным one-shot helper

Для local/dev и server/prod-like compose вводится одноразовый bootstrap-контейнер на базе `mc`, который:

- ждёт доступный MinIO API;
- создаёт bucket, если он ещё отсутствует;
- фиксирует bucket как private/non-anonymous;
- применяет required CORS policy.

Это делается вне `aero-gateway` и вне web-клиента, потому что это storage/runtime concern.

### 8. Credential model остаётся narrow foundation-level

На текущем этапе `aero-chat` использует те же MinIO root credentials, что и bootstrap helper.

Причины:

- существующий runtime уже разворачивается как single-server compose stack;
- `aero-chat` на старте по-прежнему выполняет `EnsureBucket`;
- полноценная отдельная MinIO IAM/policy-модель расширила бы scope текущего slice.

Это допустимо только как текущий infrastructure foundation.
Отдельный constrained storage principal может быть введён позже отдельным slice.

### 9. Dev и production browser flow фиксируются явно

#### Local/dev

- web открывается через локальный `nginx`;
- upload intent запрашивается через `aero-gateway`;
- browser получает presigned URL на локальный MinIO API origin;
- тот же compose bootstrap применяет bucket CORS для локальных app origins.

#### Production

- web открывается через `https://<primary-domain>`;
- upload intent запрашивается через `aero-gateway` на основном домене;
- browser получает presigned URL на `https://media.<primary-domain>`;
- upload/download идут напрямую в object storage через shared `Traefik`.

### 10. Что сознательно откладывается

В этом ADR сознательно не реализуются:

- file picker UI;
- upload progress UI;
- media preview UI;
- thumbnails;
- transcoding;
- explorer/files page;
- cleanup jobs;
- antivirus pipeline;
- CDN и multi-region delivery;
- отдельная MinIO IAM/policy hardening-модель;
- новый attachment download API поверх `aero-gateway`.

## Последствия

### Положительные

- Media foundation получает production-credible runtime contract для браузера.
- Upload path остаётся direct-to-object-storage и не превращает gateway в binary relay.
- Shared `Traefik` topology становится достаточной не только для web/api, но и для media edge.
- CORS перестаёт быть скрытым ручным шагом и входит в воспроизводимый runtime bootstrap.
- Bucket privacy остаётся консервативной и согласованной с `ADR-035`.

### Отрицательные

- В server runtime появляется ещё один host upstream и ещё один домен в edge contract.
- Operator обязан синхронно поддерживать основной domain, media subdomain и соответствующие ingress resources.
- До отдельного security slice `aero-chat` использует MinIO root credentials внутри compose runtime.

### Ограничения

- Нельзя считать этот slice attachment UX.
- Нельзя считать `https://media.<primary-domain>` публичным файловым CDN.
- Нельзя проксировать media upload/download через `aero-gateway` как основной путь.
- Нельзя включать public bucket/listing ради “удобства”.
- Нельзя расширять этот PR до preview, cleanup, antivirus или CDN concerns.

## Альтернативы

### 1. Оставить browser-visible endpoint как `minio:9000` или loopback host

Не выбрано, потому что такой endpoint не является корректным browser-visible contract для production runtime.

### 2. Проксировать upload/download через `aero-gateway`

Не выбрано, потому что это ломает уже принятый direct-to-object-storage подход и делает gateway primary binary path.

### 3. Использовать основной application domain и path-style routing типа `/media/*`

Не выбрано, потому что текущий slice требует явного разделения application edge и object-storage edge,
а отдельный media subdomain лучше отражает эту границу операционно и архитектурно.

### 4. Сразу внедрить отдельного ограниченного MinIO user и policy bootstrap

Не выбрано в этом slice, потому что это расширяет scope до отдельной credential hardening задачи.
