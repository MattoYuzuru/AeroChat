# ADR-089: Group audio через отдельный SFU и проверяемую admission boundary

- Статус: Accepted — владелец принял trusted self-hosted SFU с явным уведомлением в UI 2026-10-11
- Дата: 2026-10-11
- Задача: [#176](https://github.com/MattoYuzuru/AeroChat/issues/176)
- Развивает ADR-003; заменяет ограничение lobby-only ADR-078 только после реализации и приёмки.

## Контекст

Group lobby сегодня не передаёт звук. ADR-003 предусматривает отдельный SFU media plane. Реальные устройства в текущей сессии недоступны: пользователь подтвердил только Mac; даже будущий synthetic media test не завершает трёхпользовательскую device/NAT/TURN приёмку.

## Решение

### Topology и privacy

Выбрать self-hosted LiveKit SFU как специализированный media component; AeroChat backend остаётся Go-first. SFU не владеет users, memberships, ролями, call lifecycle или auth source of truth. Cloud service, agents, recording, transcription, video, screen share и серверное сохранение аудио отключены и не входят в первый slice. Точные server/SDK версии, digests, лицензии и совместимость фиксируются в runtime PR после отдельной проверки.

Первый slice использует WebRTC transport encryption до SFU. SFU может получить аудио; это **не E2EE**. UI до join показывает пользователю этот privacy факт. Сервер не пишет audio payload или ключи в логи и не создаёт recordings. E2EE SFU требует отдельной утверждённой key distribution/rotation/device membership спецификации. Shared key, выданный сервером рядом с join token, не доказывает защиту от самого сервера и не вводится как её имитация.

### Admission и отзыв

`aero-rtc-control` после atomic Join и актуального identity/chat authorization выдаёт короткоживущий grant ровно на call, participant и auth session. One-active-call-per-user сохраняется. Room name формируется из server call ID и media generation, а не имени или произвольного параметра клиента. Browser grant не имеет roomAdmin, recording, arbitrary room creation или data publish permissions.

Self-hosted LiveKit RemoveParticipant сам по себе не гарантирует token revocation; Cloud-only возможности не считаются частью self-host. Поэтому public SFU signaling доступен только через media admission proxy. На каждом initial/reconnect websocket upgrade proxy проверяет signature стандартным SDK, grant в RTC и актуальное право пользователя/auth session через identity/chat. Proxy охватывает `/rtc`, `/rtc/v1` и соответствующие `/validate` endpoints; список фиксируется по pinned SDK/server и подтверждается actual SDK fixture. SFU signaling origin нельзя достигнуть в обход proxy. RTP/UDP media не проксируется application gateway. Это отдельная media edge boundary, её контракт и все SDK reconnect endpoints проверяются до выдачи grants.

SFU может выдавать refreshed JWT. Registry связывает стабильные identity/room/media generation с authoritative grant и auth session; token hash или jti первоначального JWT не являются единственным ключом admission. После revoke отклоняются первоначальный и любой refreshed token. Query `access_token` не попадает в access/error logs: proxy и edge пишут sanitized path, без request URI, token/body или ключей. Grant ограничивает `canPublishSources` microphone, запрещает publish data и изменение собственной metadata. Один audio track и server resource quota должны проверяться на SFU/admission boundary, а не только в browser UI.

При leave/end/remove/revoke control plane сначала прекращает выдачу grants, закрывает admission connection и вызывает SFU disconnect/delete room. Операция завершается успешным terminal состоянием только после подтверждения media teardown; при недоступном SFU показывает pending/error и повторяет bounded cleanup. Сверка активных SFU participants с authoritative RTC grants каждые 5 секунд — recovery механизм, а не первичная авторизация. Повторное использование старого token через proxy должно отклоняться до audio subscription. Пока этот negative test не проходит, group media feature flag выключен.

### Device lifecycle, ресурсы и recovery

Первый предел — 4 участника, один audio track на participant, без reader listening и auto-switch между calls. Это плановый product limit, не измеренная capacity. Одна active media generation на user; другой tab/device получает явный conflict. Browser getUserMedia запрашивается только по join action. Cancellation/unmount/denied capture останавливают tracks и освобождают slot; поздний RPC компенсируется leave. Minimized desktop окно сохраняет уже начатый звонок, явный leave прекращает его. Mobile background continuity пока unsupported с явным отображением разрыва.

Mute/unmute принадлежит пользователю, remote unmute запрещён. Один скрытый audio element на remote participant/track; stable attachment, autoplay denial требует пользовательского action. Timeout соединения — 20 секунд; не более двух reconnect attempts в пределах 30 секунд, затем terminal error и освобождение media/RTC resources. Stale heartbeat использует ADR-086 RTC и проверяется независимо от media progress.

Для четырёх участников при плановом Opus payload 32 kbit/s SFU получает около 128 kbit/s и отправляет около 384 kbit/s до transport overhead; это арифметический budget, не benchmark. До увеличения лимита измерить CPU, actual bitrate/loss/jitter, packet retransmit и overhead на согласованном стенде. SFU host ports/TLS/public IP и TURN credentials отделены от существующего 1:1 coturn contract; collision и forced relay проверяются runtime owner. SDK грузится lazy при первом group call.

### Local call capture ownership — Proposed clarification

Статус уточнения: **Proposed**, требуется отдельный review перед реализацией; основной ADR остаётся Accepted. Этот раздел не означает, что browser owner уже реализован или group media включён. [План узкого slice](../product/local-call-capture-owner-plan.md) отделяет local capture от authoritative admission.

Для direct и будущего group runtime предлагается один local **call-capture slot на app instance**, а не отдельный slot на user. Его lifetime: `capture_pending → retained → closing → released`. Synchronous acquire выполняется до capture; успешный join сохраняет lease до собственного полного teardown. Mute, peer recovery, потеря focus и minimized desktop окно не освобождают lease. Conflict виден пользователю; auto-switch и остановка чужого owner запрещены.

Local identity состоит из opaque owner token, локальной auth epoch и scope/runtime generation. Epoch меняется при account/token boundary без хранения bearer, JWT или выдуманного server session ID в coordinator. Phase/release проверяют exact owner identity: stale cleanup другой generation не освобождает текущую lease. При account change pending capture старого account удерживает единственный app slot до settlement, а не освобождает параллельный slot для нового user.

Cancellation/unmount немедленно запрещают late adoption и останавливают уже полученные собственные tracks **до async cleanup**. Незавершённый capture остаётся `closing`: поздний результат останавливается до release, пустые refs или timer не доказывают отсутствие позднего stream. Пока browser permission promise не settled, UI не выдаёт закрытие за успешное освобождение. `retained` отличается от существующего direct pending join coordinator: тот сохраняет свою RPC/uncertain-compensation lifetime и не хранит active media.

Local release не освобождает backend grant/publication slot. Authoritative held/revoking/operation status и matching proxy/SFU teardown acknowledgement остаются отдельным контрактом ADR-097. Group-kind unit contract не является SDK/media implementation или доказательством group audio. Cross-tab/device enforcement принадлежит backend; этот app-local coordinator не создаёт browser authorization boundary.

Уточнение ограничено calls. Существующие encrypted voice/video MediaRecorder notes, включая video-only fallback и recorded drafts, не изменяются и не auto-discard. SFU recording запрет и microphone publication budget не означают запрет локальной заметки во время call. Общая взаимная блокировка calls и recorders требует отдельного product решения; call-only slice не обещает единственного физического микрофона во всём приложении. SDK/dependencies, group UI/capture/flag, proto/backend/proxy здесь не реализуются.

## Последовательность узких PR

1. Принятый ADR, contract/state machine и тесты admission/revocation. Уточнить identity session authorization interface; public токены не логируются.
2. Feature-flagged local SFU runtime/admission proxy с pinned dependencies, private upstream, health/degraded gates и rollback без удаления retained data.
3. RTC grants и authoritative teardown/reconcile; fake SFU плюс owned localhost integration, rejected stale/replayed/removed grants и crash recovery.
4. Lazy browser media runtime: capture, stable playback, mute, cancellation, reconnect и stats. Lobby-only flow остаётся доступным при выключенном media flag с честным copy.
5. UI/accessibility и synthetic three-user matrix отдельно от real device evidence; затем три реальные учётные записи/устройства, forced relay и разные сети. Общая integration branch только для приёмки, без merge/deploy разрешения.

Каждый PR имеет отдельный branch/worktree, точный HEAD и fresh receipts. Group audio нельзя помечать validated до последнего шага. Closed issues, ICE connected или обновление roster не заменяют media progress.

## Альтернативы и последствия

Mesh для маленькой группы проще по server privacy, но меняет SFU направление ADR-003, требует N−1 upload streams на слабом устройстве и отдельного mesh peer lifecycle. Он остаётся реальной альтернативой, если владелец не принимает доверенный SFU. Собственный SFU на Pion требует значительно больше protocol/operational work. Managed cloud меняет self-host/privacy boundary и не выбран.

LiveKit добавляет фундаментальную зависимость и media edge. Без admission proxy self-host token replay после remove остаётся блокером. Владелец явно принял transport-only privacy для первого этапа с уведомлением перед join; E2EE остаётся отдельным этапом после утверждённой спецификации. Принятие ADR не подтверждает реализованный звук или приёмку устройств; lobby не выдаётся за завершённую цель.

## Первичные источники

- [Self-host deployment и TURN](https://docs.livekit.io/transport/self-hosting/deployment/)
- [Encryption и ответственность за key distribution](https://docs.livekit.io/transport/encryption/)
- [Participant removal; Cloud-only revocation](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/)
- [Token refresh и grants](https://docs.livekit.io/frontends/reference/tokens-grants/)
- [Signaling и validate endpoints](https://github.com/livekit/livekit/blob/master/cmd/test-server/README.md)
