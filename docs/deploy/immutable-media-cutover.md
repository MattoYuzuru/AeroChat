# Cutover staging/final attachments (#152)

Модель: [ADR-088](../adr/088-bounded-staging-and-immutable-media-finalization.md). Backend и web обновляются согласованно; это изменение upload transport и storage metadata, не crypto envelope.

## Новые вложения

Migration `aero-chat:000022_attachment_staging_finalization.sql` добавляет nullable staging key и независимую таблицу cleanup. Новый intent сначала резервирует logical quota в PostgreSQL, затем выдаёт POST policy с точным размером ciphertext, MIME, key и expiry. Браузер отправляет `form_fields` и последним поле `file`; multipart `Content-Type` выставляет браузер. PUT fallback отсутствует. CORS storage должен разрешать POST для точного browser origin.

Capability указывает только на `staging/<session_id>.bin`; `final/<attachment_id>.bin` доступен для записи только storage principal backend. Complete держит attachment→session row locks до conditional copy по ETag и commit metadata. Повторный Complete завершённой сессии не копирует staging снова. Ошибка или отмена не публикует pending attachment. Неопределённый commit не вызывает слепое удаление final: повторный запрос перечитывает authoritative metadata.

На старте `aero-chat` проверяет отключённое bucket versioning и staging lifecycle rule `aerochat-staging-expiry`: prefix `staging/`, expiration 1 day. Сервис добавляет своё правило, сохраняя чужие; существующее собственное правило с иными параметрами вызывает ошибку старта. Principal нужны bucket location/versioning/lifecycle read и lifecycle write, HEAD/GET/PUT/copy/delete объектов. Lifecycle — резервный предел, основной cleanup использует точные keys, без bucket listing.

Staging и final занимают до двух копий одного объекта; logical media quota не является physical disk quota и не ограничивает сетевую стоимость повторного POST. Backup и capacity plan учитывают обе копии. Независимые cleanup records сохраняются после завершения/удаления attachment и повторяют delete раз в час после expiry плюс 5 минут; retired final records покрывают поздний storage copy. Metadata purge пока не реализован: таблица растёт, это явное ограничение.

## Старые вложения

Старый pending PUT после cutover не завершается новым Complete; пользователь создаёт новый intent. Старые uploaded/attached mutable keys не получают download URL до переноса. Это видимая временная недоступность, а не утверждение, что старые байты проверены.

1. Остановить выдачу старых intents через совместимый rollout и дождаться `MAX(expires_at)` legacy сессий плюс 5 минут. Не запускать старый binary параллельно: он может создавать новые legacy capabilities.
2. Сделать schema-aware backup БД, bucket и соответствия attachment/session/object keys. Проверить, что версия bucket отключена и новый backend успешно проверил lifecycle.
3. Подготовить вне-Git файл с некавыченными `KEY=value`: `AERO_DATABASE_URL`, `AERO_MEDIA_S3_INTERNAL_ENDPOINT`, `AERO_MEDIA_S3_PRESIGN_ENDPOINT`, `AERO_MEDIA_S3_ACCESS_KEY`, `AERO_MEDIA_S3_SECRET_KEY`, `AERO_MEDIA_S3_BUCKET`; при TLS — соответствующие `*_SECURE=true`. CLI не исполняет shell и не поддерживает shell expansion/quoted dotenv. Права профиля ограничить владельцем.
4. Выполнить read-only dry-run:

   ```sh
   go -C services/aero-chat run ./cmd/attachment-backfill --env-file /absolute/private/media.env --limit 100
   ```

5. После проверки кандидатов и отдельного разрешения оператора выполнить тот же запуск с `--execute`. Команда ограничена 100 записями и 5 минутами; output содержит только execute/candidates/promoted. Она не применяет schema и не выводит secrets, keys или signed URLs. Повторять bounded batches до нуля кандидатов.

Перенос повторно читает статус под тем же lock, проверяет source metadata, выполняет conditional copy и публикует final mapping атомарно с независимой записью exact legacy key. Lifecycle timestamps сохраняются. При mismatch/ошибке backfill останавливается, legacy reads остаются заблокированы. Автоматического удаления неисправных исходников нет.

GC, Complete и backfill сериализованы. Детерминированный final key позволяет убрать обе копии при crash до смены legacy mapping. Exact legacy source остаётся в повторном cleanup после переноса; поздняя запись по нему не меняет final. Записи cleanup не удаляются без отдельной проверенной политики.

## Rollback и проверка

После первого POST/final record rollback на старый binary запрещён без compatible reader. Восстановление делается согласованной парой БД/objects и версиями schema/приложения. Этот PR не подтверждает production backup restore: проверка выполняется отдельно в #169.

Native integration tests требуют `AERO_MEDIA_TEST_ENV_FILE` вне Git. PostgreSQL fixtures принимают только loopback БД `aerochat_media_test`, создают/удаляют собственные `chat_test_<uuid>` schemas; S3 fixtures используют отдельный `aerochat-staging-152` bucket и случайные keys. Отсутствующая fixture — ошибка, не skip. Они проверяют admission, conditional copy, concurrent Complete, DB rollback/expiry и legacy cleanup. Browser decrypt для file/image/audio/video и device проверки фиксируются отдельной приёмкой; native green suite их не доказывает.
