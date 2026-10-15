# Дальнейшее развитие AeroChat

Реализованные возможности описаны в [capabilities](product/capabilities.md),
текущие ограничения и ручная приёмка — в [состоянии проекта](project-status.md).
Завершённые этапы не дублируются здесь; история изменений доступна в Git и PR.

## Открытые направления

- **Групповое аудио** ([#176](https://github.com/MattoYuzuru/AeroChat/issues/176)):
  подключить provider/token adapter, SFU и admission/teardown runtime, проверку
  одного audio track, lazy UI с предупреждением о доступе SFU к аудио.
  Критерий завершения — реальное аудио минимум между тремя клиентами и проверка
  отзыва доступа. Контракты — [ADR-089](adr/089-group-audio-sfu-and-admission-boundary.md)
  и [ADR-097](adr/097-group-media-trusted-authorization-contract.md).
- **Криптография и история**: полноценный MLS client, key backup/recovery,
  восстановление истории на новом устройстве и завершение перехода с legacy
  plaintext paths. Полная E2EE требует отдельной спецификации и security review.
- **Mobile/PWA**: offline model, background sync и проверка жизненного цикла
  приложения на физических iOS/Android устройствах.
- **Jobs**: развитие `aero-jobs` из runtime scaffold по мере появления отдельных
  фоновых задач.

Каждое направление делится на узкие задачи и PR. Новый архитектурный выбор
сначала фиксируется в ADR; наличие интерфейса или тестового адаптера не означает
готовность соответствующего пользовательского сценария.
