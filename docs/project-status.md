# Текущее состояние AeroChat

AeroChat — self-hosted мессенджер в стадии alpha. Реализованные возможности
перечислены в [capabilities](product/capabilities.md), команды — в
[development](development.md), дальнейшие функции — в [roadmap](roadmap.md).
Результаты CI относятся к SHA конкретного PR или release. Merge и публикация
образов не означают обновление пользовательского сервера.

## Реализовано и проверено

В код включены исправления отзыва realtime-сессий, Web Push egress,
crypto-device bootstrap, immutable media uploads, серверного порядка encrypted
сообщений и read watermark, RTC lifecycle/capture/playback/recovery, composer,
read visibility, keyboard focus и lazy modules. Сборка использует закреплённые
генераторы и Go toolchain; release выбирается по immutable manifest.

Сохранённая локальная приёмка 13 октября прошла 33 сценария на настоящих backend
и браузере: 21 сценарий переписки и 12 media upload/download/decrypt. SHA и байты
всех 12 расшифрованных скачиваний совпали; logout/revoke socket checks прошли.
Web gate на code SHA `0ac496732ceade7cf2553d728e61b8b55ee900b8` прошёл 620 unit
тестов без failure/error/skip, ESLint и TypeScript/Vite build.
Это результаты указанной ревизии; текущие проверки публикуются в GitHub Actions.
Источники и границы — в [историческом отчёте](audits/2026-10-13-integration-candidate.md).

## Ограничения

- **Групповые звонки:** доступно лобби и control plane. Native grant journal,
  private authority/revocation и control adapters — фундамент; SFU/provider,
  admission/teardown media runtime и групповое аудио ещё не подключены.
  SFU по принятому решению имеет доступ к аудио; это не E2EE.
- **Звонки 1:1:** реализованы аудио, mute и управление захватом. В сохранённой
  приёмке наблюдался UI «Сбой» при работающем RTP; причина не установлена.
  Нужна проверка на двух устройствах, включая leave/rejoin/end и запрет микрофона.
- **Криптография:** bounded encrypted lanes не дают полной E2EE parity/MLS,
  key recovery или backfill истории на новом устройстве. Legacy plaintext model
  и compatibility paths сохраняются. Локальный поиск ограничен загруженным
  расшифрованным окном и сессией браузера.
- **Mobile/PWA:** install и push реализованы; offline/background sync не завершены.
  Browser fixtures не подтверждают OS keyboard, safe area и работу в фоне.
- **Storage:** maintained MinIO/mc source build не возобновляет upstream
  maintenance. ADR-087 остаётся Proposed по license/operator decision;
  GO-2026-5932 сохраняется как module-only residual, без blanket security claim.
- Папки и положение окон сохраняются в браузере; `aero-jobs` — runtime scaffold.

## Ручная приёмка

На выделенном стенде выбранного release:

1. На двух устройствах проверить отказ микрофона, Start/Join, слышимость в обе
   стороны, mute/unmute, Leave → Join и End. UI должен соответствовать звуку;
   при «Сбой» сохранить последовательность действий и время.
2. Проверить forced TURN и Wi-Fi↔cellular: восстановление или конечная ошибка,
   без вечного connecting и самовольного повторного захвата микрофона.
3. На iOS/Android проверить portrait/landscape с OS keyboard, reply + attachment
   и длинную ошибку отправки: composer/Send доступны, draft/reply/file сохранены.
4. На desktop проверить Tab, native zoom 200% и read/unread свёрнутых direct/group
   окон с последующим восстановлением.

Эти пункты остаются непроверенными на физических устройствах. Production rollout,
TLS/TURN и backup restore выполняются по [runbook](deploy/production-rollout.md)
и [recovery](deploy/data-recovery.md) для выбранного сервера.
