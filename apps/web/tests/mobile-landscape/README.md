# Landscape pinned regression

Один direct/tombstone сценарий воспроизводит последовательность320×568→390×844→768×1024→568×320 без reload, с actual production SVG, CSS и LegacyAppShell. Auth/RTC adapters берутся из соседнего `mobile` fixture; backend здесь не запускается.

На каждом размере fill→две animation frames→focus повторяет native layout stimulus. До assertions сохраняются только geometry/counts/computed layout; text/body/credentials не выводятся. Width140, textarea39, history48, controls32, draft/pin и natural Tab сохраняют прежние thresholds. Existing `mobile/pinned.mjs` семь случаев и `mobile/mobile.mjs`147 случаев этим не меняются.

Запускать только через coordinator-reviewed `agent-dev` driver с Node22/pnpm10.19/CFT153, offline frozen install, fresh private artifact/JUnit и owned process cleanup. Используются `PINNED_LAYOUT_ARTIFACT_DIR`, `PINNED_LAYOUT_JUNIT`, `PINNED_LAYOUT_SOURCE_ROOT`, `PINNED_LAYOUT_FIXTURE_PORT`, `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`. Baseline может PASS или FAIL: ожидаемый FAIL не форсируется. Если воспроизведения нет, нужен отдельный bounded native geometry witness. Этот fixture не подтверждает native page/zoom/OS keyboard/touch или физическое аудио.
