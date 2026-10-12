# План реализации local call capture owner

- Статус: Accepted scope — coordinator разрешил source-only реализацию 2026-10-12 по уточнению [ADR-089](../adr/089-group-audio-sfu-and-admission-boundary.md#local-call-capture-ownership--accepted-clarification); выполнение checks и публикация требуют отдельного exact-source review/window.
- Задача: [#176](https://github.com/MattoYuzuru/AeroChat/issues/176), отдельный frontend foundation slice.
- Исходный pin: `dc46673c6aeb0527ae1cd67ebe7d3aca1ca0cdbf`, local integration assembly. Этот whole candidate ещё UNVERIFIED; receipts прежних source pins на новый scope не переносятся.
- Source-only foundation candidate подготовлен после отдельного Accepted docs commit; unit/browser fixtures не исполнялись. SDK/group media activation отсутствует, checks/publication остаются отдельным exact-source checkpoint.

## Цель и границы

Сериализовать call capture между mounted direct windows и будущим group media runtime **в одном app instance**. Local owner сохраняется после successful join, пока живёт собственный capture или его pending continuation. Отдельно остаются direct pending join coordinator и authoritative backend grant/operation/ACK по [ADR-097](../adr/097-group-media-trusted-authorization-contract.md).

Recorders исключены: Accepted ADR ограничивает calls и SFU microphone publication, но не задаёт app-wide physical microphone exclusion для voice/video notes. Сохранить MediaRecorder hooks, stop/send/discard, preview/draft и video-only fallback. Если требуется запрещать запись заметки во время call, root фиксирует отдельное product решение и scope; этот PR такое поведение не обещает.

Без SDK/dependency/lock changes, RPC/proto/backend/proxy, group lobby redesign/capture/flag, auto-switch/discard или переносов streams между calls. Group-kind pure contract test подтверждает arbitration, а не actual group runtime.

## Current source и responsibilities

| Область | Source anchors | Lifetime |
| --- | --- | --- |
| App pending join coordinator | `apps/web/src/rtc/context.tsx:40`, `join-coordinator.ts:16–63` | pending Symbol per user + uncertain chat/call; acquire direct:899/992, release:972/1053 |
| Direct active capture | `useDirectCallSession.ts:119`, `:240–264`, `:299–382` | localStreamRef и собственный full teardown; successful finally не является stop |
| Direct peer recovery/mute | `:206–232`, `:1092–1118`, `:1269–1278` | сохраняют local capture identity и mute |
| Direct scope cleanup | `:1148–1171`, `:1238–1248`, `:1264–1266` | account/token/chat/disabled/unmount/self removal прекращают own runtime |
| Group lobby | `apps/web/src/pages/GroupsPage.tsx:1432–1592` | только control-plane start/join/leave/end, без capture/SDK |
| Notes | `useVoiceNoteRecorder.ts:75/99`, `useVideoNoteRecorder.ts:119/328/347` | независимые capture/MediaRecorder hooks; не входят в call owner |

Paths без префикса в таблице относительно `apps/web/src/rtc` или `apps/web/src/attachments` по имени файла. Minimize сохраняет mounted body `DesktopShell.tsx:1949–1966/2084`; не использовать read visibility или window focus как release signal.

## Local contract

1. Один stable coordinator у app provider, без module-global singleton и per-user occupied map. Один old pending capture блокирует новый account до own cleanup/settlement.
2. Scope: direct/group, opaque user ID, локальная opaque auth epoch, opaque hook/window owner, chat/group ID, runtime generation. Call ID до Start ответа nullable и остаётся в existing runtime refs/state; actual response использует ту же lease, а не создаёт новую. Browser epoch не server session/grant generation. Bearer/JWT не сохранять в coordinator, snapshots, logs или storage.
3. Synchronous acquire перед getUserMedia/SDK factory. Owner token уникален per attempt; phase/release compare-and-match только своего token. Busy result использует существующую failure surface и не вызывает capture/RPC/auto-leave чужого owner.
4. Состояния `capture_pending → retained → closing → released`. Retained только после actual matching stream adoption. Stable subscription уведомляет другие окна о truthful availability; coordinator хранит arbitration metadata, сами MediaStream/PC/SDK handles остаются у runtime.
5. Auth epoch меняется при account/token boundary как existing direct cleanup; старый owner становится closing, не стирается без track stop/late settlement. Stale finally/onended/StrictMode cleanup не выпускает новый owner.

## Direct integration без замены handlers

Existing pending join acquisition и generation guards сохраняются. Local lease берётся между `joinCoordinator.acquire` и `ensureLocalAudioStream`; при busy pending lease освобождается existing finally. Успешный start/join finally продолжает release **pending** lease, а local lease остаётся retained. Повторное использование своего stream требует matching retained owner.

Добавить один identity-safe cleanup path для local lease в existing full disposal и start/join error branches: generation invalidate → own stop → release после settlement. Leave/end уже вызывают own teardown до queued backend mutation; этот порядок сохранить. Account/token/chat/unmount/disabled используют тот же cleanup effect с layout timing: invalidation происходит при committed scope boundary до late promise continuation. Peer reset/remote departure/mute/minimize не выпускают local lease. Track ended сам по себе не означает completed call/backend cleanup; освобождение проходит full runtime teardown с учётом pending continuations.

Capture promise не имеет existing abort API. Cancel/unmount запрещают adoption, останавливают уже полученные tracks; slot остаётся closing до settlement. Late resolved tracks останавливаются немедленно, затем release matching owner. Не сбрасывать slot по timer или отсутствию stream ref. Permission prompt может долго не завершиться: это truthful closing, не fake successful cleanup. Pending join/late RPC compensation завершаются отдельно; local free не является authoritative operation-complete.

Будущий group adapter отдельно: privacy до join/capture, acquire до любых SDK capture helpers, собственные tracks.stop **до** async disconnect/leave, cleanup поздних factory/publication results. Reconnect/mute/track replacement не создают новый local call owner. Matching persistent publication budget и server ACK — отдельные prerequisites; никакие SDK интерфейсы здесь не угадываются.

## Области source candidate после code authorization

- Новый `apps/web/src/rtc/local-call-capture-owner.ts` и pure unit tests.
- Узкие context property, hook option/ref/cleanup в `rtc/context.tsx`, `rtc/useDirectCallSession.ts` и wiring `pages/ChatsPage.tsx`.
- Actual RTC fixture context adapters и capture lifecycle regressions; не production fake group hook.
- Этот ADR/plan и testing command в `docs/development.md` по окончательному fixture contract.

`GroupsPage`, note hooks, SDK/dependencies/proto/backend/proxy не менять. Отдельный code review проверяет diff против выбранного ordinary feature parent, а не только local integration.

## План проверок — всё UNRUN

| Сценарий | Требуемое наблюдение |
| --- | --- |
| Same-tick acquire двух windows / разных users | один winner; проигравший не вызывает capture, старый account не освобождается автоматически |
| Successful direct join finally | pending join lease released, active local lease retained |
| Второй direct/future group-kind acquisition | visible busy, no second getUserMedia/RPC, no auto-switch; pure group-kind не выдается за SDK audio |
| Cancel/unmount pending permission + late stream | closing до settlement; returned tracks stopped; no late adoption или снятие нового owner |
| Denied capture/start/join failure | собственный lease released после cleanup; следующий explicit action доступен |
| Old cleanup/StrictMode после нового attempt | exact identity сохраняет новый owner |
| Peer loss/rejoin, mute/minimize/focus | тот же capture ID/lease/mute; no reacapture |
| Token/account/chat/leave/end/unmount | own tracks stopped до async cleanup; account-only/token-only cases отдельно |
| Backend exit/compensation failure | local stopped, existing uncertain/error preserved; не объявляется server slot freed |
| Notes | diff hooks unchanged; existing recorder behavior/tests проходят без global mic claim |

Нужны pure coordinator и actual React/direct production hook fixtures с delayed capture/RPC, meaningful counts/0 skips. После source freeze/root window: Node22/pnpm10.19 frozen install, full unit JUnit, lint/app+Node build и согласованные existing RTC/composer/keyboard regressions через общий heavy runner. Physical audibility, iOS/Android OS lifecycle, cross-device/NAT/TURN и actual group media не подтверждаются этими fixtures.

## Review, publication и rollback

Docs-only clarification принят до code; source implementation и fresh exact-head проверки остаются отдельными checkpoints. Parent local integration содержит опубликованные feature histories, но ordinary feature-parent lineage/base должны быть проверены отдельно **до публикации**; не пушить assembly как проверенный main и не использовать main base с широким unrelated diff. После выбора parent ordinary merge локально и fresh exact-head receipts; no force push. Старые77df/de09 passes не подтверждают новый capture-owner scope.

Риски: indefinite closing permission, неверный auth epoch reset, stale finally, capture вне gate. Rollback — отдельный feature commit, без data migration/сброса drafts/keys; group flag остаётся выключенным. Local arbitration не security boundary. First slice внедряет direct coordination и future group kind contract; дальнейшая группа требует exact SDK/backend DTO/admission/operation-status/ACK handoff и отдельной actual приёмки.
