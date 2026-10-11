# ADR-094: Known-good release, schema preflight и зашифрованное восстановление

- Статус: Proposed
- Дата: 2026-10-11
- Задача: [#169](https://github.com/MattoYuzuru/AeroChat/issues/169)
- Зависимость: ADR-090 / #164; уточняет recovery sections ADR-021, ADR-023 и ADR-028.

## Контекст

Возврат прежних application digests не возвращает автоматически PostgreSQL и S3 в прежнее состояние. Schema bootstrap применяет forward SQL до HTTP startup; изменённая или удалённая migration и несовместимое расширение схемы могут сделать старый бинарь непригодным. Текущий workflow сохраняет selection только после health, но не сохраняет самостоятельный recovery record до runtime mutation и не имеет проверенного согласованного data backup.

## Решение

### Release и schema boundary

До `pull`/`up` workflow сохраняет отдельный recovery record: previous release digest/source SHA, validated пять image digests и overlay, candidate SHA, текущий этап и schema comparison. Секреты и env целиком в record не копируются. Первый запуск имеет explicit `previous = null`: прежний working release не выдумывается.

Compose config и acquisition всех candidate images выполняются до замены runtime. Failure trap всегда сообщает stage и путь к record; failed attempt не обновляет known-good selection. Record для одного attempt не перезаписывает историю. Успешный rollout сохраняет новый selection только после revision/readiness gates. Automatic rollback и down migrations отсутствуют.

Preflight сравнивает SQL inventory предыдущего source SHA и candidate: ранее существующие файлы нельзя изменить/удалить. Отсутствие новых SQL означает отсутствие новых embedded migrations, но не доказывает всю behavioral compatibility. Добавление SQL требует reviewable compatibility declaration с точными SHA/inventory hashes, evidence и стратегией roll-forward; без неё workflow останавливается до runtime mutation. Declaration не исполняет SQL и не заменяет review. Для потенциально несовместимого изменения image rollback запрещён; нужна согласованная data recovery либо roll-forward. Старый бинарь после добавления nullable columns проверяется отдельным fixture, несовместимое изменение отклоняется preflight.

### Согласованный data backup

Оператор явно задаёт owned Compose project, exact PostgreSQL container/database, MinIO container и единственный named volume. Helper проверяет project labels и mount ownership; не принимает произвольные host directories. Source application writers, background cleanup и object-storage writers должны быть остановлены, а native/external writers исключены оператором. Helper не считает работающий `pg_dump` доказательством согласованности DB + S3.

После quiesce MinIO останавливается: это исключает lifecycle deletions во время снимка. PostgreSQL сохраняется через `pg_dump --format=custom --no-owner --no-acl`; S3 сохраняется физическим архивом остановленного volume, включая object metadata и lifecycle state. Backup manifest содержит SHA-256/size каждого payload, время quiesce/snapshot, DB major, exact MinIO image ID/source metadata, release selection и schema inventory. Redis presence/typing не входит в durable backup; роли, credentials, TLS и server env остаются отдельными operator secrets, не печатаются и не включаются в архив.

Готовый bundle шифруется официальным **age v1.3.2** для operator-owned recipient. Identity хранится отдельно, только в защищённом внешнем файле; key material не попадает в Git, argv или logs. Временные plaintext файлы создаются в приватном каталоге с mode 0700/0600 и удаляются в `finally`; отсутствие forensic восстановления удалённых bytes не обещается. Для production оператор выбирает защищённый scratch filesystem и off-host storage; текущая проверка только на disposable локальных данных. Final archive публикуется атомарно после успешного encryption, partial output не считается backup.

Официальные binary archives закрепляются SHA-256 из release asset metadata:

| Платформа | Archive | SHA-256 |
| --- | --- | --- |
| darwin/arm64 | `age-v1.3.2-darwin-arm64.tar.gz` | `e2020b073c44f692685a24d6abc378817eb81ffaaf49fd0531ef8565f767f2f5` |
| linux/amd64 | `age-v1.3.2-linux-amd64.tar.gz` | `cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10` |

Локальная установка ограничена `/Users/yuzuru/.local/state/agent-dev/aerochat-remediation-20261011/tools`; глобальные binaries не заменяются. age используется как готовый encryption format, собственный криптопротокол не вводится.

### Восстановление и regression drill

Restore выполняется только в явный **новый пустой** PostgreSQL database и **пустой owned** S3 volume отдельного Compose project. Source project и target project обязаны различаться. Helper отклоняет существующие user relations/objects, active target MinIO и несовпадающий storage image; не вызывает `--clean`, DROP, volume rm или prune. Restore не делает target live и не переключает production selection.

До мутаций проверяются age authentication, структура bounded manifest, все payload sizes/checksums, разрешённые archive member paths/types и отсутствие links/traversal. PostgreSQL восстанавливается `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`, только из trusted owned dump. S3 физический layout восстанавливается при остановленном target MinIO с тем же image ID; затем отдельный операторский startup и private S3 smoke подтверждают metadata/object bytes. Readiness не заменяет сравнение DB rows, migration checksums и object contents.

Локальный drill создаёт отдельные owned source/target fixtures, две синтетические DB rows и небольшие private objects; выполняет encrypted backup → decrypt/validate → restore → DB/S3 byte/hash comparison. Проверяет отказ неправильного identity, tampered payload, nonempty target, schema drift, отсутствующий compatibility declaration и stage failures с сохранённым previous record. Данные основного remediation stack и других проектов не копируются и не восстанавливаются.

Fixture измеряет длительность quiesce/backup/restore/smoke и наблюдаемый RPO=0 относительно завершённого quiesce; operational RPO равен возрасту последнего успешно проверенного snapshot. Цель для этого малого локального drill — RTO до 5 минут после начала restore, не production SLO. Production RPO/RTO должны быть назначены владельцем и проверены на реалистичном объёме до rollout.

## Последствия

Rollout получает durable recovery record и fail-closed schema policy. Согласованный snapshot требует maintenance window; физический S3 backup привязан к exact storage image/layout. Полный restore выполняется в отдельные пустые цели, а переключение на восстановленные данные требует самостоятельного разрешения и пользовательского smoke. Потеря operator age identity делает archive невосстановимым; ключ и encrypted archive должны иметь независимые копии и проверку доступности.

При текущем Proposed статусе ADR описывает план: backup/restore и migration drill ещё не выполнены. Никакой production rollout, SSH operation, реальных secrets или восстановления retained volumes в задачу не входит.

## Альтернативы

- Online S3 mirror: без versioned snapshot и остановки cleanup не даёт согласованного cross-store cut.
- Автоматические down migrations: отвергнуты, поскольку могут уничтожить данные и не являются обратным действием для произвольного forward SQL.
- Новая crypto abstraction: не нужна; используется существующий age CLI/format.

## Источники

- [age v1.3.2 release и официальные archives](https://github.com/FiloSottile/age/releases/tag/v1.3.2)
- [age CLI и recipients/identities](https://github.com/FiloSottile/age/tree/v1.3.2)
- [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)
- [PostgreSQL 17 pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)
