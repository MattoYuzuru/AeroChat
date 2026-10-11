# ADR-096: Серверный порядок encrypted conversations и read position

- Статус: Accepted — координатор и frontend reviewer проверили contract до implementation
- Дата: 2026-10-11
- Задача: [#156](https://github.com/MattoYuzuru/AeroChat/issues/156)
- Уточняет ADR-060, ADR-066, ADR-070. Не меняет crypto/AAD или plaintext legacy lane.

## Контекст

Encrypted `created_at` поступает от sender и входит в additional authenticated data существующего ciphertext. SQL history/read/unread использует этот timestamp; future clock может поднять monotonic read watermark до 2099 и подавить следующий нормальный unread. `stored_at = max(serverNow, createdAt)` тоже наследует client clock. Простая замена `created_at` сломает authenticated envelope, а timestamp без сериализации не задаёт порядок concurrent commit.

Finding подтверждён code/SQL trace. Новый slice требует обычную owned PostgreSQL regression; guard-rejected audit script не переносится. Точное время принятия старых rows восстановить по этим двум timestamps невозможно.

## Решение

### Серверный порядок без изменения ciphertext

Для encrypted direct и group operations добавляется положительный `server_sequence` BIGINT, уникальный внутри conversation. Существующая row conversation (`direct_chats`/`groups`) содержит counter. Message transaction сначала блокирует её, увеличивает counter, сохраняет operation и deliveries, затем commit; следующая operation получает sequence только после завершения предыдущей transaction. Rollback не публикует sequence/operation. Это последовательность внутри conversation, не глобальный порядок между чатами.

Client `created_at` и AAD остаются побайтно прежними; это sender display metadata, не read/order authority. Новая additive migration снимает старое ограничение `stored_at >= created_at`; оно несовместимо с произвольным sender clock. Новые `stored_at` используют server clock без `max(clientCreatedAt)`, но порядок и read cutoff от wall clock не зависят. Повтор существующего message ID сохраняет прежнюю sequence: существующий duplicate-ID conflict остаётся, retry читает stored envelope. Новая logical operation для этого ID не создаётся. BIGINT overflow — явная ошибка, без wrap.

Envelope, send/fetch/list и realtime несут `server_sequence`; read position — `last_read_server_sequence`. Proto int64 JSON передаётся decimal string; web не преобразует его в Number. Unread учитывает только чужие content operations с sequence выше viewer watermark. Read update продвигается по sequence, после проверки membership и принадлежности target message conversation. `created_at` read metadata сохраняется для совместимости display, но не участвует в SQL cutoff.

Bounded latest history и replay opaque operations сортируются по server sequence. Local content projection сохраняет origin content sequence при edit/tombstone; mutation не переставляет message в истории. Peer read indicator сравнивает content sequence и peer watermark. Optimistic local operation без authoritative sequence отдельно ожидает send result; она не создаёт durable read cutoff. Per-conversation sequences нельзя сравнивать глобально в cross-conversation search.

### Совместимость и восстановление существующих данных

Schema migration добавляет nullable sequence, counter с default zero и index; она не выполняет полный data rewrite на старте. Fresh empty database сразу пригодна для новых writes. Если есть legacy encrypted rows без sequence, новый chat service завершается до открытия listener до opt-in backfill; diagnostic failure называет необходимость migration без payload/endpoint/credentials. Старые binaries при cutover должны быть остановлены: они не умеют назначать sequence. Совместная запись старого и нового binary не поддерживается.

Отдельный backfill CLI с dry-run по умолчанию и explicit execute:

1. Работает на явно заданном env profile, после verified backup/restore по #169 и остановки writers. Не выполняется автоматически при deployment.
2. В bounded batches, под conversation row lock, назначает оставшимся legacy operations возрастающие sequences в стабильном старом порядке `(created_at, message_id)`. Существующие sequences не меняет, counter и batch commit атомарны; retry после crash продолжает со следующей unassigned row. Один conversation за transaction, bounded context, без parallel fanout.
3. После завершения conversation связывает старые read positions с sequence их target content message. Missing/foreign/non-content target не сохраняет future cutoff: invalid read row удаляется, API возвращает null position, логический watermark снова zero; сообщения могут повторно стать unread. Валидная непустая position всегда содержит положительную sequence. Ciphertext, AAD, message IDs и attachment links не переписываются.
4. Перед запуском нового service проверяет отсутствие unassigned rows, counter не ниже maximum sequence, uniqueness и соответствие read position target. Actual историческое время принятия не объявляется восстановленным: backfill сохраняет стабильный прежний порядок, после него новый content всегда идёт дальше по sequence.

Backfill — maintenance operation: нагрузка ограничивается batch size и одной transaction, но время на большой production history в этом PR не измерено. Сначала owned disposable fixture с interruption/retry и read repair. Сам факт наличия backup не считается rollback proof.

Новый web требует server sequence на authoritative rows; отсутствие/некорректная строка не нормализуется молча в zero ordering. Existing localOutbound возникает после send result и сразу получает реальную sequence; новая zero-sequence optimistic row не вводится. Cache schema/version или явный rebuild обновляет старую projection после backfill; сравнения только entity `updated_at` недостаточно, поскольку backfill его не обязан менять. Pending outbox/draft и local crypto keys не удаляются. Старый web сохраняет возможность decrypt благодаря неизменному AAD, но его ordering/read UI не считается исправленным; cutover включает обновление web. Rollback старого backend может вернуть client-clock defect и требует отдельного reviewed backup/schema plan, не обычного переключения image.

## Проверка

- Before/after: future/backdated/equal sender timestamps, direct и group, read старого future message → следующий нормальный content unread=1 и существующий notification gate срабатывает.
- PostgreSQL: две connections, pause первой transaction после reservation; вторая не публикуется раньше. Rollback не создаёт phantom operation; bounded latest window определяется server sequence.
- Backfill: legacy future watermark, batches/retry, missing target, interruption, idempotent repeat; ciphertext/AAD bytes и IDs сохранены, затем normal new write/read работает.
- Web: sequence выше 2^53, skewed clocks, edit/tombstone не меняют origin order, realtime/reload/send-result convergence и peer read comparison. Full encrypted history backfill/offline и общий crypto protocol этим не доказываются.

## Последствия и альтернативы

Conversation writes сериализуются на существующей row; throughput каждого conversation ограничен transaction duration. Новый внешний сервис, crypto protocol или plaintext projection не вводятся. Sequence gaps не имеют product значения.

Отклонены: clamp `created_at` (ломает AAD), только `stored_at` (ties/clock/commit inversion и mutation reorder), общий глобальный sequence без commit serialization (поздний commit может оказаться ниже прочитанного watermark), автоматический полный backfill в startup migration (неограниченная maintenance нагрузка).
