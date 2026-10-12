# Browser regression для direct RTC

`mute.mjs` исполняет production hook и `DirectCallMicrophoneButton`: microphone
mute/unmute, быстрые toggles, отсутствие второго capture/peer, сохранение mute
после peer recovery, guard до join/во время capture/для ended track и reset после
leave/end/chat/account/unmount. Capture/PC/RPC синтетические; hardware silence,
NAT/TURN и акустическое качество не доказаны. Запуск через тот же heavy runner:
`node apps/web/tests/rtc/mute.mjs` с внешними Playwright/Chromium paths.

`recovery.mjs` проверяет сохранение retry после delayed ICE/duplicate answer/malformed payload, отмену после connected negotiation, изоляцию old peer event и late candidate completion от новой ICE queue, exhausted budget с явным return и pending configuration после смены scope. Используется production hook с fake PC/RPC/media; реальный ICE progress/network не доказан.

`playback.mjs` запускает production `useDirectCallSession` на настоящем React и извлекает без изменения playback effect из `ChatsPage`. Audio element, capture, peer connection и RPC заменены ограниченными fixtures: тест проверяет lifecycle управления playback, но не акустику, microphone permissions, NAT/TURN или WAN.

После `pnpm install --frozen-lockfile` нужны внешний Playwright runtime и установленный Chromium. Их абсолютные пути задаются в `PLAYWRIGHT_MODULE` (ESM entrypoint) и `CHROMIUM_EXECUTABLE`; дополнительные зависимости продукта не устанавливаются. Запуск из корня repository:

```bash
agent-dev run --cwd "$PWD" --node 22 --resource heavy -- node apps/web/tests/rtc/playback.mjs
agent-dev run --cwd "$PWD" --node 22 --resource heavy -- node apps/web/tests/rtc/capture.mjs
agent-dev run --cwd "$PWD" --node 22 --resource heavy -- node apps/web/tests/rtc/recovery.mjs
```

`capture.mjs` откладывает capture, ICE configuration и server mutation для start/join; проверяет unmount и смену thread scope, освобождение всех tracks, отсутствие stale peer/RPC и один компенсирующий leave после позднего RPC success. Двойной click использует один capture/mutation, permission denial не изменяет серверное участие. Production lease implementation принадлежит fixture owner и переживает remount hook: новый same-user join не обгоняет pending RPC/Leave, failed Leave блокирует старый call до свежего inactive snapshot, смена account сохраняет отдельный pending join identity, но новый account не обгоняет старый closing app-local capture до его settlement. Provider wiring дополнительно проверяется typecheck/build; полный AuthProvider/backend flow эта fixture не поднимает.

Fixture слушает только `127.0.0.1:25173` (`RTC_FIXTURE_PORT` может задать выделенный порт) и закрывает Vite/browser после проверки. Тест утверждает один `play()` на track, отсутствие restart при participant refresh, один cleanup при смене stream, bounded autoplay denial, один explicit retry и detach при unmount. Fake `play()` намеренно останавливает возможный цикл после третьего completion, чтобы неисправленная версия завершалась с assertion failure, а не бесконечным React loop.


`owner.mjs` исполняет production direct hook и local call-capture owner на React:
retained lease после join, два окна, closing до late capture/RPC settlement,
account/token/scope/unmount, denial/failure, own stop до async exit, mute/peer
recovery/minimize и StrictMode. Media/PC/RPC синтетические; group-kind lease —
только контракт arbitration, не SDK или group audio. Recorders не участвуют,
app-wide physical mic exclusion не заявляется. Фикстура требует новый private
external `LOCAL_CALL_OWNER_ARTIFACT_DIR`, записывает stages/result/failure и закрывает
свои browser/Vite. Нужны внешние `PLAYWRIGHT_MODULE`/`CHROMIUM_EXECUTABLE`,
`RTC_FIXTURE_PORT=25174` (или отдельно согласованный owned localhost порт).
После source freeze запускать только назначенным heavy window:

```bash
agent-dev run --cwd "$PWD" --node 22 --resource heavy -- node apps/web/tests/rtc/owner.mjs
```

Наличие source фикстуры не означает её PASS; exact-source receipts фиксируются отдельно.


Owner fixture использует actual awareness reducer и immutable per-render refresh
callbacks. Token/account/scope boundaries отдельно утверждают current opaque
callback/context identity и actual React loading commit до fresh ready commit;
credential values не логируются. Ready/closing/stopped-track assertions и timeout
сохраняются. `optimizeDeps.entries=['owner-index.html']` ограничивает поддерживаемый
Vite scan собственным entry ([официальная опция](https://vite.dev/config/dep-optimization-options.html#optimizedeps-entries));
installed Vite7.3.1 types/computeEntries подтверждают тот же contract. Это не
отключает optimizer и не скрывает dependency errors. Historical whole1a4 FAIL
на token boundary сохранён отдельно; fixture/source correction требует нового gate.
