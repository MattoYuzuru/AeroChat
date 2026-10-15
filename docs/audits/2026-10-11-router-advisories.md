# React Router: обслуживание 7.x и применимость advisory

## Статус и границы

Обновление для [#175](https://github.com/MattoYuzuru/AeroChat/issues/175) поверх
[#218](https://github.com/MattoYuzuru/AeroChat/pull/218), родительский HEAD
`c41ba2767d534d468e057b49e5cfaa9d669716ce`. Зафиксированы —
`react-router-dom` 7.18.4 и согласованный transitive `react-router`; official
[v7 changelog](https://raw.githubusercontent.com/remix-run/react-router/v7/CHANGELOG.md)
датирует этот patch 15 сентября 2026. Это обновление существующего BrowserRouter
SPA, без перехода на 8.x, Data/Framework Mode или SSR/RSC.

Official registry metadata и bounded archives обоих packages 7.18.4 проверены:
name/version, dependency `react-router-dom` → `react-router` 7.18.4, SHA512 SRI
и package.json внутри tarball совпали. Generated lockfile получен pnpm10.19.0
через `--lockfile-only --ignore-scripts`; его SRI совпадает с archives. Другие
package versions не изменились; pnpm добавил текущую registry deprecation
metadata для прежней версии eslint.

На preparation HEAD `b17bc10ac2e72a7afecc378350fa503ac10f5a3d` fresh raw
`pnpm audit --prod --json` исходного lockfile 7.13.1 вернул exit1 и те же
12 advisory (6 high, 5 moderate, 1 low). Prepared manifest 7.18.4 на этой стадии
ещё не был установлен. `check-affquuv4` записывает process0 и ожидаемое изменение
lockfile; это **не frozen validation PASS**. Raw audit и registry evidence
хранятся вне Git, итоговые receipts привязываются к точному HEAD в PR.
Severity counts не равны 12 доказанным уязвимостям AeroChat.

Первый frozen gate `check-fyeltope` на `465245e` подтвердил installed7.18.4/SRI
и новый production audit с нулём advisory, но whole gate завершился FAIL на
desktop Back/Forward. Диагностика `check-h3wpp4p3` на `1440dd4` сохранила
`Maximum update depth exceeded`: новый URL конкурировал с обратной
синхронизацией старого active window. Baseline-only `check-e9i6qg9e` с explicit
aliases к installed Router/DOM7.13.1 родителя218 и равными SHA actual routing
sources воспроизвёл тот же JS failure после успешных deep-link/refresh. External
baseline имел дополнительный font-only403 из fs allow; это не visual proof.
Отказ считается существовавшей route/window ошибкой, а не доказанной регрессией
patch7.18.4. Узкая совместимость по ADR080 отдаёт новому browser location
приоритет до window launch commit, сохраняя focus-only обратную синхронизацию.
Новые frozen gates обязательны; partial passes прежних HEAD не переносятся.

## Применимость по текущему коду

[`AppRouter`](../../apps/web/src/app/AppRouter.tsx) использует BrowserRouter и
Routes/Route: это [Declarative Mode](https://reactrouter.com/7.18.4/start/modes).
[`web nginx`](../../apps/web/nginx.conf) отдаёт статические файлы и SPA fallback
`/index.html`; в этом пути нет React Router server runtime, RSC transport или
`__manifest` endpoint. Из этого следует неприменимость описанных ниже
Framework-only предпосылок, а не результат проверки эксплуатацией.

| Primary advisory | 7.x patch floor | Предпосылка и текущий trace |
|---|---|---|
| [GHSA-49rj-9fvp-4h2h](https://github.com/remix-run/react-router/security/advisories/GHSA-49rj-9fvp-4h2h) | 7.14.2 | Framework server deserialization плюс существующая prototype pollution. Declarative Mode исключён publisher; Framework server отсутствует. Не является общим доказательством отсутствия prototype pollution. |
| [GHSA-8646-j5j9-6r62](https://github.com/remix-run/react-router/security/advisories/GHSA-8646-j5j9-6r62) | 7.13.2 | Unstable RSC redirect из untrusted source; RSC API/transport не используется. |
| [GHSA-8x6r-g9mw-2r78](https://github.com/remix-run/react-router/security/advisories/GHSA-8x6r-g9mw-2r78) | 7.15.0 | Framework `__manifest` обработка; static nginx не реализует этот endpoint. Declarative Mode исключён publisher. |
| [GHSA-rxv8-25v2-qmq8](https://github.com/remix-run/react-router/security/advisories/GHSA-rxv8-25v2-qmq8) | 7.14.0 | Framework single-fetch server serialization; такого server path нет, Declarative Mode исключён publisher. |
| [GHSA-84g9-w2xq-vcv6](https://github.com/remix-run/react-router/security/advisories/GHSA-84g9-w2xq-vcv6) | 7.15.1 | Framework document PUT/PATCH/DELETE CSRF checks; Router server actions отсутствуют, Declarative Mode исключён publisher. Это не аудит собственных gateway CSRF rules. |
| [GHSA-wrjc-x8rr-h8h6](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6) | 7.18.0 | Untrusted path в Link/useNavigate. Условно достижим через localStorage recent.routePath → navigate при отдельной возможности записи attacker-controlled storage. Server content → произвольный path не найден; remote exploit не подтверждён. |
| [GHSA-h8fp-f39c-q6mh](https://github.com/remix-run/react-router/security/advisories/GHSA-h8fp-f39c-q6mh) | 7.18.0 | Unstable RSC error redirect; RSC API/transport не используется. |
| [GHSA-337j-9hxr-rhxg](https://github.com/remix-run/react-router/security/advisories/GHSA-337j-9hxr-rhxg) | 7.18.0 | SSR/hydration и attacker-controlled error metadata; приложение вызывает createRoot, не hydrateRoot, Framework/Data SSR отсутствует. Declarative Mode исключён publisher. |
| [GHSA-chx6-hx7r-mcp5](https://github.com/remix-run/react-router/security/advisories/GHSA-chx6-hx7r-mcp5) | 7.18.0 | Framework manifest matching; Router server отсутствует, Declarative Mode исключён publisher. |
| [GHSA-2j2x-hqr9-3h42](https://github.com/remix-run/react-router/security/advisories/GHSA-2j2x-hqr9-3h42) | 7.14.1 | Router redirect() response с untrusted URL; эта API в source не используется. Declarative Mode исключён publisher. Не переносить это исключение на отдельную navigate advisory wrjc. |
| [GHSA-qwww-vcr4-c8h2](https://github.com/remix-run/react-router/security/advisories/GHSA-qwww-vcr4-c8h2) | 7.18.2 | Unstable RSC action/CSRF path; RSC API/transport не используется. Исторический npm inventory сообщает high, текущая primary страница moderate; сохранить оба источника, не переписывать исторический count. |
| [GHSA-f22v-gfqf-p8f3](https://github.com/remix-run/react-router/security/advisories/GHSA-f22v-gfqf-p8f3) | 7.13.2 | Framework prerendered redirect HTML и untrusted Location; приложение собирает static SPA без Router prerender. Declarative Mode исключён publisher. |


Обычные pathname строятся из фиксированных `/app/...`, а conversation/person IDs
проходят URLSearchParams в [`app-routes`](../../apps/web/src/app/app-routes.tsx).
Это не позволяет query ID изменить origin или pathname. Но
[`normalizeStartMenuRecentItem`](../../apps/web/src/shell/start-menu.ts)
сохраняет строковый localStorage `routePath`,
`resolveStartMenuRecentItemRoutePath` возвращает его, а Desktop/Mobile launcher
передаёт в navigation. Поэтому client navigation advisory нельзя назвать
безусловно неприменимой. Scope обновления не включает новую route sanitization
policy или расширение trust boundary.

Таблица покрывает все 12 записей свежего исходного production audit.
Классификация — вывод из primary предпосылок и code trace, без exploit/load
проверок; обновление версии не заменяет анализ других trust boundaries.

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
  зарезервированными символами через URLSearchParams, keyboard focus inactive
  окна → URL при сохранении обоих drafts и отсутствие pageerrors. Fixture
  выполняется под StrictMode, включая initial deep-link mount effects.
- Synthetic auth/gateway fixture не заменяет actual backend login, crypto или
  реальную двухаккаунтную приёмку. Публикация отдельного PR требует завершённых
  gates и опубликованного prerequisite #173; issue остаётся открытым до общей
  наблюдаемой приёмки.
