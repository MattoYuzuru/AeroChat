# Следующая сессия: AeroChat reliability и UX

Скопируй следующий блок как задачу координатору. Перед началом сохранить локальную ветку аудита и прочитать актуальные состояния issues: их основания в коде относится к HEAD `eab87dd548ceddbf99570fb275eec39979f576e1`, после исправлений не переносить старый verdict автоматически.

```text
Работай в AeroChat как координатор. Прочитай AGENTS.md, README.md, docs/README.md, docs/development.md, docs/audits/2026-10-11-readiness.md и соответствующие ADR. Цель — устранить подтверждённые blockers и получить проверенный messenger/demo flow; слова «идеальный» и «нет багов» заменить наблюдаемой приёмкой.

Используй до пяти сабагентов с high effort, но не превышай доступные слотов среды. Если среда даёт три сабагента плюс координатор, выполняй роли волнами. В каждый handoff передай checkout/HEAD, read-only или edit scope, владельцев файлов, AGENTS/skill paths, test scope и ограничения среды. Применяй релевантные SDE/SRE/Frontend/Architecture/DevOps/Product/Harness/Cleaner skills.

Сначала проверь git status и сохрани branch codex/audit-portfolio-readiness: в ней исправлены6 frontend assertions, добавлена cache regression, Vitest в CI, test:web/web:test и docs/screenshots. Не стирай локальную работу. Для каждого нового issue отдельный branch/worktree и отдельный PR. Объединять crypto/auth/storage/RTC/shell redesign в одном PR запрещено.

Роли:
1. Auth/trust: #149 websocket revocation, #151 atomic first crypto device, #155 malformed tokens; затем #177 auth admission. Не изобретать crypto protocol, сохранить signed approval и identity source of truth.
2. Media/egress: #165 presign-region ordinary upload500, #152 bounded immutable attachment, #150 Web Push egress policy; #174 retention env. Storage changes сначалаADR и staging/finalization migration, затем код. Не считать простую дополнительную Stat immutable защитой.
3. RTC: #153 atomic backend Join/Leave/End, #154 current target authorization, #157 playback loop, #158 late capture cleanup, #159 retry cancellation, #162 group lobby liveness. Реальные devices/NAT/TURN acceptance обязательны после unit/hook regressions. #176 group media — отдельный acceptedADR/ряд PR, lobby не засчитывать как звук.
4. Frontend/UX: #156 ordering/read согласовать backend owner или передать ему отдельный PR; #160 minimized auto-read, #161 draft/reentrant Enter, #170 mobile composer, #172 keyboard/focus, #171 copy/false themes, #173 lazy modules, #175 Router maintenance. Не менять ChatsPage/RTC файлы одновременно с ролью 3 без сериализации/разных worktrees и review conflict.
5. Delivery/runtime: #163 cold-cache storage images, #168 pinned codegen/drift, #164 exact-SHA release gate, #166 readiness, #167 task ordering, #169 rollback/backup restore, #179 Go/dependency update и scanner triage. Этот агент — единственный runtime owner. Он фиксирует compose project, ports, retained mounts, env file paths без значений и cleanup plan.

Порядок:
A. #163/#168/#165 обеспечивают воспроизводимые tooling/runtime/media; auth/trust и RTC P1 можно исправлять параллельно в изолированных worktrees.
B. Сначала все confirmed P1 security/data-loss/call defects, затем composer/read/mobile/focus/copy и P2 delivery. Проверять исходные assumptions отдельно: часть security conclusions исходного аудита — code/SQL trace, специальных runtime reproductions там нет.
C. Обычные negative/integration regressions для owned localhost fixtures, никакого публичного сканирования или необозначенного load. Даже зелёный test suite не доказывает весь протокол. Если guard tool отклоняет check, зафиксировать ограничение, не переносить отклонённый script другому агенту.
D. #176 не лечить косметикой; перед implementation принять media architecture, privacy/resources/device lifecycle, разделить реализацию на узкие PR. Full E2EE/MLS/keybackup/historybackfill/offline не объявлять завершёнными без спецификации/evidence.

Runtime/check discipline:
- Для локальной инфраструктуры /Users/yuzuru/AGENTS.md → /.agents/infra/development.md и /Users/yuzuru/.agents/skills/workstation-dev/SKILL.md. Локальная область — текущая машина; SSH/production не подразумеваются.
- Общий state/locks /Users/yuzuru/.local/state/agent-dev, ресурсы heavy и stack-<exact-project>. Один runtime owner; чужие stacks/volumes/cache не трогать. Занятый lock означает очередь, а не kill/bypass.
- Версии проекта Go 1.25 (go.work), Node 22, pnpm 10.19.0; frozen install. Согласовать quiet source freeze для итоговых checks.
- Исходный task check выполняет deps параллельно, Buf remote plugins unpinned и generate сейчас создаёт Connectv2, не запускать генерацию без проверки в рабочем tree до #168. Аудит использовал внеGit storage overlay с отличающимся MinIO release; это не proof clean bootstrap.
- Каждый relevant unit/integration/lint/build gate имеет checkout/HEAD, fixture/envprofile, exitcode/skips и receipt. После source edits старыйpass не переносить на новыйHEAD. Исправления source не подменять ослаблением tests.

Наблюдаемая приёмка:
- Два аккаунта: register/login/logout/revoke, friends, direct/self/group messages, reply/edit/delete/pin, failed send/draft, unread в свёрнутом окне, reload/reconnect без silent loss/duplicates.
- Media: маленькие file/image/audio/video ciphertext upload/decrypt/use, limit/finalization/retention/error/cancel проверены на настоящем disposable storage.
- Calls: два реальных устройства слышат друг друга; permission denial/mute/leave/end/rejoin/recovery проверены. Forced relay и Wi-Fi↔cellular имеют candidate pair+media progress, bounded terminal failure вместо вечного connecting. Group audio — после #176 и отдельной3-user media matrix.
- Mobile 320/390/768, portrait/landscape/OS keyboard/safe area,200% zoom, keyboard only/focus: composer видим, полезная ширина >=140 CSS px baseline, история scroll отдельно, draft не теряется. Emulation и real iOS/Android отражать отдельно.
- Clean selfhost безwarmcache, runtimehealth/degradedready, CIexactSHA, fullrelease manifest, verified backuprestore/schema-aware rollback.

Портфолио: после blockers подготовь90–120 с честное demo и4–6 актуальных screenshots, README с implemented/validated/deferred. Реальные audio/media показывать только когда проверены. Не выдавать closed issues за absence of bugs.

Разрешены локальные fixes/tests/isolated runtime, публикация feature-веток и создание draft PR, обновления issues в MattoYuzuru/AeroChat. Не merge/deploy/forcepush/destructive reset на основании одного этого prompt. Перед внешними публикациями, не покрытыми задачей, подготовь конкретный reviewable результат. В финале перечисли закрытые/оставшиесяissues, точные PR/HEAD, gates, limitations и состояние runtime. Продолжай до достижения согласованной приёмки; масштабную groupmedia цель веди последовательнымиPR, не маскируй incompleteness общим словом «готово».
```

Полная очередь и подробные критерии находятся в [отчёте](2026-10-11-readiness.md) и [общем tracker #178](https://github.com/MattoYuzuru/AeroChat/issues/178) (задачи #149–177 и #179). Новые bugs, обнаруженные при fixes, заводить отдельно с evidence и приоритетом, не расширять соседний PR «заодно».
