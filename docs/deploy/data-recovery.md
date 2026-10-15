# Known-good state, schema policy и data recovery

Контракт: [ADR-094](../adr/094-known-good-release-and-encrypted-recovery.md). Recovery tools не выполняют deploy, down migrations, DROP или удаление volumes. Production target/maintenance window/переключение данных требуют отдельного операторского решения; локальные checks выполняются только на новых disposable targets.

## Rollout preflight и stage failures

Перед автоматическим rollout `.env.server` должен содержать полный known-good `AERO_RELEASE_DIGEST` + `AERO_RELEASE_SOURCE_SHA`, а `release-<previous SHA>.json` — validated metadata всех пяти images. Previous source commit должен присутствовать в Git object database; workflow не выполняет remote checkout/fetch за оператора. Unknown/partial selection блокирует automation независимо от возраста durable data. Первый запуск выполняется вручную по verified release flow только на доказанно пустых DB/S3 целях; после actual revision/readiness/user smoke оператор устанавливает explicit known-good baseline. Нельзя выводить emptiness из отсутствующего env key.

`release_recovery.py begin` создаёт уникальный mode-0700 каталог `.release-recovery/<attempt>/`: `record.json` и `previous-compose.json`. Record не копирует secrets/env, фиксирует previous/candidate releases и schema inventories. SQL hashes из предыдущего source сравниваются с **actual** `schema_migrations` PostgreSQL: missing/extra/checksum drift требуют operator baseline review. Existing SQL нельзя изменить/удалить.

Для добавленных SQL рядом с env нужен `release-compatibility.json` со следующей exact schema (SHA/hash значения относятся к конкретной паре release, не wildcard):

```json
{
  "schema_version": 1,
  "previous_sha": "<40 hex>",
  "candidate_sha": "<40 hex>",
  "previous_inventory_sha256": "<64 hex>",
  "candidate_inventory_sha256": "<64 hex>",
  "image_rollback_compatible": true,
  "review": "<review URL или operator decision>",
  "evidence": "<old-binary/new-schema regression receipt>",
  "roll_forward": "<конкретный forward recovery plan>"
}
```

Inventory hash вычисляет `release_recovery.inventory_digest(release_recovery.inventory(SHA))`; declaration — review record, не автоматическое доказательство совместимости. `image_rollback_compatible=false`, несовпадающие SHA/hashes и пустые evidence отклоняются. Для несовместимых миграций нужен отдельно согласованный migration/data recovery plan.

| Failed stage | Действия |
| --- | --- |
| preflight | Runtime не менялся. Сверить previous manifest/Git/applied schema; не подменять baseline candidate. |
| config / pull | Runtime не менялся. Исправить env/config/acquisition; previous record сохранён. |
| runtime / health | Остановить writers и оценить applied schema. При подтверждённой совместимости использовать saved previous overlay и тот же image/readiness smoke; иначе roll-forward или отдельный empty-target restore. |
| selection | Runtime прошёл health, но selection persistence не завершилось. Сверить running digests/source SHA с record; atomic env write не сохраняет половину пары. |

Env selection меняется атомарно только после health/revision gates. На failure record содержит stage, previous overlay остаётся отдельным файлом. Trap не возвращает старые digests автоматически: schema могла уже измениться. Compose/MinIO config, root env, TURN/shared edge и другие mutable external settings не входят в application release manifest и не откатываются по нему. Их diff/compatibility и отдельные секретные копии проверяет оператор до rollout.

## Backup

Установить age **1.3.2** из checksum-pinned official archive в owned tools prefix:

```bash
python3 infra/scripts/install-age.py --prefix /absolute/owned/tools/age-1.3.2
```

Версии/checksums и primary docs — в ADR-094. `age-keygen --output /protected/external/identity.txt` создаёт operator identity; public recipient помещается в отдельный recipients file. Private identity хранить отдельно от encrypted archive, с независимой резервной копией. Ни key material, ни содержимое credential files не выводить в logs.

Предварительно остановить **все** application writers и cleanup workers своего project, исключить native/external writers. Backup helper проверяет running Compose containers, но operator flag не доказывает отсутствие внешних клиентов. Указать exact owned postgres/minio container names и DB; MinIO обязан иметь ровно один owned named volume `/data`. Нельзя передавать основной retained fixture вместо disposable source.

```bash
python3 infra/scripts/data_recovery.py backup \
  --project <owned-source-project> --postgres <source-postgres> \
  --database <source-db> --user <source-db-user> --minio <source-minio> \
  --release <validated-release-json> --release-digest sha256:<release-digest> \
  --namespace ghcr.io/<owner> --writers-quiesced \
  --age /absolute/owned/tools/age-1.3.2/age \
  --recipients /protected/external/recipients.txt \
  --archive /protected/external/new-snapshot.tar.age --scratch /protected/scratch
```

Helper останавливает source MinIO на время snapshot и возвращает его в первоначально running state в `finally`; application writers сам не запускает. PostgreSQL custom dump и физический S3 volume tar попадают в один age-encrypted bundle с manifest/checksums. Archive содержит **sensitive MinIO internal IAM/config state**, включая service-account material; внешние root env/TLS/operator identity не копируются. Scratch directories имеют 0700, files 0600 и удаляются после операции; secure erasure bytes не обещается. Failed encryption не публикует final archive; outputs не перезаписываются.

Helper ограничивает каждый payload 16 GiB и storage tar 100 000 members; больший dataset требует отдельно проверенного изменения bounds/strategy. PostgreSQL cluster roles не входят в dump. Для межхостового восстановления заранее сохранить exact MinIO image как trusted Docker archive/digest вместе с encrypted backup: physical layout restore требует тот же image ID и platform, source rebuild не обещает тот же ID. Application images должны оставаться доступными по saved digests. Image/keys/off-host archive availability входят в operator recovery drill; локальный fixture не доказывает их доступность на новом host.

## Restore

Подготовить **другой** owned Compose project, PostgreSQL того же major с новым пустым DB и пустой named storage volume. Target MinIO container создать с exact source image, но **не запускать** до restore. Новая `public` schema допустима; пользовательские relations — причина отказа. Source project и target project различаются. Credentials/env готовятся отдельно вне Git и должны подходить восстановленному IAM state.

```bash
python3 infra/scripts/data_recovery.py restore \
  --project <owned-empty-target-project> --postgres <target-postgres> \
  --database <empty-target-db> --user <target-db-user> --minio <stopped-target-minio> \
  --namespace ghcr.io/<owner> --age /absolute/owned/tools/age-1.3.2/age \
  --identity /protected/external/identity.txt \
  --archive /protected/external/snapshot.tar.age --scratch /protected/scratch
```

До первой записи проверяются decrypt authentication, bounded manifest/payload inventory, SHA-256/size, tar traversal/duplicates/links/device guards, owner labels, image/DB major, пустота DB и volume. `pg_restore` применяет dump в одной transaction с exit-on-error, без clean/create/drop; затем S3 tar копируется в остановленный target. Target не становится live автоматически. Если PG restore успешен, а S3 copy оборвался, target считается частичным: не переключать traffic и не повторять поверх него, сохранить evidence и подготовить новую пустую цель отдельно.

После явного startup проверить private S3 доступ intended identities, policies/lifecycle state, object bytes/hashes, DB rows/migration checksums и actual application smoke. Только после этого отдельное операторское решение может переключить deployment на новые данные.

## RPO/RTO и доказательства

RPO для согласованного quiesced fixture — ноль относительно завершённого quiesce; operational RPO равен возрасту последнего успешно проверенного snapshot. RTO измеряется от начала restore до сравнения DB/S3 и intended-access smoke, отдельно от backup downtime. Малый локальный fixture использует target до 5 минут; это не production SLO. Production owner назначает RPO/RTO, cadence, archive retention/off-host копии и повторяет drill на реалистичном объёме. Пока final receipt отсутствует, restore/old-binary compatibility считаются **непроверенными**.
