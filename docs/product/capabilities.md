# Возможности AeroChat

Документ описывает текущую реализацию. Подтверждённые проверки и оставшиеся
ограничения — в [состоянии проекта](../project-status.md), будущие функции —
в [roadmap](../roadmap.md).

| Область | Реализовано | Граница |
| --- | --- | --- |
| Аккаунт | Регистрация, пароль, сессии/устройства, профиль, privacy settings, bounded auth admission | Backup/recovery ключей не завершён |
| Контакты | Заявки, друзья по точному неизменяемому login, блокировки | Публичного каталога пользователей нет |
| Переписка | Direct/self/group, роли и приглашения, replies/edit/tombstone/pin, realtime, typing/presence, read/unread | Полная историческая и multi-device parity не завершена |
| Encrypted lanes | Device-aware direct v2, отдельная group lane, локальная расшифровка, серверный sequence операций | Legacy plaintext model сохраняется; полноценный MLS и общий E2EE claim не подтверждены |
| Поиск | Локальный поиск расшифрованных сообщений | Только загруженное окно текущей сессии |
| Медиа | Encrypted attachment relay, immutable finalization, quotas/retention, image/audio/video preview, voice/video notes | Серверный relay временный; это не постоянный архив |
| Desktop | Несколько окон, Start, Explorer, локальные папки, keyboard focus, lazy app modules | Организация и положение окон хранятся в браузере |
| Mobile/PWA | Route-backed страницы, launcher, адаптивный composer, manifest/install, Web Push | Offline/background sync и device lifecycle требуют дальнейшей работы |
| 1:1 звонки | Signaling, аудио, mute, local capture owner, bounded recovery, TURN configuration | Физическая слышимость/NAT/network switching требуют ручной приёмки; известное наблюдение UI «Сбой» открыто |
| Групповые звонки | Лобби/роли/heartbeat, внутренние authority/revocation/grant/control foundations | SFU и media runtime не подключены; группового звука нет |
| Delivery | Закреплённые codegen/toolchain, CI, exact-SHA image gates, immutable release manifest, recovery runbooks | Deployment и data cutover требуют отдельного выполнения |
| Jobs | Service/runtime scaffold | Полноценная фоновая оркестрация не реализована |

## Канонические контракты

- Shell: [продуктовая спецификация](web-shell-xp.md) и ADR-079–083.
- Direct/group crypto: ADR-055–073; server ordering — [ADR-096](../adr/096-encrypted-conversation-server-sequence.md).
- Local microphone ownership: [контракт](local-call-capture-owner.md).
- Group audio: [ADR-089](../adr/089-group-audio-sfu-and-admission-boundary.md)
  и [ADR-097](../adr/097-group-media-trusted-authorization-contract.md).
- Runtime, environment и проверки: [development](../development.md).

Тестовые adapters/fixtures используются для изолированных regression checks.
Они не входят в описание готовых пользовательских возможностей и не заменяют
настоящий backend, SFU или физические устройства.
