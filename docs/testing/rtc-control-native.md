# Native CI для RTC public-control adapter

Обычный Go gate не требует внешних процессов. Два файла
`public_control_auth_native*_test.go` помечены `integration`: их восемь top-level
сценариев требуют настоящего PostgreSQL, Identity main и Chat test host.
Отсутствующий профиль при выбранном integration scope является ошибкой.

Job `native-rtc-control` в CI использует собственный `postgres:17-alpine` и
dedicated `aerochat_rtc_test`. После exact checkout driver
`infra/scripts/check-rtc-control-native.py` проверяет clean source, собирает
Identity main и `go test -c` Chat host с `-buildvcs=true` вне checkout.
Фактические Go1.27.2/package/VCS/modified=false и binary SHA проверяются перед
запуском. Затем исполняются все восемь exact tests с `-tags=integration -race
-count=1`; missing/fail/skip, неверная provenance и неполный cleanup проваливают job.
Image build зависит от этого job.

Пример для заранее подготовленного собственного Linux/amd64 fixture:

```bash
python3 -B infra/scripts/check-rtc-control-native.py \
  --source-sha "$EXPECTED_SOURCE_SHA" \
  --output-dir "$RUNNER_TEMP/rtc-control-native"
```

`AERO_RTC_TEST_DATABASE_URL` задаётся через environment и не выводится.
Output directory должен быть новым и находиться вне source. Driver создаёт
private profile/registry с mode0600; каждый тест владеет новой `rtc_test_UUID`
schema, сертификатами, loopback listeners и native children. Registry требует
восемь fixture lifetimes, удаление восьми schemas и завершение шестнадцати children.
Existing local runtime, данные и credentials для этого job не используются.

Artifact содержит `result.json` с SHA, binary hashes, counters и результатом,
а также lifecycle Go events без текстового `Output`. Private database profiles,
TLS keys, test payload и binaries в artifact не входят. Каждый новый SHA требует
своего результата; Python negative fixtures проверяют parser, а не native runtime.

При раннем landing CI до появления adapter files job явно имеет
`not-applicable`: проверка наличия выполняется после checkout. При появлении
любого native файла driver требует полный комплект и все восемь сценариев.

Эта приёмка проверяет private authority и dormant public-control factory.
Public app/gateway её не подключают. Provider/token/SFU, admission proxy,
trusted media cleanup ACK и физическое group audio не проверяются и остаются
отдельными prerequisites по [ADR-097](../adr/097-group-media-trusted-authorization-contract.md).

GitHub service container и localhost-port contract следует
[официальной документации](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).
