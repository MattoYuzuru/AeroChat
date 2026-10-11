# aero-chat

Chat владеет группами, membership и текущими ролями. Контракты сообщений и encrypted lane описаны в [навигаторе ADR](../../docs/README.md); [ADR096](../../docs/adr/096-encrypted-conversation-server-sequence.md) задаёт server sequence и порядок group → thread locks. Этот документ описывает source authority для будущего group audio по принятому [ADR097](../../docs/adr/097-group-media-trusted-authorization-contract.md).

## Eligibility epoch и source outbox

Additive migration024 добавляет `group_membership_authority_versions`: exact group/user pair, positive persisted revision, present/eligible state. Membership остаётся источником свежей role; таблица версий сохраняет tombstone после physical удаления. Existing memberships получают epoch1; удалённые до migration пары не восстанавливаются. До подключения media активных grants на старый state нет.

Owner/admin/member имеют одинаковый audio eligibility: переходы между ними и ownership transfer сохраняют epoch без revoke event. Eligible→reader и physical remove/leave увеличивают epoch и добавляют ID-only event; reader→eligible и removed→rejoin увеличивают epoch без revoke event. Reader initial/rejoin остаётся запрещённым для media. Повтор одного state ничего не меняет. Message-only restriction не становится audio ban. Management permissions всегда используют свежую role, а не кеш по epoch.

AFTER membership trigger атомарно меняет state/outbox, включая group FK cascade. Trigger имеет SECURITY INVOKER, schema-qualified таблицы через quoted trigger schema и не берёт parent/user locks. Pair IDs immutable. Missing/inconsistent authority state и exhausted counter откатывают source operation; eligible MaxInt64 запрещён. RESTRICT user FK сохранён: raw user delete не каскадирует membership. Source outbox без FK cascade переживает удаление membership/group, а после допустимого удаления user сохраняет IDs/revision/reason. В outbox нет invite bearer/hash, profiles, MLS/keys, message/audio payload.

Existing membership и invite writers сериализуются на group row; quota paths берут user quota lock до group. Invite disable/create соблюдают group → invite порядок, Join не инвертирует его. Group encrypted message append сохраняет group → thread порядок. Raw cascades требуют отдельных native concurrency checks: trigger atomicity не является доказательством отсутствия deadlock.

Event resulting denied revision2 применяется только к matching pair/grant с revision≤2; новый eligible grant revision3 его не принимает. Dispatch/ack/retry worker, retention/backpressure, private Chat authorization API, RTC grant/admission/proxy/SFU/browser audio в этот slice не входят. Committed event не означает media_teardown_complete; group audio остаётся выключенным. Позднейший private API обязан проверять fresh membership + retained state/revision и неизвестные значения отвергать.

## Проверки

Go1.25.8; пример unit gate:

```sh
GOTOOLCHAIN=go1.25.8 go test -race -cover ./...
```

Native authority cases помечены `integration` и требуют `AERO_CHAT_AUTHORITY_TEST_ENV_FILE` с профилем owned loopback PostgreSQL `aerochat_media_test:25432`. Тесты создают исключительно новые `rtc_chat_authority176_UUID` schemas: absence preflight, atomic CREATE, exact search_path, cleanup только собственных успешно созданных schemas. Команда в разрешённом runtime scope:

```sh
GOTOOLCHAIN=go1.25.8 go test -tags=integration -race -count=1 -timeout=120s -run '^TestGroupAuthority' ./internal/storage/postgres
```

В общий local workflow команды запускаются через shared `agent-dev` resource heavy, source фиксируется committed HEAD/receipt; значения fixture DSN не выводятся. Этот selector не запускает другие integration suites с чужими profiles/schema names и не переносит их старые результаты.

Migration/bootstrap повторяемые и additive. Rollback к старому binary на новой schema сохраняет trigger invariant; drop trigger/schema/events при active media недопустим. Возврат к source без authority schema допускается только при media off/no active grants, без удаления сохранённых pending events. Actual deployment, SFU/media и real-device/NAT/TURN/WAN проверки нужны отдельными этапами.
