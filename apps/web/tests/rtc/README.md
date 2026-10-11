# Browser regression для direct RTC

`playback.mjs` запускает production `useDirectCallSession` на настоящем React и извлекает без изменения playback effect из `ChatsPage`. Audio element, capture, peer connection и RPC заменены ограниченными fixtures: тест проверяет lifecycle управления playback, но не акустику, microphone permissions, NAT/TURN или WAN.

После `pnpm install --frozen-lockfile` нужны внешний Playwright runtime и установленный Chromium. Их абсолютные пути задаются в `PLAYWRIGHT_MODULE` (ESM entrypoint) и `CHROMIUM_EXECUTABLE`; дополнительные зависимости продукта не устанавливаются. Запуск из корня repository:

```bash
agent-dev run --cwd "$PWD" --node 22 --resource heavy -- node apps/web/tests/rtc/playback.mjs
agent-dev run --cwd "$PWD" --node 22 --resource heavy -- node apps/web/tests/rtc/capture.mjs
```

`capture.mjs` откладывает capture и server mutation для start/join; проверяет unmount и смену thread scope, освобождение tracks, отсутствие stale peer/RPC и один компенсирующий leave после позднего RPC success. Двойной click использует один capture/mutation, permission denial не изменяет серверное участие.

Fixture слушает только `127.0.0.1:25173` (`RTC_FIXTURE_PORT` может задать выделенный порт) и закрывает Vite/browser после проверки. Тест утверждает один `play()` на track, отсутствие restart при participant refresh, один cleanup при смене stream, bounded autoplay denial, один explicit retry и detach при unmount. Fake `play()` намеренно останавливает возможный цикл после третьего completion, чтобы неисправленная версия завершалась с assertion failure, а не бесконечным React loop.
