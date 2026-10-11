# ADR-089: Group audio через отдельный SFU и проверяемую admission boundary

- Статус: Proposed — требуется принятие владельцем до implementation
- Дата: 2026-10-11
- Задача: [#176](https://github.com/MattoYuzuru/AeroChat/issues/176)
- Развивает ADR-003; заменяет ограничение lobby-only ADR-078 только после реализации и приёмки.

## Контекст

Group lobby сегодня не передаёт звук. ADR-003 предусматривает отдельный SFU media plane. Реальные устройства в текущей сессии недоступны: пользователь подтвердил только Mac; даже будущий synthetic media test не завершает трёхпользовательскую device/NAT/TURN приёмку.

## Предлагаемое решение

### Topology и privacy

Выбрать self-hosted LiveKit SFU как специализированный media component; AeroChat backend остаётся Go-first. SFU не владеет users, memberships, ролями, call lifecycle или auth source of truth. Cloud service, agents, recording, transcription, video, screen share и серверное сохранение аудио отключены и не входят в первый slice. Точные server/SDK версии, digests, лицензии и совместимость фиксируются в runtime PR после отдельной проверки.

Первый slice использует WebRTC transport encryption до SFU. SFU может получить аудио; это **не E2EE**. UI до join показывает пользователю этот privacy факт. Сервер не пишет audio payload или ключи в логи и не создаёт recordings. E2EE SFU требует отдельной утверждённой key distribution/rotation/device membership спецификации. Shared key, выданный сервером рядом с join token, не доказывает защиту от самого сервера и не вводится как её имитация.

### Admission и отзыв

`aero-rtc-control` после atomic Join и актуального identity/chat authorization выдаёт короткоживущий grant ровно на call, participant и auth session. One-active-call-per-user сохраняется. Room name формируется из server call ID и media generation, а не имени или произвольного параметра клиента. Browser grant не имеет roomAdmin, recording, arbitrary room creation или data publish permissions.

Self-hosted LiveKit RemoveParticipant сам по себе не гарантирует token revocation; Cloud-only возможности не считаются частью self-host. Поэтому public SFU signaling доступен только через media admission proxy. На каждом initial/reconnect websocket upgrade proxy проверяет signature стандартным SDK, grant в RTC и актуальное право пользователя/auth session через identity/chat. SFU signaling origin нельзя достигнуть в обход proxy. RTP/UDP media не проксируется application gateway. Это отдельная media edge boundary, её контракт и все SDK reconnect endpoints проверяются до выдачи grants.

При leave/end/remove/revoke control plane сначала прекращает выдачу grants, закрывает admission connection и вызывает SFU disconnect/delete room. Операция завершается успешным terminal состоянием только после подтверждения media teardown; при недоступном SFU показывает pending/error и повторяет bounded cleanup. Сверка активных SFU participants с authoritative RTC grants каждые 5 секунд — recovery механизм, а не первичная авторизация. Повторное использование старого token через proxy должно отклоняться до audio subscription. Пока этот negative test не проходит, group media feature flag выключен.

### Device lifecycle, ресурсы и recovery

Первый предел — 4 участника, один audio track на participant, без reader listening и auto-switch между calls. Это плановый product limit, не измеренная capacity. Одна active media generation на user; другой tab/device получает явный conflict. Browser getUserMedia запрашивается только по join action. Cancellation/unmount/denied capture останавливают tracks и освобождают slot; поздний RPC компенсируется leave. Minimized desktop окно сохраняет уже начатый звонок, явный leave прекращает его. Mobile background continuity пока unsupported с явным отображением разрыва.

Mute/unmute принадлежит пользователю, remote unmute запрещён. Один скрытый audio element на remote participant/track; stable attachment, autoplay denial требует пользовательского action. Timeout соединения — 20 секунд; не более двух reconnect attempts в пределах 30 секунд, затем terminal error и освобождение media/RTC resources. Stale heartbeat использует ADR-086 RTC и проверяется независимо от media progress.

Для четырёх участников при плановом Opus payload 32 kbit/s SFU получает около 128 kbit/s и отправляет около 384 kbit/s до transport overhead; это арифметический budget, не benchmark. До увеличения лимита измерить CPU, actual bitrate/loss/jitter, packet retransmit и overhead на согласованном стенде. SFU host ports/TLS/public IP и TURN credentials отделены от существующего 1:1 coturn contract; collision и forced relay проверяются runtime owner. SDK грузится lazy при первом group call.

## Последовательность узких PR

1. Принятый ADR, contract/state machine и тесты admission/revocation. Уточнить identity session authorization interface; public токены не логируются.
2. Feature-flagged local SFU runtime/admission proxy с pinned dependencies, private upstream, health/degraded gates и rollback без удаления retained data.
3. RTC grants и authoritative teardown/reconcile; fake SFU плюс owned localhost integration, rejected stale/replayed/removed grants и crash recovery.
4. Lazy browser media runtime: capture, stable playback, mute, cancellation, reconnect и stats. Lobby-only flow остаётся доступным при выключенном media flag с честным copy.
5. UI/accessibility и synthetic three-user matrix отдельно от real device evidence; затем три реальные учётные записи/устройства, forced relay и разные сети. Общая integration branch только для приёмки, без merge/deploy разрешения.

Каждый PR имеет отдельный branch/worktree, точный HEAD и fresh receipts. Group audio нельзя помечать validated до последнего шага. Closed issues, ICE connected или обновление roster не заменяют media progress.

## Альтернативы и последствия

Mesh для маленькой группы проще по server privacy, но меняет SFU направление ADR-003, требует N−1 upload streams на слабом устройстве и отдельного mesh peer lifecycle. Он остаётся реальной альтернативой, если владелец не принимает доверенный SFU. Собственный SFU на Pion требует значительно больше protocol/operational work. Managed cloud меняет self-host/privacy boundary и не выбран.

LiveKit добавляет фундаментальную зависимость и media edge. Без admission proxy self-host token replay после remove остаётся блокером. Transport-only privacy требует явного принятия владельцем; если E2EE обязательна уже для первого group audio, implementation откладывается до утверждённой спецификации, а lobby не выдаётся за завершённую цель.

## Первичные источники

- [Self-host deployment и TURN](https://docs.livekit.io/transport/self-hosting/deployment/)
- [Encryption и ответственность за key distribution](https://docs.livekit.io/transport/encryption/)
- [Participant removal; Cloud-only revocation](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/)
