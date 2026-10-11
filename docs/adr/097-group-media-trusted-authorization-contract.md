# ADR-097: Trusted authorization contract для group media admission

- Статус: Proposed — требуется review до implementation публичного media admission
- Дата: 2026-10-11
- Задача: [#176](https://github.com/MattoYuzuru/AeroChat/issues/176)
- Предпосылка: принятый [ADR-089](089-group-audio-sfu-and-admission-boundary.md)

## Контекст

`aero-rtc-control` сегодня проверяет bearer через Identity `GetCurrentProfile` и получает только user ID. Проверка Chat использует bearer текущего пользователя. Эти публичные операции достаточны для lobby, но не дают независимую проверку исходной auth session при reconnect по SFU JWT или reconcile после logout. Сохранять пользовательский bearer и выдавать его за target user запрещено. Доверять session ID или membership, которые прислал browser, также нельзя.

ADR-089 требует отзыва initial и refreshed SFU token, ограничения другого tab/device и подтверждённого teardown до успешного terminal результата. Текущие CallStatus ACTIVE/ENDED и синхронный lobby End не моделируют отказ SFU. Этот PR задаёт prerequisite contracts; он не меняет эти production paths.

## Предлагаемое решение

Identity владеет user/device/session source of truth, Chat — текущим membership/role, RTC — call/participant/media generation и revoke state. Выделить proto-first **internal-only** методы проверки:

| Проверка | Вход после server authentication | Авторитетный результат |
| --- | --- | --- |
| Resolve текущего bearer при подготовке grant | bearer в существующем request context; он не сохраняется | user ID, session ID, device ID, session/device active |
| Identity session lookup при admission/reconcile | ожидаемые user/session/device IDs из registry RTC | та же связка активна либо revoked/not found |
| Chat subject eligibility | group ID + user ID из registry RTC | текущий owner/admin/member либо reader/removed/not found |

Внутренние проверки не выдают bearer и не создают target-user session. Caller identity выдаёт deployment authority; browser не может выбирать service identity. Нужны отдельный private listener/network policy и проверяемая service authentication (mTLS service identities с отдельными сертификатами Identity/Chat/RTC/admission). Обычный публичный gateway, browser bearer, SFU JWT и произвольный заголовок caller не открывают эти methods. Ключи/certificates и rotation принадлежат runtime owner. Пока этот transport contract не принят и negative tests публичного доступа не проходят, новые методы, media grants и feature flag не включаются.

Оба lookup выполняются свежими на каждом upgrade, включая reconnect/validate routes; permission cache не разрешает доступ. Ошибка/timeout authority означает deny/degraded, но не false permanent eviction. Definitive revoke/removal вызывает RTC revoke/teardown. Между отдельными Identity/Chat lookup и фактическим upgrade остаётся race: future integration обязана сериализовать RTC grant state с admission registration, закрывать уже зарегистрированные connections по событию revoke и иметь 5s reconcile как recovery. Это не распределённая atomic transaction и не обещание мгновенной глобальной revocation при недоступной authority.

## Registry и состояния

Stable key — непрозрачная server-generated participant identity + server room + media generation. Registry дополнительно связывает grant ID, call ID, participant ID, user/session/device IDs; raw bearer, initial/refreshed JWT и token hash не хранятся как единственный ключ авторизации. SFU JWT подписывает стандартный SDK; admission проверяет signature, ожидаемый issuer, expiry/not-before и permissions этим SDK, затем authoritative binding. Generation определяется immutable registry mapping room/identity, а не произвольным custom claim browser; mapping не переиспользуется для новой generation. Refreshed JWT с той же identity не создаёт новый grant и не снимает revoke.

Одновременно разрешена одна active media generation на user во всех calls/tabs/devices. Registry reserve и atomic Join сериализуются в RTC transaction; конфликт другого device/session видим пользователю. Initial token TTL и publish budget фиксируются в implementation PR вместе с pinned SDK; срок JWT не заменяет authoritative lifetime grant. Token допускает только microphone audio, без data/video/screen/metadata/admin/recording. Один audio track и quota требует SFU-side enforcement с negative fixture.

Admission registration дополнительно сериализует один signaling connection lease на generation: новый upgrade не вытесняет ещё живой connection молча. SDK reconnect/handoff и освобождение старого connection проверяются actual pinned SDK fixture, затем допустим следующий connection той же generation. SFU JWT остаётся bearer capability: lookup сессии доказывает её активность и принадлежность выданного grant, но сам по себе не доказывает физическое устройство предъявителя украденного token. Device conflict проверяется при reservation нового grant; никакой самодельной proof-of-possession crypto в этом slice нет.

| Состояние | Admission | Дальнейшее действие |
| --- | --- | --- |
| prepared | закрыт | проверенная reservation, ещё нет mint/connection |
| active | только свежая authority + точное binding | heartbeat/reconcile; один generation |
| revoking | закрыт для initial/refreshed tokens | закрыть proxy connections + SFU disconnect/delete, bounded retry |
| revoked | закрыт | teardown подтверждён, terminal result и освобождение slot |

Begin revoke необратимо закрывает admission **до** SFU cleanup. Failed cleanup оставляет `revoking`, видимое pending/error и удерживает slot; он не переводит call в successful ENDED. Повторный запрос с тем же operation ID идемпотентен; устаревший acknowledgement другой generation не освобождает текущую. При crash durable registry/outbox восстанавливает cleanup до нового grant. Persistence, transactional outbox, RPC additive media state и изменения End/Leave реализуются отдельным PR после review; reference model не является их реализацией.

## Проверки и границы slice

Pure reference model проверяет exact binding, revoked session/device, reader/removed, authority failure, initial/refreshed identity после revoke, old-generation acknowledgement и pending failed teardown. Это model evidence, а не proof JWT, mTLS, proxy, SFU track limits или сети. Production RTC lobby, contracts/generated code, Identity/Chat handlers, dependencies, runtime и UI в этом slice не меняются; group audio остаётся отсутствующим.

Дальше нужны узкие PR: internal authorization proto/handlers + closed listener tests; pinned SFU/proxy runtime с SDK endpoint matrix; durable grant/admission/teardown integration; lazy browser lifecycle; synthetic и отдельная real-device/NAT/TURN приёмка. Источник privacy остаётся ADR-089: transport audio доступно trusted SFU, E2EE не заявляется.

## Последствия и альтернативы

Добавляется явная service-auth boundary и отказоустойчивая media state machine. Это дороже хранения bearer, но оставляет authorization source of truth у соответствующего домена и позволяет отзыв при reconnect/reconcile. Проверка только user ID через публичный GetCurrentProfile не связывает первоначальную session. Проверка только JWT expiry допускает replay после remove и не удовлетворяет ADR-089. Общий service bearer без caller identity/rotation не выбран.

## Первичные источники

- [Go 1.25 crypto/tls Config](https://pkg.go.dev/crypto/tls@go1.25.0#Config): verified client chain и дополнительная caller identity policy нужны вместе; service certificate не открывает все внутренние методы автоматически.
- [LiveKit access tokens и refresh/revocation](https://docs.livekit.io/frontends/reference/tokens-grants/): refreshed token может жить 10 минут, self-host removal не отзывает старый JWT; room/identity должны быть непрозрачными.
