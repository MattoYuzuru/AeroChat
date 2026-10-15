# Cutover encrypted server sequence

Контракт: [ADR-096](../adr/096-encrypted-conversation-server-sequence.md). Изменение задаёт порядок opaque operations внутри личной переписки или группы. Sender `created_at`, ciphertext/AAD и attachment links не переписываются. Историческое время принятия старых сообщений восстановить нельзя.

## Подготовка

Проверить backup/restore и согласовать maintenance window по [recovery prerequisite #169](https://github.com/MattoYuzuru/AeroChat/pull/204). Остановить все старые chat writers, включая native processes; смешанная запись старого и нового binary не поддерживается. Сам флаг CLI не проверяет остановку внешних процессов и наличие пригодного backup.

Применить additive migration `000023_encrypted_server_sequence.sql` штатным migration bootstrap. На fresh empty DB новый service сразу готов к writes. При существующих unassigned operations или invalid read metadata startup выполняет diagnostic с deadline 10 секунд и завершается до открытия listener. В результате первого запуска schema может быть обновлена, даже если listener не открылся; это не разрешение на обычный image rollback.

После остановки writers использовать отдельный защищённый вне-Git env profile с `AERO_DATABASE_URL`. CLI читает профиль как данные, без shell evaluation; secrets/URL/payload не выводятся. Запускать с Go версии проекта:

```bash
go run ./services/aero-chat/cmd/encrypted-sequence-backfill \
  --env-file /absolute/protected/sequence-maintenance.env \
  --batch-size 100 --conversations 10
```

По умолчанию это dry-run. Он выводит только counts и `ready`, не назначает sequence и не чинит read position. Выполнение требует явного операторского acknowledgement:

```bash
go run ./services/aero-chat/cmd/encrypted-sequence-backfill \
  --env-file /absolute/protected/sequence-maintenance.env \
  --execute --writers-stopped --batch-size 100 --conversations 10
```

`batch-size` — 1–1000 rows в одной conversation за запуск; `conversations` — 1–100 batches. Каждая transaction имеет deadline 20 секунд, invocation — 5 минут. Partial indexes ограничивают поиск unassigned rows; полный inventory/readiness всё ещё зависит от размера DB и не измерен на production history. Error/timeout не означает, что ранее завершённые conversation batches откатились.

## Повтор и проверка

Повторять execute до `ready=true`. Conversation row lock сериализует counter и одну batch; rollback/cancel не публикует partial batch, завершённые batches сохраняются. Legacy rows получают sequence в прежнем стабильном `(created_at,id)` порядке после maximum уже назначенной sequence; существующие positive sequences не меняются. После всех legacy rows conversation read metadata привязывается к target content sequence. Foreign/non-content target удаляется: API position становится null, unread может увеличиться. Missing target также отклоняется; текущие FK отдельно предотвращают dangling references.

Повторный dry-run должен показывать `conversations=0 candidates=0 migrated=0 ready=true`. Новый backend проверяет metadata снова перед listener. Проверить личную и групповую переписку: прочитать старое future-dated сообщение, затем отправить обычное и увидеть один unread; latest window должен содержать новый content. Sender clock остаётся только display metadata.

Обновить web вместе с backend: authoritative envelopes требуют positive decimal int64 `serverSequence`, read position — `lastReadServerSequence`. Client не может сравнивать такие строки через Number. Старый web продолжает decrypt с прежним AAD, но его порядок/read UI не считается исправленным. Browser cache ordering обновляется отдельным client slice; pending outbox/draft и crypto keys сохраняются. Backend-only PR не доказывает этот browser cutover.

## Ошибки и rollback

Duplicate message ID сохраняет обычный conflict: retry получает прежний stored envelope, новая sequence не коммитится. BIGINT exhaustion возвращает ошибку; wrap/zero не допускаются. Conversation writes и group thread/pin writes берут group row перед thread row, чтобы сохранять единый порядок locks при coexistence с legacy operations.

Откат старого backend вновь допускает client-clock ordering и записи без sequence. Не переключать image автоматически. Использовать reviewed roll-forward либо восстановление в отдельные пустые targets с последующей проверкой DB/S3, schema и client compatibility. Production нагрузка backfill, cross-host recovery и full encrypted history delivery этим slice не проверены.
