# React Router: обслуживание 7.x и применимость advisory

## Статус и границы

Подготовка для [#175](https://github.com/MattoYuzuru/AeroChat/issues/175) на
родительском HEAD `308f33316998749734d2102f82a84afa918de614`. Кандидат —
`react-router-dom` 7.18.4 и согласованный transitive `react-router`; official
[v7 changelog](https://raw.githubusercontent.com/remix-run/react-router/v7/CHANGELOG.md)
датирует этот patch 15 сентября 2026. Это обновление существующего BrowserRouter
SPA, без перехода на 8.x, Data/Framework Mode или SSR/RSC.

Registry version/integrity, обновление lockfile через pnpm10.19.0, полный список
исходных advisory и финальные проверки ещё pending. Этот документ пока не
доказывает успешное обновление, отсутствие применимых high advisory или готовность
маршрутизации. Исходный аудит содержит 12 advisory для lockfile 7.13.1
(6 high, 5 moderate, 1 low); severity counts не равны 12 доказанным уязвимостям
AeroChat.

## Применимость по текущему коду

[`AppRouter`](../../apps/web/src/app/AppRouter.tsx) использует BrowserRouter и
Routes/Route: это [Declarative Mode](https://reactrouter.com/7.18.4/start/modes).
[`web nginx`](../../apps/web/nginx.conf) отдаёт статические файлы и SPA fallback
`/index.html`; в этом пути нет React Router server runtime, RSC transport или
`__manifest` endpoint. Из этого следует неприменимость описанных ниже
Framework-only предпосылок, а не результат проверки эксплуатацией.

| Advisory | Предпосылки primary source | Trace AeroChat и статус |
| --- | --- | --- |
| [GHSA-49rj-9fvp-4h2h](https://github.com/remix-run/react-router/security/advisories/GHSA-49rj-9fvp-4h2h) | Framework Mode и уже существующая prototype pollution; исправлено с 7.14.2. Primary source прямо исключает Declarative/Data Mode. | Framework server entry отсутствует; RCE path неприменим к текущему BrowserRouter SPA. Это не claim об отсутствии всех prototype pollution в приложении. |
| [GHSA-chx6-hx7r-mcp5](https://github.com/remix-run/react-router/security/advisories/GHSA-chx6-hx7r-mcp5) | Неаутентифицированные запросы к Framework `__manifest`; исправлено с 7.18.0. Primary source исключает Declarative/Data Mode. | Static nginx не реализует Framework endpoint; описанный server DoS path неприменим. Нагрузочная проверка не выполнялась. |
| [GHSA-wrjc-x8rr-h8h6](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6) | Attacker-supplied paths в navigation; исправлено с 7.18.0. | Условно применимая client navigation surface: localStorage recent `routePath` принимается как строка и передаётся в `navigate`. Для attacker control нужна отдельная возможность записать это localStorage. Удалённый вход из server content в этот path не найден; удалённый exploit не воспроизведён. |

Обычные pathname строятся из фиксированных `/app/...`, а conversation/person IDs
проходят URLSearchParams в [`app-routes`](../../apps/web/src/app/app-routes.tsx).
Это не позволяет query ID изменить origin или pathname. Но
[`normalizeStartMenuRecentItem`](../../apps/web/src/shell/start-menu.ts)
сохраняет строковый localStorage `routePath`,
`resolveStartMenuRecentItemRoutePath` возвращает его, а Desktop/Mobile launcher
передаёт в navigation. Поэтому client navigation advisory нельзя назвать
безусловно неприменимой. Scope обновления не включает новую route sanitization
policy или расширение trust boundary.

Остальные исходные advisory должны быть перечислены отдельно после получения
свежего production audit JSON с primary references. Общий patch floor не
заменяет такой список.

## Требуемая проверка обновления

- Проверить registry metadata/version/integrity выбранных согласованных 7.x
  packages до install; обновлять lockfile только pnpm10.19.0.
- Сохранить исходный и новый `pnpm audit --prod --json` вне Git. Проверить все
  записи отдельно; unresolved applicable high не допускается.
- Выполнить unit tests, lint, app/node typecheck и production build на frozen
  exact HEAD, записать skipped checks и версии инструментов.
- Проверить в owned browser fixture настоящие AppRouter/DesktopShell:
  deep-link/refresh, back/forward, повторное открытие route-backed singleton,
  protected anonymous redirect и authenticated login redirect, query IDs с
  зарезервированными символами через URLSearchParams.
- Synthetic auth/gateway fixture не заменяет actual backend login, crypto или
  реальную двухаккаунтную приёмку. Публикация отдельного PR требует завершённых
  gates и опубликованного prerequisite #173; issue остаётся открытым до общей
  наблюдаемой приёмки.
