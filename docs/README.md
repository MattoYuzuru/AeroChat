# Навигатор AeroChat

Начать с [README](../README.md) и [обязательных правил](../AGENTS.md). Статус feature, принятое решение и подтвержденное поведение — разные источники: checked box в roadmap не заменяет evidence.

## Где искать

| Задача | Источник |
| --- | --- |
| Актуальные дефекты, проверки и ограничения | [Аудит 11 октября 2026](audits/2026-10-11-readiness.md) |
| Подробный inventory возможностей и ограничений | [Capabilities](product/capabilities.md) |
| Приоритеты реализации | [Roadmap](roadmap.md) и issue index в текущем аудите |
| Архитектурные инварианты | [ADR-001](adr/001-architecture.md), [ADR-002](adr/002-crypto.md), [ADR-003](adr/003-realtime-and-rtc.md), [ADR-004](adr/004-storage-and-relay.md) |
| Продуктовый канон оболочки | [Web Shell XP](product/web-shell-xp.md), [ADR-079](adr/079-desktop-shell-primary-desktop-web-surface.md)–[ADR-083](adr/083-mobile-practical-shell-adaptation.md) |
| Self-host и публичный edge | [Bootstrap](deploy/single-server-bootstrap.md), [Verified release](deploy/verified-release.md), [Rollout/rollback](deploy/production-rollout.md), [DB/S3 recovery](deploy/data-recovery.md), [ADR-025](adr/025-k3s-traefik-shared-edge-deployment.md), [ADR-094](adr/094-known-good-release-and-encrypted-recovery.md) |
| TURN и heartbeat звонков | [ADR-085](adr/085-server-turn-runtime-and-public-relay-ip-contract.md), [RTC ADR-086](adr/086-rtc-participant-heartbeat-and-stale-eviction.md) |
| Push | [Notifications ADR-086](adr/086-web-notifications-and-push-foundation.md) |
| Команды, runtime и совместная работа агентов | [Development](development.md) |
| Следующая сессия исправлений | [Промпт координатора](audits/2026-10-11-next-session.md) |

Номер 086 занят двумя существующими ADR; в задачах использовать полное имя файла. Новые номера проверять по всему каталогу.

## Карта кода

| Область | Основные пути |
| --- | --- |
| Auth / social / crypto-device trust | `services/aero-identity/internal/domain/identity`, `internal/storage/postgres`, `apps/web/src/auth`, `apps/web/src/crypto` |
| Browser RPC и realtime | `services/aero-gateway/internal/transport/connect`, `internal/realtime`, `apps/web/src/gateway`, `apps/web/src/realtime` |
| Сообщения / группы / media | `services/aero-chat/internal/domain/chat`, `internal/storage`, `apps/web/src/chats`, `src/groups`, `src/attachments` |
| Звонки | `services/aero-rtc-control`, `apps/web/src/rtc` |
| Desktop / mobile | `apps/web/src/shell`, `src/app`, `src/pages`, `src/ui` |
| Контракты / schema / генерация | `proto`, `gen/go`, `services/*/db`, `buf.gen.yaml`, `sqlc.yaml` |
| Общий Go runtime | `libs/go` |
| Delivery / локальный стенд | `.github/workflows`, `infra/compose`, `infra/scripts`, `Taskfile.yml` |

## Исторические материалы

[Аудит 25 марта](audits/2026-03-25-repo-audit.md) и [мартовская карта состояния](audit/current-state-architecture.md) сохраняют rationale и старые findings; они не доказывают актуальное поведение. ADR-024 описывает прежний nginx edge, его преемник для текущего server flow — ADR-025. Исторические документы не переписывать под новый код; добавлять ссылку на новый evidence.
