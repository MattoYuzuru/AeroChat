# ADR-093: Полная readiness и распространение storage outage до edge

- Статус: Proposed
- Дата: 2026-10-11
- Задача: [#166](https://github.com/MattoYuzuru/AeroChat/issues/166)
- Уточняет readiness contract ADR-012.

## Контекст

Chat readiness проверяла PostgreSQL/Redis, но не S3. Gateway вызывал RPC `Ping`, который подтверждает доступность transport/process, а не доменных зависимостей. При остановленном storage chat, gateway и edge отвечали `readyz=200`.

## Решение

`/healthz` остаётся process-level и не зависит от storage. `/readyz` — full readiness: chat требует PostgreSQL, Redis и доступный configured S3 bucket под service credentials. S3 check read-only (`BucketExists`), не создаёт bucket/objects и не изменяет policy/lifecycle. Missing bucket, denied credentials, недоступный endpoint и timeout приводят к HTTP 503. После восстановления следующий probe возвращает 200 без перезапуска сервиса.

Gateway проверяет downstream `/readyz` для identity/chat/RTC вместо RPC `Ping`. RPC Ping contract сохраняется. Выход одного downstream из readiness даёт gateway/edge 503. На весь gateway probe и S3 probe установлен budget 3 секунды с учётом более раннего caller deadline; network failure не блокирует отдельный process health request.

Ошибки новых probes содержат только generic dependency name: S3 credentials, endpoint URL и upstream error body не возвращаются клиенту. Metadata check не обещает проверку каждого object-level permission: S3 write/read/private policy smoke остаются отдельными acceptance gates.

## Последствия

HTTP readiness отражает невозможность полноценно обслуживать media при storage outage. Даже text-only RPC может быть доступен при `readyz=503`; это выбранный full contract, а не обещание отключить text transport. Gateway не получает storage credentials или domain ownership; он читает уже существующий diagnostic HTTP surface.

Readiness probes не выполняют destructive operations. Local tests включают missing/denied/timeout/recovery и независимый health; real fixture fault проводится на отдельном owned storage, не прерывая другие agent fixtures. Real device/NAT/production проверка не входит в этот scope.

## Источники

- [MinIO BucketExists](https://pkg.go.dev/github.com/minio/minio-go/v7#Client.BucketExists)
- [HTTP request context](https://pkg.go.dev/net/http#NewRequestWithContext)
