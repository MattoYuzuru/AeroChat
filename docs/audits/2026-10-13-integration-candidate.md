# Локальный integration candidate 13 октября 2026

Ближайший ограниченный этап завершён: сохранённые исправления собраны в обычную
локальную историю, выполнены необходимые source checks, оставшиеся ручные проверки
и отсутствующий group media runtime отделены от реализованного кода. Это candidate
для review, без merge в main, публикации или deployment.

Ветка: `codex/integration-messenger-20261013`.
Checkout: `/Users/yuzuru/.codex/worktrees/remediation-integration/AeroChat`.
Проверенный code SHA: `0ac496732ceade7cf2553d728e61b8b55ee900b8`.
Следующий коммит отчёта меняет только документацию; receipts ниже остаются привязаны
к указанным SHA, а не автоматически становятся PASS нового HEAD.

## Что включено — IMPLEMENTED

| Источник | Состав candidate |
| --- | --- |
| C8 `c8fec9d4d2c2145b08b9989f5a562d942490e22d` | Go 1.27.2 foundation, auth/storage/RTC prerequisites и полный lobby fixture. A619 уже является предком C8; старый Go25 floor отдельно не переносился. |
| D260 `d260b48b0c4df583ce9bb70adf7d7c4878586851` | Frontend messenger и узкие landscape/group-composer fixes, включая bounded feedback при reply + attachment + send error. |
| Документы `ea37e4cd3b9fedaa897ae25c70c9c73421ef23fb` | Последние исторические результаты, STOP и handoff владельца. |
| Storage `f68ccc1572ab288d056fcfb08b6b6bcabe5f5208` | Maintained MinIO/mc dependencies, Go27 source recipe, provenance и strict scanner gate. Этот поздний slice отсутствовал в C8. |
| Copy fix `4c0dc0a` | Group card и joined status называют лобби без аудио; tooltip предупреждает о недоступном аудио. Убрано ложное «Вы уже подключены». Call handlers, capture, права и transport не менялись. |

Integration merges: `48cd29f` (C8 + D260), `7d2f2a7` (+ документы),
`69de313` (+ storage), `0ac4967` (+ отдельная ветка copy fix).
Разрешены только три документационных конфликта: навигатор и два deployment
runbook. Сохранены новые ссылки, recovery/schema checks и source-build flow.
Конфликтов production code, proto, SQL или pins не было.

Сверка ancestry: все 31 feature-HEAD из таблицы remediation и все 28 актуальных
HEAD из checkpoint0076 включены. Это проверка состава, не процент готовности.
Backend, libs, proto/generated code и workspace files на code SHA побайтно
совпадают с C8; storage source/overlay — с f68. Frontend отличается от D260 только
указанным copy fix. Никакие из 52 historical draft PR не merged в main.

## Автоматические проверки — VALIDATED

| Exact SHA / receipt | Свежий результат |
| --- | --- |
| `69de3137c3532b1c6b66c663609a291712a15f15`, `check-jxs8rzvw` | 15 последовательных этапов: offline frozen install; 620 web unit tests; ESLint; TypeScript/Vite build; group combined composer и pinned landscape trajectory (по 1 regression); actual Go pins; storage manifest; 6 provenance + 4 application parser + 6 storage scanner tests; actionlint; local/server Compose config; diff check. JUnit: 622 PASS, 0 failure/error/skip. Python: 16 PASS. |
| `0ac496732ceade7cf2553d728e61b8b55ee900b8`, `check-2zjegu7a` | После copy-only diff: свежие 620 web unit PASS, 0 failure/error/skip, ESLint и TypeScript/Vite build. Повторена только затронутая web область. |

Оба runner receipts успешны, source clean/frozen, без missing/stale reports.
Node 22.23.2, pnpm 10.19.0, Go 1.27.2; layout fixture использовала существующий
Chromium 153. Browser/Vite двух новых fixture завершены, owned profiles не имеют
живых процессов, порт 25274 закрыт. Новый runtime/check owner:
`integration_resume_20261013`; общий heavy lock использован последовательно.
Shared compose, retained DB/bucket/profiles и чужие процессы не менялись.

Evidence вне Git:

- `/Users/yuzuru/.local/state/agent-dev/check-jxs8rzvw/result.json`
- `/Users/yuzuru/.local/state/agent-dev/check-2zjegu7a/result.json`
- `/Users/yuzuru/.local/state/agent-dev/aerochat-remediation-20261011/integration-candidate-fb568fa2-8ccf-4a39-a7e1-27382b3474a1/` — driver, команды, stage logs, JUnit, geometry и cleanup readback.

Новый полный Go gate, codegen или cold storage build не запускались: соответствующие
исходники совпадают с уже проверенными родителями, контрактного diff нет.
Сохраняются historical C8 Go PASS854, D260 web PASS774 и native11 core PASS33
с 12 verified decrypted downloads. Их exact source/runtime provenance описана
в [remediation](2026-10-11-remediation.md); это не свежий runtime PASS candidate.
Python scanner tests проверяют отказ parser, а не запускают actual vulnerability
scan. Security blanket approval не выдаётся: GO-2026-5932 остаётся module-only
residual; OpenPGP caller отсутствует в сохранённых source scans. ADR-087 остаётся
Proposed по license/operator decision.

## Остаточный дефект и отсутствующая реализация

**1:1 UI «Сбой» при рабочем RTP — UNVERIFIED, причина не установлена.**
Адресно прочитаны native07 evidence и production lifecycle/reducer. Evidence
подтверждает connected peer и media progress у B при failed UI, но не записывает
первичный failure dispatch. Terminal state имеет приоритет над connected phase;
это объясняет сохранение надписи, но не причину первоначальной ошибки. Ни reducer,
ни error assertions не изменены; reproducing regression с установленной причиной
не получена. Проверить на устройствах по пункту 1 ниже.

**#176 — DEFERRED FEATURE, не manual-QA-only.** Нет token adapter/provider wiring,
grant/admission/teardown media runtime, физического one-AUDIO/MIC enforcement,
lazy media UI/privacy warning и actual three-client audio. SDK exported API compile
и проверенный SFU source archive являются inputs, не реализацией. Group media
не подключён; доступен только lobby. Trusted self-hosted LiveKit и факт доступа
SFU к аудио приняты ADR-089/097; будущий transport encryption не объявляется E2EE.
Physical gate proposal остаётся Proposed/SOURCE ONLY. Его две ошибочные ссылки
не используются в этом candidate.

**Свежий runtime/demo — UNVERIFIED.** Native11 не возобновлялся. Новый общий
backend/browser runtime, native zoom/WM и device matrix не запускались.
Старые screenshots сохраняют историческую подпись; текущий honest demo передан
владельцу, поскольку запись messenger потребует отдельного согласованного runtime,
а layout fixture с synthetic adapters его не заменяет.

## Короткий ручной чеклист владельцу — UNVERIFIED

Проверять на выделенном стенде выбранного code SHA. Подготовка пользовательского
сервера и новый rollout согласуются отдельно; этот отчёт их не выполняет.

1. **1:1 на двух устройствах.** Deny microphone до Start: участие не возникает.
   Разрешить, Start/Join: обе стороны слышат звук. Mute/unmute. Peer Leave →
   явный Join → звук. Creator End освобождает microphone. На каждом шаге UI
   не остаётся «Сбой» при рабочем звуке; при повторении сохранить шаг/время/скриншот.
2. **TURN и смена сети.** Forced TURN и Wi-Fi↔cellular: восстановление либо bounded
   terminal error, без вечного connecting и повторного самовольного capture.
   Candidate pair/media progress записать только при доступной диагностике.
3. **iOS/Android.** 320/390 portrait и landscape с OS keyboard/safe area, reply +
   attachment + длинная ошибка: поле/Send доступны, draft/reply/file сохраняются,
   история скроллится независимо.
4. **Mac keyboard/zoom.** Tab до composer/Send, native browser zoom 200%:
   focused control виден; вернуть 100%. Последняя fresh native zoom-проверка UNRUN.
5. **Minimized B.** Отправить direct и group сообщение из A: свёрнутое B не
   продвигает read; после restore видны корректный unread и затем read.
   Fresh native WM проверка UNRUN; unit fixture её не заменяет.
6. **Короткое demo.** На текущем code SHA записать отправку/reply, file download,
   одну mobile composer сцену и lobby с явной надписью «без аудио». Не показывать
   roster как group audio. Три человека и SFU privacy warning проверять только
   после реализации #176; сейчас звук в группе проверить невозможно.
7. **Self-host отдельно.** Новый production rollout, публичные TLS/IP/TURN и
   backup restore требуют своей согласованной процедуры. После восстановления
   GitHub нужны fresh exact-SHA hosted CI/readback и parent-first merge review
   по порядку из remediation; main merge/deploy требуют решения владельца.

Новые confirmed security defects при этой ограниченной сверке не установлены.
Общий hunting/load/security audit не выполнялся. Отсутствие новой находки не
означает отсутствие всех багов или уязвимостей.
