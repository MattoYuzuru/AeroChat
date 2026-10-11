# ADR-095: Ограниченный исходящий Web Push transport

- Статус: Accepted — граница проверена координатором и независимым RTC reviewer до implementation
- Дата: 2026-10-11
- Задача: [#150](https://github.com/MattoYuzuru/AeroChat/issues/150)
- Уточняет ADR-086; crypto payload/VAPID остаются стандартной библиотекой Web Push.

## Контекст

Endpoint subscription поступает от клиента и сохраняется identity. Shared sender передаёт его обычному HTTP client; arbitrary HTTP/HTTPS endpoint, DNS private address, proxy environment и redirects не имеют отдельной границы. Ошибки sender включают полный endpoint, который является capability. Исходный finding подтверждается code trace; порог нагрузки/публичный scanner не измерялись и не нужны для исправления.

## Решение

1. Identity при регистрации и sender при каждом dispatch применяют один URL policy: HTTPS, порт 443 или default, отсутствие userinfo/fragment, bounded length, canonical ASCII hostname. Существующие неподходящие subscriptions не обходят policy и могут быть удалены как invalid. Delete собственного старого subscription остаётся доступен.
2. Первый slice поддерживает Chrome/Firefox/Safari provider hosts: exact `fcm.googleapis.com`, exact `updates.push.services.mozilla.com`, непустые DNS subdomains `*.push.apple.com`. Это ограничение совместимости, не assertion доставки на всех браузерах. Custom provider/operator произвольные endpoints требуют отдельной reviewed настройки; generic wildcard не вводится.
3. Dedicated transport не использует HTTP(S)_PROXY/ALL_PROXY или injected произвольный production client. Redirects запрещены. На каждом новом соединении resolver возвращает ограниченный список адресов, весь набор проверяется; private/loopback/link-local/CGNAT/multicast/unspecified и reserved/documentation/translation ranges отвергаются. Dial использует проверенный числовой IP без второго DNS lookup; HTTPS hostname/certificate verification сохраняется для исходного provider host. DNS rebinding между validation и dial не переключает адрес на private network.
4. TLS verification не отключается. Dial, TLS/headers, individual request и весь sequential SendJSON имеют конечные budgets. Connection reuse отключён в этом узком transport: один проверенный DNS/dial на request. Нет background goroutine fanout/неограниченного retry. Client context отменяет работу; стандартный SDK формирует VAPID/encryption.
5. HTTP 2xx означает accepted provider response; 404/410 снимают invalid subscription. Структурно запрещённый stored URL также invalid; DNS/private или mixed answer, TLS, timeout и остальные HTTP ошибки запрещают текущую отправку, но сохраняют subscription для следующего обычного события. Response body не нужен приложению и закрывается без логирования. Ошибки не включают endpoint, key/auth/VAPID material, response body или URL query. Invalid endpoint отклоняется до encryption/network. Отмена общего deadline или частично выполненный batch возвращают sanitized ошибку и не означают accepted для всех получателей.

## Приёмка

Table tests проверяют URL/hostname/port/credential/suffix tricks, public/private IPv4/IPv6/mapped addresses и mixed DNS answers. Tiny owned localhost HTTP(S) fixtures проверяют redirect denial, отмену/timeout и отсутствие private dial; resolver/dial injection существует только в package tests. Нормальный mock provider 2xx и 404/410 проверяет sender semantics без публичной доставки. Старый sender на собственный localhost endpoint воспроизводит отсутствие policy; новый не подключается к нему. Это bounded negative regression, не перенос отклонённого audit script.

Mapped IPv4 приводится к IPv4 перед проверкой. IPv6 разрешён только из global unicast allocation 2000::/3 с исключением special-purpose ranges, включая protocol assignments, documentation и translation. Проверка не ограничивается `IsGlobalUnicast`/`IsPrivate`. Opaque path/query capability сохраняются; transport не меняет shared TLS ServerName при concurrent requests.

Actual browser push через public vendors требует permission/subscription и отдельного end-to-end evidence. В этой Mac-сессии без такого evidence OS/device delivery остаётся неподтверждённой. Локальные fixtures не доказывают исправность всего Web Push протокола.

## Последствия и альтернативы

Curated provider policy может отклонить новый браузер/provider. Безопасное отклонение имеет явную ошибку; заранее широкие домены/IP ranges не добавляются. DNS IP проверка дополнена network egress policy оператора, но этот PR не меняет firewall. Это не общий SSRF proxy и не защита от public-provider resource abuse.

Disabled push сохраняется при пустом VAPID config. Существующие subscription rows не мигрируются автоматически в новый trust model; sender повторно проверяет их. Rollback возвращает прежнюю небезопасную egress границу.

## Источники

- [Chrome Web Push endpoint example](https://web.dev/articles/codelab-notifications-push-server)
- [Mozilla production endpoint](https://mozilla-services.github.io/autopush-rs/)
- [WebKit: разрешение subdomains push.apple.com](https://webkit.org/blog/12945/meet-web-push/)
- [Go HTTP Transport](https://pkg.go.dev/net/http#Transport), [Resolver LookupNetIP](https://pkg.go.dev/net#Resolver.LookupNetIP)
- [IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml)
- [IANA IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml)
