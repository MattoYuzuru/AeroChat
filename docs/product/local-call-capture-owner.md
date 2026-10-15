# Local call capture owner

Контракт реализован в `apps/web/src/rtc/local-call-capture-owner.ts` и direct call
hook. Решение — [ADR-089](../adr/089-group-audio-sfu-and-admission-boundary.md#local-call-capture-ownership--accepted-clarification).
Он координирует захват в одном app instance; notes/MediaRecorder и cross-device
backend admission имеют отдельный жизненный цикл.

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

## Проверка и ограничения

Pure unit tests и `apps/web/tests/rtc/owner.mjs` проверяют arbitration, поздний
capture, stale cleanup, token/account changes и сохранение owner при mute/recovery.
Команда и runtime requirements — в [development](../development.md).
Synthetic group-kind case не подтверждает SDK/SFU audio. Ожидающий browser
permission может оставлять slot closing до settlement; local release не означает
освобождение серверного grant или получение teardown ACK.
