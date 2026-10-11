# ADR-088: Ограниченный staging upload и неизменяемый final attachment

- Статус: Accepted — независимый review lock/cleanup/legacy model выполнен 2026-10-11
- Дата: 2026-10-11
- Задача: [#152](https://github.com/MattoYuzuru/AeroChat/issues/152)
- Уточняет ADR-035, ADR-048, ADR-049, ADR-065 и ADR-073.

## Контекст

Действующий presigned PUT можно повторять до expiry. Проверка размера в Complete не ограничивает первоначальную запись и не защищает уже привязанный объект от замены. Дополнительный Stat перед GET также оставляет race. Решение не меняет crypto envelope или правила доступа к chat; backend работает с ciphertext как с непрозрачными байтами.

## Решение

### Admission и два namespace

Новые intents используют S3 POST policy: exact bucket/key, exact MIME, `content-length-range` с одинаковыми lower/upper bounds по нормализованному `size_bytes` и короткий expiry. Capability выдаётся только после успешной quota reservation в PostgreSQL. Form fields возвращаются отдельным protobuf-полем; `headers` сохраняет своё HTTP-значение. Браузер отправляет поля и последним file через FormData, не устанавливая multipart Content-Type вручную. Старый неограниченный PUT не остаётся fallback.

`attachment.object_key` с момента reservation означает backend-only final key. `attachment_upload_session.staging_object_key` — отдельный случайный key под `staging/`, единственный namespace browser upload. Клиент никогда не получает write capability на final key. Для staging bucket versioning не включается: replay заменяет staging объект, а не создаёт неограниченный набор сохранённых версий.

### Finalization и конкуренция

Complete открывает явную scoped repository transaction, блокирующую attachment и upload session до завершения. Domain получает locked records и повторяет owner, status и expiry checks. Repository transaction не выполняет сетевые запросы или domain validation самостоятельно.

Domain проверяет размер/MIME staging snapshot и вызывает backend copy на final key с условием source ETag. Если staging изменился между проверкой и copy, storage отклоняет promotion. Copy атомарно читает согласованный source; последующее изменение staging не меняет final. При совпадающем ETag MIME final задаётся из проверенной metadata, а не из повторно изменяемого staging. Final snapshot дополнительно проверяется перед commit как validation результата copy; неизменяемость обеспечивается namespace и conditional promotion, а не этой проверкой.

Locked pending state сериализует два Complete. После первого commit второй видит uploaded/completed и не выполняет copy. `uploaded` публикуется только после успешного promotion и atomic DB completion. Expiry перепроверяется перед commit по текущим server clocks. Transaction/network имеют bounded context; процесс или соединение, умершее до commit, освобождает DB locks. Неопределённый результат commit не разрешает удалять final вслепую: повторное чтение определяет опубликованное состояние.

Final key заранее записан в metadata. Если процесс умер после copy, но до DB commit, attachment остаётся pending и cleanup знает оба exact keys. Retry может повторить promotion только под тем же lock и только до публикации uploaded. Все Complete/expiry/cleanup/attach/detach операции блокируют attachment перед upload session; `SKIP LOCKED` исключает удаление объекта, пока Complete держит transaction. Cleanup не переводит pending в deleted без завершения expiry transition.

### Staging cleanup и отдача

Staging нельзя удалять один раз сразу после Complete: живая capability может создать его снова. Независимая cleanup запись хранит exact source key, capability expiry, next attempt и purge deadline; она переживает completion и deletion final attachment. Metadata cleanup после expiry повторяет удаления независимо от состояния final attachment, включая deleted и attached. Запись удаляется только после expiry/grace и подтверждённой bucket lifecycle policy; одно успешное DeleteObject не разрешает её преждевременное удаление. Дополнительная bucket lifecycle policy на prefix `staging/` — страховка для поздно завершившейся записи или аварии cleanup, без listing как quota source of truth. До проверки этой policy на disposable storage cleanup не считается завершённым.

Final и staging занимают до двух копий разрешённого payload во время promotion/expiry grace. Это временная физическая стоимость; logical quota продолжает считать одно attachment. POST policy ограничивает каждую запись размером reservation, но сам по себе не является глобальным disk quota или rate limit. Нужны метрики свободного места, bounded cleanup и наблюдаемая проверка recovery. Delete/detach/retention из ADR-073 распространяются на final и известный staging key.

Download подписывает только final key и задаёт безопасные response Content-Type/Content-Disposition. Ciphertext отдаётся как octet-stream; пользовательские имена не становятся object paths или произвольными response headers.

## Миграция и rollout

1. Additive schema migration добавляет nullable staging key и cleanup metadata; старый reader работает до переключения, но migration сама по себе не делает старые файлы immutable.
2. Backend и web выкатываются согласованно: новые intents — POST, новые final keys. Старые pending PUT intents после cutover отклоняются/expire, не конвертируются в безопасные capabilities. Это видимая повторная загрузка, draft сохраняется.
3. Существующие uploaded/attached keys считаются legacy до bounded backfill: после максимального старого intent TTL выполнить conditional copy на новый final key, проверить размер/MIME и atomic metadata update под row lock. Exact legacy source key сохраняется в независимой cleanup записи после обновления object_key. Начатый до expiry PUT может завершиться после backfill, поэтому повторные удаления и проверенная lifecycle policy старого namespace обязательны до purge записи. При mismatch сохранять evidence и возвращать явную недоступность; не помечать повреждённые байты проверенными. Backfill выполняется отдельным opt-in инструментом с dry-run и receipts, без автоматического destructive rewrite.
4. Cutover не допускает indefinite legacy reads по mutable key. До backfill старые файлы имеют явный unvalidated status/ошибку. Время старого TTL и состояние migration проверяются на source-backed fixture.
5. Rollback старого binary после появления новых POST/final records запрещён без compatible reader. Backup включает schema/version и mapping обоих namespace; восстановление проверяется вместе с metadata и objects.
6. Cleanup финального объекта, Complete и backfill используют один attachment→session lock до окончания storage IO/metadata commit. Eligibility повторно читается под lock. Детерминированный `final/<attachment_id>.bin` зарезервирован и для legacy записи: при crash backfill до смены mapping cleanup знает обе копии. Перенос не сбрасывает lifecycle timestamps. После удаления metadata статус сохраняется, а независимые повторные cleanup записи охватывают staging, exact legacy source и retired final key: поздно завершившийся storage copy также удаляется. Purge этих записей пока не реализован; их рост нужно учитывать отдельно от logical media quota.

## Наблюдаемая приёмка

- Собственный 1-byte intent отвергает 2-byte upload на storage admission; MIME mutation отвергается policy.
- Replay staging до/после Complete не меняет bytes final attachment; два concurrent Complete публикуют один validated final, loser не копирует поверх него.
- Изменение staging между Stat и conditional copy не публикует uploaded.
- Expiry, failed copy, cancelled request, DB rollback/неопределённый commit и crash между copy/commit не оставляют доступный непроверенный final.
- Cleanup повторной staging записи, final retention и legacy cutover/backfill, включая PUT, завершившийся после backfill, подтверждены на disposable PostgreSQL/S3; unit fakes этого не доказывают.
- Browser upload/decrypt для file/image/audio/video, abort/error/draft и header поведение проверены отдельно.

## Последствия и альтернативы

POST меняет upload transport, требует coordinated client rollout и CORS разрешения POST. Длительный storage copy удерживает row lock; upper timeout и размер файла ограничивают этот интервал. Legacy migration обязательна, иначе весь существующий media contract безопасным объявлять нельзя.

Signed Content-Length PUT не выбран без независимой browser/S3 проверки forbidden-header и streaming semantics. Пиннинг source version без promotion оставляет replay-created versions и усложняет physical quota. Backend binary proxy меняет ADR-036 и создаёт ненужную нагрузку application edge. Повторный Stat перед GET не устраняет race.

## Источники

- [S3 presigned URL replay/replacement](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [minio-go POST policy и presign](https://github.com/minio/minio-go/blob/v7.0.99/api-presigned.go)
- [minio-go conditional copy](https://github.com/minio/minio-go/blob/v7.0.99/api-compose-object.go)

Независимый architecture review подтвердил staging/final и conditional promotion; замечания о legacy source cleanup, сроке жизни cleanup metadata и едином lock order включены в решение. Accepted фиксирует модель, а не готовность реализации: код и evidence идут узкими PR в рамках #152.
