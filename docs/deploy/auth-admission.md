# Auth admission для single-gateway runtime

Контракт — [ADR-091](../adr/091-auth-abuse-limits-and-bounded-password-admission.md). Это process-local policy; несколько gateway/identity процессов не делят budgets.

| Env | Default | Где действует |
| --- | --- | --- |
| `AERO_AUTH_REGISTER_BURST` | `3` | gateway register per IP |
| `AERO_AUTH_REGISTER_REFILL_INTERVAL` | `10m` | один token; sustained 6/hour |
| `AERO_AUTH_LOGIN_IP_BURST` | `20` | gateway login per IP |
| `AERO_AUTH_LOGIN_IP_REFILL_INTERVAL` | `1s` | один token; sustained 60/minute |
| `AERO_AUTH_LOGIN_ACCOUNT_BURST` | `5` | gateway per normalized login |
| `AERO_AUTH_LOGIN_ACCOUNT_REFILL_INTERVAL` | `6s` | один token; sustained 10/minute |
| `AERO_AUTH_MAX_BUCKET_KEYS` | `4096` | total gateway account/IP keys |
| `AERO_AUTH_TRUSTED_PROXY_CIDRS` | empty | only explicit proxy peer ranges |
| `AERO_AUTH_PASSWORD_CONCURRENCY` | `2` | identity, allowed 1..8; one operation per login |

Gateway in-flight: register 1 per IP, login 2 per IP и 1 per login. Positive burst values ограничены 1000, keys — 100000, refill interval — 24h. Некорректная конфигурация отклоняет startup. Defaults — выбранная консервативная policy, не measured denial-of-service threshold. Два Argon slots оцениваются как 128 MiB плюс overhead; повышение concurrency требует проверки memory budget оператора, а не ослабления Argon.

Без trusted proxy config gateway игнорирует forwarding headers и видит peer reverse proxy как один общий IP. Указать canonical принадлежащий вам peer CIDR (например loopback `/32` только для локального proxy); не копировать случайный Docker subnet из примера. Nginx обязан перезаписывать X-Real-IP своим `$remote_addr`; не передавать входящий client value. Gateway принимает ровно один valid X-Real-IP только от trusted peer. X-Forwarded-For не используется. Global `/0`, CIDR с host bits и IPv4-mapped prefix запрещены.

Full key table возвращает 429 новым keys. Fresh/in-flight keys не вытесняются; idle keys удаляются после 2h и полного восстановления bucket. Нельзя обходить это свежим key eviction. Restart сбрасывает локальные counters; он не является способом устранения abuse. Общий IP budget влияет на NAT, но заблокированный login не расходует его при повторных отказах.

Admission refusal возвращает Connect `resource_exhausted`, HTTP 429 и `Retry-After` в секундах. CORS разрешённого origin раскрывает этот response header. Auth request messages ограничены 4 KiB (до business handler); oversized payload требует уменьшения запроса, а не автоматического retry. Login неизвестного аккаунта и неправильный password одинаково возвращают InvalidCredentials и выполняют bounded Verify. Registration unique-login conflict сохраняется; availability имён этот flow не скрывает.

Argon работает синхронно: cancellation не освобождает slot до фактического возврата hasher. Отмена во время hashing отбрасывает результат до создания session/account; неопределённый результат последующего DB commit остаётся обычной границей mutation, этот slice её не меняет. Private payloads не входят в logs/metrics; account/IP bucket keys остаются только в process memory, labels не содержат credentials.

Перед rollout проверить обычный login/register через свой proxy и документированные 429 на tiny owned fixture. Rollback старого binary снимает эти ограничения; это возвращение readiness risk. Public targets, stress/load и production probes не входят в regression suite.
