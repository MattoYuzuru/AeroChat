# Storage maintenance и provenance

Source images следуют [ADR-087](../../docs/adr/087-pinned-storage-source-build-lifecycle.md). Upstream MinIO/mc архивированы: собственная сборка и исправленные Go dependencies не означают возобновления upstream maintenance.

Сохраняются два исходных commit/archive pins. Effective `go.mod`/`go.sum` получают только reviewed fixed dependency floors и необходимые MVS constraints через штатные Go tooling в отдельной копии исходников. Исходный archive и его module hashes не меняются. Provider/auth/crypto поведение и generated upstream code не переписываются.

## Цепочка проверки

1. Проверить SHA-256 исходного archive и исходных `go.mod`/`go.sum`.
2. Проверить committed effective module overlay и соответствующий manifest; неполный overlay считается ошибкой.
3. Сканировать обе effective source closure для Linux/arm64 pinned govulncheck с фактическим maintained Go. Called findings, malformed evidence и package-loading failure отклоняют gate независимо от process exit code. Package/module-only candidates сохраняются отдельно; no-fixed findings не скрываются исключением пакета или ID.
4. Собрать оба targets из immutable sources и checked overlay с `-mod=readonly`, `GOTOOLCHAIN=local`. Зафиксировать actual Go и linked dependency versions извлечённых бинарников, binary/image/config SHA-256 и source checkpoint.
5. Проверить tiny private S3 CRUD/readiness на отдельном owned runtime. Проверка прочитанного lifecycle rule не доказывает истечение реального суточного TTL. Existing data и shared stack не использовать как disposable fixture.

Baseline assessment неизменённых sources на Go1.27.2/Linux-arm64 дала 38 called advisory IDs MinIO и 11 mc; это callgraph diagnosis, не доказанная эксплуатация. На exact f68 effective overlay прошёл actual source scans без called findings, отдельные cold builds и tiny private S3 runtime; подробности сохранены в [remediation](../../docs/audits/2026-10-11-remediation.md). Overlay включён в [candidate 13 октября](../../docs/audits/2026-10-13-integration-candidate.md). Свежие candidate provenance/parser tests не являются повторной сборкой, scan или runtime PASS. GO-2026-5932 остаётся module-only residual; ADR-087 license/operator decision остаётся Proposed.

## Источники внутри image

Image должен содержать original archive/license, effective module overlay, checksum manifest и build recipe, необходимые для реконструкции соответствующих исходников. OCI metadata различает upstream commit и AeroChat maintenance variant. Upstream release string внутри программы не заменяет actual compiler/dependency provenance.

Historical tags `aerochat-minio:7ced9663` и `aerochat-mc:7394ce0d` не перезаписываются maintenance сборкой. Новые variant tags связаны с effective manifest digest; image ID/digest фиксируется отдельно. Старый exact-image recovery receipt не переносится на новый compiler/dependency graph.

## Local ownership

Cold acquisition проверяется в новом owned BuildKit state с явным `--builder`, без смены global default, удаления cache/volumes или вмешательства в чужие builders. `--no-cache` на shared builder сам по себе не означает clean builder.

Тяжёлые проверки используют shared `heavy`; runtime mutations — отдельный exact project lock. Env, credentials, raw scanner logs и receipts остаются вне Git. Останавливаются только собственные fixture processes/containers; данные, архивы и builder state сохраняются до отдельного согласованного cleanup.

Effective overlay включает gRPC1.83.2 — fixed patch для GO-2026-6443 (missing authority/Host server panic). Overlay с1.83.2 прошёл source scan `check-lnvg9i0g`, отдельные cold builds и runtime09; результаты относятся к source f68, не к произвольной новой сборке. No-fixed GO-2026-5932 остаётся только module inventory неиспользуемого OpenPGP, без ID/package исключений.

В Storage Bootstrap CI `check-vulnerabilities.py` проверяет обе source closure для Linux/amd64 до cold image build. Компилятор и scanner берутся из общего `infra/go-toolchain.json`; parser и called-symbol threshold используются из application gate, без отдельной политики исключений. Archive/original module checks выполняются до effective overlay; scanner запускается readonly. Даже при ошибке первого компонента gate сохраняет результат второго и отклоняет общий результат. Raw scanner output и status загружаются как CI artifact при неуспехе тоже. Локальная Linux/arm64 проверка относится к другому target и фиксируется отдельно.

Проверки границ: `python3 -B infra/storage/test_maintenance.py`, `python3 -B infra/scripts/test_go_vuln.py`, `python3 -B infra/storage/test_vulnerabilities.py`. Они проверяют wrong archive/effective hashes/metadata, malformed scanner evidence, called finding при exit0, unsafe archive members, partial failure и изменения source/module files во время scan. Эти fixtures не заменяют actual source scan, image build или runtime smoke.
