# ADR-037: Нормализация media edge hostname для Cloudflare-compatible runtime

- Статус: Accepted
- Дата: 2026-04-14

## Контекст

После `ADR-025` и `ADR-036` в AeroChat уже зафиксированы:

- shared `k3s + Traefik` edge для production launch-target;
- direct-to-object-storage upload через presigned URL;
- отдельный browser-visible media origin для MinIO API traffic;
- private bucket и presigned-only access model.

Но в текущем runtime contract закреплён media hostname вида:

- application host: `aero.keykomi.com`
- media host: `media.aero.keykomi.com`

Для фактического production target это создаёт операционную проблему:

- DNS-зона обслуживается через Cloudflare;
- приложение использует обычный Cloudflare edge path без отдельной кастомной certificate strategy;
- `media.aero.keykomi.com` является second-level subdomain относительно zone apex `keykomi.com`;
- такой host не укладывается в типовой coverage-контракт Cloudflare Universal SSL для текущей topology.

В результате прежняя модель делает media edge зависимым от отдельного TLS-решения, которое не входит в scope текущего
infra/runtime slice.

Нужно исправить именно hostname contract, не расширяя решение до нового edge stack, CDN tuning, attachment UI или media
processing pipeline.

## Решение

### 1. Канонический production media host больше не выводится как `media.<primary-domain>`

С этого момента production contract фиксируется так:

- application public host задаётся явно через `AERO_EDGE_DOMAIN`;
- media public host задаётся явно через `AERO_MEDIA_EDGE_DOMAIN`;
- media host не должен вычисляться как `media.${AERO_EDGE_DOMAIN}`.

Причина:
в текущем deployment application host сам уже является subdomain внутри zone, поэтому формула `media.<primary-domain>`
создаёт лишний уровень вложенности и ломает ожидаемый TLS path на edge.

### 2. Для Cloudflare-compatible production media host должен быть first-level host внутри той же зоны

Для current launch-target используется sibling-host модель:

- zone domain: `keykomi.com`
- application host: `aero.keykomi.com`
- media host: `media.keykomi.com`

То есть production media host должен быть first-level hostname внутри той же DNS-зоны, а не nested host под
application domain.

Если application host в будущем изменится, media host всё равно задаётся как отдельный zone-level sibling host,
пока проект остаётся на текущем Cloudflare-compatible certificate contract.

### 3. Server runtime contract фиксируется явно

Для `server/prod-like` runtime действуют следующие правила:

- `AERO_EDGE_DOMAIN` задаёт application host для web, `/api`, `/api/realtime`, `/healthz` и `/readyz`;
- `AERO_MEDIA_EDGE_DOMAIN` задаёт отдельный public host для object storage traffic;
- `MEDIA_S3_PUBLIC_ENDPOINT` обязан совпадать с `https://${AERO_MEDIA_EDGE_DOMAIN}`;
- shared `Traefik` маршрутизирует весь host `AERO_MEDIA_EDGE_DOMAIN` в `${AERO_SHARED_EDGE_HOST_IP}:${AERO_MEDIA_HOST_PORT}`;
- MinIO bucket остаётся private, а browser upload/download продолжает идти только по presigned URL.

### 4. Local/dev contract не меняет архитектуру production

Для `local/dev` сохраняется текущая упрощённая модель:

- `MEDIA_S3_PUBLIC_ENDPOINT` может указывать на локальный MinIO API endpoint;
- allowed origins для browser upload задаются через `MEDIA_S3_CORS_ALLOWED_ORIGINS` и применяются самим MinIO;
- browser upload flow остаётся direct-to-object-storage и использует тот endpoint, который виден браузеру локально.

Это dev-упрощение не меняет production contract и не должно использоваться как аргумент в пользу nested production host.

### 5. Предположение о Cloudflare фиксируется явно

Текущий production-документированный путь опирается на следующие assumptions:

- DNS-зона фронтируется Cloudflare;
- используется обычный Cloudflare edge certificate path без отдельного custom certificate rollout для second-level host;
- проект не требует отдельного Advanced Certificate Manager slice только ради media hostname.

Если оператору когда-либо понадобится host вида `media.<application-host>`, это должно оформляться отдельным ADR вместе
с явной certificate strategy и обновлением edge/runbook contract.

### 6. Scope correction остаётся узким

Этот ADR не меняет:

- attachment domain model из `ADR-035`;
- direct-to-object-storage upload model из `ADR-036`;
- private bucket / presigned-only policy;
- отсутствие attachment composer UI;
- отсутствие preview UI, thumbnails, transcoding, cleanup jobs и antivirus pipeline.

## Последствия

### Положительные

- Production media hostname становится совместимым с текущей Cloudflare + shared-edge topology.
- Presigned upload path сохраняется без proxy через `aero-gateway`.
- Runtime и deploy docs перестают навязывать nested hostname, который требует отдельной TLS-стратегии.
- Operator contract становится явнее: application host и media host теперь независимые, но согласованные zone-level hostnames.

### Отрицательные

- `AERO_MEDIA_EDGE_DOMAIN` больше нельзя мыслить как механическую производную от `AERO_EDGE_DOMAIN`.
- Оператор обязан держать отдельную DNS-запись и отдельный ingress host для media sibling-host.
- Старые примеры вида `media.aero.<zone-domain>` больше нельзя использовать при подготовке VPS и Cloudflare zone.

### Ограничения

- Нельзя возвращать nested media host без отдельного ADR и отдельного certificate plan.
- Нельзя трактовать этот corrective slice как attachment UX или media feature expansion.
- Нельзя расширять изменение до path-style media routing на основном application host.

## Альтернативы

### 1. Сохранить `media.aero.<zone-domain>` и добавить отдельную certificate strategy

Не выбрано, потому что это расширяет corrective slice до отдельной edge/TLS задачи и не нужно для текущего production
launch path.

### 2. Перевести media traffic на path-style routing через основной application host

Не выбрано, потому что это меняет уже принятый contract разделения application edge и object-storage edge.

### 3. Оставить старый ADR-036 hostname contract без изменений

Не выбрано, потому что он не соответствует фактической Cloudflare-совместимой production topology и приводит к
неоперабельному media hostname.
