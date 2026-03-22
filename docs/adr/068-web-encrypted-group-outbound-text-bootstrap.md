# ADR-068: Web encrypted group outbound text bootstrap

- Статус: Accepted
- Дата: 2026-03-22

## Контекст

После `ADR-057`, `ADR-065`, `ADR-066` и `ADR-067` в репозитории уже существуют:

- web crypto runtime с worker boundary и persistent local crypto-device material;
- backend encrypted group control-plane с `mls_group_id`, `roster_version` и materialized readable roster;
- `SendEncryptedGroupMessage` в `aero-chat` и device-aware realtime family `encrypted_group_message_v1.delivery`;
- web local projection для encrypted group lane с decrypt/render только внутри crypto runtime;
- legacy plaintext group thread, который продолжает жить отдельно;
- отсутствие реального outbound send path для encrypted group text на web.

При этом уже зафиксированы важные ограничения:

- encrypted group lane ещё не объявляется полноценным MLS client implementation;
- нельзя возвращать серверу plaintext projection и нельзя делать dual-write plaintext+ciphertext;
- encrypted group media send, reply/edit/search/unread parity и backup/recovery пока не реализованы;
- coexistence с legacy plaintext groups должна оставаться явной, а не магической.

Нужен следующий узкий implementation slice, который:

- впервые даст web-клиенту реальный outbound encrypted group text send;
- сохранит сборку ciphertext внутри crypto runtime boundary;
- reuse'ит уже существующий backend bootstrap/storage/realtime path;
- не раздует PR до media send, unified timeline или full MLS UX.

## Решение

### 1. Web получает отдельный outbound path только для encrypted group text

В `apps/web` вводится первый bounded send path только для text-only encrypted group messages.

Этот path:

- не использует legacy plaintext `SendGroupTextMessage`;
- не пишет plaintext shadow row для того же logical encrypted message;
- не притворяется завершённым unified composer для всех group features.

На этом этапе encrypted outbound path поддерживает только:

- `operation_kind = content`;
- text body;
- `markdown_policy = safe_subset_v1`.

### 2. Сборка outbound payload остаётся внутри crypto runtime boundary

React/UI state не собирает ciphertext и не вычисляет per-device payload.

Поток данных фиксируется так:

1. Group page инициирует bounded action `send encrypted text`.
2. Crypto runtime worker сам читает минимальный encrypted group bootstrap через существующий backend contract.
3. Worker валидирует текущий local active `crypto_device_id`, `mls_group_id` и `roster_version`.
4. Worker собирает versioned payload schema и group-scoped ciphertext.
5. Worker вызывает `SendEncryptedGroupMessage`.
6. UI получает только stored envelope metadata и локальную decrypted optimistic projection.

Private key material и actual encryption logic не выходят за пределы runtime boundary.

### 3. Для outbound bootstrap сохраняется честный bootstrap multi-recipient codec

Этот PR по-прежнему **не** объявляет реализованным полный MLS client state / commit engine.

Поэтому outbound send использует тот же честно задокументированный bootstrap codec, что и local projection:

- один group-scoped ciphertext blob;
- versioned transport envelope;
- per-recipient wrapped content keys для eligible `crypto_device_id` из текущего roster;
- расшифровка остаётся device-local.

Ограничения фиксируются явно:

- это не называется “полной MLS реализацией”;
- commit recovery, epoch reconciliation, add/remove UX и state migration остаются later slice;
- выбранный bootstrap codec должен оставаться совместимым с `ADR-066` и не превращаться в скрытый custom group protocol.

### 4. Для send используется только минимальный уже существующий bootstrap surface

Новая отдельная roster-discovery архитектура не вводится.

Runtime использует только уже существующий encrypted group bootstrap:

- `GetEncryptedGroupBootstrap` как минимальный control-plane source для `mls_group_id`, `roster_version` и roster devices;
- `SendEncryptedGroupMessage` как opaque intake/storage path;
- `ListEncryptedGroupMessages` и realtime family `encrypted_group_message_v1.delivery` как authoritative convergence path после send.

Тем самым web runtime получает только тот минимум server-visible bootstrap state,
который нужен для корректной сборки outbound ciphertext.

### 5. Local optimistic behavior остаётся bounded и server-backed

После успешного send web может показать bounded optimistic projection нового encrypted group message.

Эта optimistic projection:

- живёт только в локальной памяти;
- не становится source of truth;
- вытесняется при появлении authoritative storage/realtime envelope с тем же `message_id` и `revision`;
- не создаёт duplicate rendering для одного logical encrypted message.

Reconciliation фиксируется явно через локальный outbound buffer и discard при получении server-backed копии.

### 6. UI integration остаётся минимальной и отдельной от legacy plaintext composer

`GroupsPage` получает только bounded encrypted-send action/path:

- отдельный text-only encrypted composer внутри секции encrypted lane;
- явный disabled/error state, если local crypto runtime или encrypted bootstrap недоступны;
- честные сообщения о том, что attachment/reply/edit/media parity пока не подключены.

Этот PR сознательно не:

- redesign'ит `GroupsPage`;
- не смешивает legacy plaintext composer и encrypted composer в одну “идеальную” форму;
- не пытается скрыть product gap между legacy и encrypted lane.

### 7. Coexistence с legacy plaintext groups остаётся явной

После этого PR:

- legacy plaintext group history остаётся без изменений;
- encrypted lane продолжает жить отдельной client-decrypted секцией;
- encrypted outbound message не dual-write'ится в plaintext timeline;
- unified perfect timeline по-прежнему не объявляется реализованным.

Если в группе существуют оба path, это остаётся видимым и честным UX boundary.

### 8. ADR-065 остаётся обязательной future-ready foundation

Этот PR не внедряет encrypted group media send,
но outbound text bootstrap обязан сохранить совместимость с `ADR-065`.

Следствия:

- новый group payload schema не вводит direct-only assumptions;
- будущий encrypted attachment descriptor может быть добавлен в group payload без смены storage relay architecture;
- group media later reuse'ит тот же ciphertext relay, quota, retention и lifecycle contract.

### 9. Honest boundary

Этот PR **решает только**:

- web outbound bootstrap send для encrypted group text;
- runtime-side payload assembly;
- thin UI integration;
- bounded optimistic merge с server-backed reconciliation.

Этот PR **не решает**:

- encrypted group media send;
- encrypted reply/edit/pin/search/unread parity;
- full MLS client state / commit engine completeness;
- backup/recovery;
- RTC;
- push/PWA;
- malicious origin threat.

## Последствия

### Положительные

- Web encrypted group lane становится двусторонним: не только fetch/decrypt, но и реальный outbound send.
- Crypto runtime boundary становится реальной send boundary и для groups.
- Existing backend encrypted group storage/realtime foundation начинает использоваться end-to-end.
- Local optimistic behavior остаётся узким и честно подчинённым server-backed convergence.

### Отрицательные

- Во фронтенде появляется ещё один bounded send path рядом с legacy plaintext group composer.
- Mixed-mode UX группы временно становится ещё более явным.
- Bootstrap codec по-прежнему остаётся промежуточной ступенью до richer MLS client state.

### Ограничения

- Encrypted composer в этом slice остаётся text-only.
- Legacy plaintext group thread не считается автоматически устаревшим или скрытым.
- Runtime должен явно сообщать о недоступности encrypted send вместо небезопасного fallback в plaintext send.

## Альтернативы

### 1. Переключить текущий group composer на encrypted send без отдельного path

Не выбрано, потому что тогда PR смешал бы encrypted bootstrap с legacy attachment/reply/edit semantics
и создал бы нечестный UX around unsupported features.

### 2. Собирать group payload в обычном UI state и только отправлять из runtime

Не выбрано, потому что это размывает crypto runtime boundary
и снова выводит message assembly из worker-owned path.

### 3. Ждать полного MLS client engine и не делать outbound bootstrap сейчас

Не выбрано, потому что тогда уже реализованные backend control-plane/storage/realtime foundations
оставались бы без реального web send consumption
и следующий PR снова решал бы слишком много задач одновременно.
