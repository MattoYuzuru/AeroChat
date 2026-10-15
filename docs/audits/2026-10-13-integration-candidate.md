# Проверки integration candidate — 13 октября 2026

Исторический отчёт. Текущее состояние — в [project status](../project-status.md).
Ветка исходного кандидата: `codex/integration-messenger-20261013`.
Code SHA: `0ac496732ceade7cf2553d728e61b8b55ee900b8`; отчёт `9efead9` меняет документацию.
Кандидат включал все 52 опубликованных draft PR и последующие локальные исправления.

## Сохранённые результаты

| Источник | Результат и граница |
| --- | --- |
| `69de313`, `check-jxs8rzvw` | 15 последовательных этапов: frozen install, 620 unit + 2 layout regressions, ESLint, TypeScript/Vite build, toolchain/storage provenance, 16 Python tests, actionlint, два Compose config. 622 JUnit PASS, 0 failure/error/skip. |
| `0ac4967`, `check-2zjegu7a` | После уточнения UI лобби: свежие 620 web unit PASS без failure/error/skip, ESLint и TypeScript/Vite build. |
| Native11, `check-7gm4a22e` | Настоящий backend/browser: 21 сценарий переписки + 12 media. Все 12 decrypted downloads совпали по SHA/bytes, logout/revoke sockets прошли. Frontend D260; backend происхождение описано в Git-истории remediation. |
| `check-uuttms9h` | Cleanup-only PASS после остановки владельцем. Собственные процессы/порты закрыты, retained DB/bucket/profiles сохранены. |

Node 22.23.2, pnpm 10.19.0, Go 1.27.2; layout fixtures использовали Chromium 153.
Receipts хранятся вне Git в `~/.local/state/agent-dev/check-*/result.json`.
Новый HEAD требует собственных релевантных проверок; таблица не является PASS
текущей production установки.

## Границы

Group media runtime отсутствовал. Physical audibility/devices/NAT/forced TURN,
Wi-Fi↔cellular, iOS/Android OS keyboard, native zoom 200% и итоговая minimized
window matrix не подтверждены этим отчётом. Сохранено наблюдение UI «Сбой»
при работающем RTP; первичная причина не установлена.

Промежуточные ошибки и source/runtime provenance сохранены в Git-истории
remediation и соответствующих PR; повторяющийся журнал сессий удалён из навигации.
