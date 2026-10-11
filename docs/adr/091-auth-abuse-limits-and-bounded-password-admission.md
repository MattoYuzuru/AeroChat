# ADR-091: Auth abuse limits и ограничение password admission

- Статус: Accepted, контракт implementation slice; не подтверждение production readiness
- Дата: 2026-10-11
- Задача: [#177](https://github.com/MattoYuzuru/AeroChat/issues/177)
- Уточняет ADR-006, сохраняет gateway-only edge и силу Argon2id.

## Контекст

Register/Login публичны через gateway; password hashing требует 64 MiB и cost 3 на операцию. Ограничений запросов и hashing concurrency не было. Это design/readiness risk: порог отказа под нагрузкой не измерялся. Auth revocation и malformed credentials исправляются отдельно (#149, #155); crypto registry не меняется.

## Решение

Gateway применяет process-local token buckets до downstream Register/Login. По умолчанию:

| Контроль | Burst | Восстановление токена | In-flight |
| --- | --- | --- | --- |
| Register per client IP | 3 | раз в 10 минут (6/hour) | 1 |
| Login per client IP | 20 | раз в секунду (60/minute) | 2 |
| Login per normalized login | 5 | раз в 6 секунд (10/minute) | 1 |

Нормализация login совпадает с identity: trim и lower-case. Ограничение имени применяется до lookup, одинаково к существующему и несуществующему аккаунту. Проверка account bucket/in-flight предшествует общей IP capacity: повторные отказы одному abusive login не расходуют весь NAT budget. Другой login за тем же IP может использовать второй in-flight slot. Общий IP rate всё же распространяется на пользователей за NAT; лимиты не обещают абсолютной fairness при ротации аккаунтов.

Default bound для buckets — 4096 ключей; operator может выбрать положительное значение до 100000. Полная таблица отклоняет новые keys; свежие или in-flight keys не вытесняются. Удаляются только idle keys после полного восстановления bucket и достаточного idle периода. Refusal не требует неограниченных goroutines/очереди. Register и Login имеют разные IP counters.

Identity независимо ограничивает synchronous password hashing/verification: default 2 операции, не более 1 операции на normalized login. Оценка Argon memory — 2 × 64 MiB = 128 MiB плюс overhead, это расчёт, а не измеренная capacity. Argon parameters не снижаются. Unknown login и неправильный пароль возвращают одинаковый InvalidCredentials; missing account выполняет bounded Verify по фиксированному публичному dummy hash с теми же Argon parameters. Register сохраняет существующий unique-login conflict: немедленная регистрация с выдачей session неизбежно раскрывает availability имени, полной enumeration-safe регистрации этот slice не обещает.

Context проверяется до admission и после password operation. После начала Argon вычисления slot остаётся занятым до фактического возврата синхронной функции, даже если caller отменил запрос: преждевременное освобождение разрешило бы лишние вычисления. Defer освобождает slot на success/error/cancellation. Shutdown не создаёт фоновые hashing jobs; уже начатая bounded работа завершается штатно.

Превышение возвращает Connect ResourceExhausted / HTTP 429 с Retry-After в целых секундах: ceil до следующего токена либо минимум 1 секунда для concurrency/full-table. Разрешённый CORS origin видит Retry-After. Register/Login message ограничен 4 KiB до handler; этот отказ требует исправления payload, не retry по времени. Ошибка не содержит credential/login/IP; HTTP instrumentation сохраняет только существующие method/status counters. [Operator defaults и rollout](../deploy/auth-admission.md).

### Client IP и proxy trust

По умолчанию gateway использует peer RemoteAddr и игнорирует forwarding headers. Только явно настроенные trusted peer CIDRs разрешают один X-Real-IP с IP literal; отсутствующее/дублированное/невалидное значение у trusted peer отклоняется. X-Forwarded-For не участвует в решении. Ошибка CIDR — ошибка старта; trust-all/RFC1918 default не вводится. Operator задаёт exact принадлежащий ему proxy peer range и обеспечивает, чтобы внешние клиенты не подключались напрямую через trusted range. Peer IPv4-mapped address нормализуется перед bucket lookup.

## Проверка и rollout

Конфигурация загружается при старте; runtime/env docs описывают значения и proxy contract. Tiny localhost fixture использует максимум два worker requests и bounded channels; проверяет 429/Retry-After, same-NAT different login, cancellation и release slot. Clock-driven unit tests проверяют burst/refill, full-table fail-closed и idle-only cleanup. Startup config tests отклоняют malformed CIDRs/неположительные лимиты. Public/production load tests не выполняются.

Смена policy выполняется отдельным rollout. Проверить обычный login/register через свой reverse proxy до открытия публичного edge; без trusted proxy config все запросы за proxy считаются одним peer. Rollback binary возвращает прежние отсутствие лимитов; это осознанный возврат readiness risk, не переключение storage model.

## Последствия и альтернативы

Process restart сбрасывает локальные buckets; несколько gateway/identity процессов имеют независимые budgets. Решение не является distributed brute-force/DoS protection. Для multi-instance требуется отдельный ADR. Full-table refusal может затронуть новых пользователей; fresh-key eviction запрещён, иначе rotation обходила бы rate limit. Нет неограниченного ожидания Argon slots.

Distributed rate store, CAPTCHA и новый login/recovery flow отложены: они расширяют зависимости и продуктовый scope. Уменьшение Argon cost не выбрано. Client-supplied IP без проверенного proxy peer не принимается.

## Источники

- [Connect errors и HTTP representation](https://connectrpc.com/docs/go/errors/)
- [HTTP Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)
