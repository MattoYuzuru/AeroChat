# Реализованные возможности и ограничения AeroChat

Инженерный inventory перенесён из README при аудите 11 октября 2026. Он описывает реализованные механизмы и их ограничения, но не заменяет проверку текущего HEAD. Подтверждённое поведение и открытые дефекты сверять с [аудитом 11 октября 2026](../audits/2026-10-11-readiness.md) и [roadmap](../roadmap.md).

## Inventory alpha

На текущем этапе web-клиент уже поддерживает:

- личные чаты и группы через `aero-gateway`;
- People-first страницу `/app/search`:
  - точное добавление/поиск контакта по login без публичного каталога;
  - bounded known-people results с переходом в canonical `person_profile`;
  - preview группы по invite link до явного join;
  - вторичный поиск по всем direct chats или группам с compact jump-oriented результатами;
  - временную подсветку target message, если он уже попал в текущую загруженную историю;
- bounded realtime для chat/group foundation;
- backend-first foundation для encrypted direct-message v2:
  - explicit opaque intake RPC в `aero-chat` и thin proxy через `aero-gateway`;
  - parallel storage path для logical encrypted envelopes и per-device deliveries;
  - explicit device-aware realtime binding по active local `crypto_device_id` в `aero-gateway`;
  - отдельный realtime family для device-scoped opaque encrypted envelope delivery без plaintext snapshot payload;
  - raw list/get fetch path, worker-side decrypt foundation и bounded local web projection для текущего direct chat;
  - первый web outbound bootstrap send path для text-only encrypted DM v2:
    - target roster собирается по active crypto devices собеседника и всех active devices отправителя, включая originating sender device;
    - per-device opaque envelopes собираются внутри crypto worker/runtime boundary;
    - originating sender device теперь получает server-backed self-delivery через тот же opaque storage/realtime path, а bounded local optimistic projection остаётся только временным reconciliation layer без plaintext fallback;
    - newly linked device начинает получать только новые encrypted direct messages после своей активации;
    - backfill старой encrypted direct history на freshly linked device в текущем slice пока не реализован;
  - encrypted media relay v1 для direct encrypted lane:
    - presigned direct-to-object-storage flow сохраняется, но encrypted media upload/download идёт только как ciphertext blob;
    - relay metadata отделена от encrypted attachment descriptor;
    - browser шифрует файл до upload, descriptor уходит внутри encrypted DM v2 payload, а ciphertext blob расшифровывается локально после download;
    - текущий direct encrypted lane умеет bounded text + encrypted attachment и attachment-only send/use path;
    - storage/lifecycle/quota/retention foundation остаётся общей и future-ready для group E2EE;
    - encrypted media retention parity для encrypted direct и encrypted group lanes:
      - explicit encrypted tombstone event теперь так же переводит linked ciphertext attachment из `attached` в `detached`, как и legacy direct tombstone path;
      - это освобождает active quota budget и переводит object в already-existing detached cleanup flow без нового lifecycle status;
      - решение остаётся полностью relay/control-plane driven и не требует plaintext media metadata или чтения encrypted descriptor сервером;
  - encrypted direct-message v2 mutation recovery foundation:
    - reply reference, edit revision и tombstone/delete-for-everyone больше не зависят от plaintext server projection;
    - reply preview собирается только client-side после decrypt и честно деградирует, если target message ещё не попал в локальное bounded окно или уже tombstoned;
    - pin/unpin для encrypted DM v2 живёт как отдельная control-plane ссылка на stable logical `message_id` без доступа сервера к message body;
  - encrypted direct-message v2 unread/read recovery foundation:
    - viewer-relative unread/read state хранится как control-plane metadata по stable logical `message_id`, без server-side plaintext preview;
    - `ListDirectChats` / `GetDirectChat` и realtime получают отдельный encrypted unread/read slice рядом с legacy plaintext read state;
    - active encrypted DM v2 lane умеет явно продвигать encrypted mark-as-read и сходиться с server-backed unread counters;
    - автоматическое чтение требует видимой вкладки и несвёрнутого окна с открытой историей; фокус другого видимого окна сам по себе не запрещает чтение;
  - encrypted search recovery foundation:
    - `/app/search` сохраняет текущий entrypoint; активный encrypted search работает по локальной projection, а server-side search содержимого legacy direct/group history de-scoped;
    - encrypted direct/group search работает только по локально fetched + decrypted message text внутри browser/runtime boundary;
    - local encrypted index остаётся bounded и session-local:
      - latest decrypted window на lane ограничен;
      - `all direct` / `all groups` ищут только по recent encrypted lanes в рамках явного local budget;
      - при logout/reload decrypted search index не сохраняется;
    - jump/open для encrypted search result работает только если target уже materialized в локальной projection текущего bounded окна;
  - первый backend-first MLS-compatible foundation для encrypted groups:
    - отдельный encrypted group control-plane lane в `aero-chat` c явным `mls_group_id` и `roster_version`;
    - materialized readable roster по active trusted crypto devices current group members, включая `reader` и write-restricted участников;
    - отдельный opaque storage path для group-scoped encrypted envelopes и explicit per-device deliveries без reuse `group_messages`;
    - device-aware fetch/bootstrap surface и отдельный realtime family `encrypted_group_message_v1.delivery` без plaintext-style `group.message.updated` snapshots;
    - первый web runtime/local projection foundation для encrypted groups:
      - opaque group envelopes читаются через explicit bootstrap/list path для текущего local crypto-device;
      - decrypt/render остаётся внутри crypto runtime worker boundary;
      - web держит отдельную bounded local projection и отдельную realtime merge path для encrypted group lane;
      - первый outbound bootstrap send path для encrypted group text:
        - worker/runtime сам читает минимальный encrypted group bootstrap и собирает group-scoped ciphertext внутри crypto boundary;
        - web отправляет только opaque envelope через существующий `SendEncryptedGroupMessage`, а storage/realtime остаются source of truth;
        - bounded local optimistic projection используется только до server-backed fetch/realtime convergence и не dual-write'ит plaintext timeline;
      - mutation recovery foundation для encrypted group lane:
        - replies, edits и tombstones применяются как encrypted events c deterministic local projection convergence;
        - pin/unpin остаётся server-visible control-plane metadata по stable logical `message_id`, без plaintext preview на сервере;
        - web рендерит pinned/reply state только из локально разрешённых encrypted entries и честно показывает unresolved/tombstoned состояние, если target пока недоступен;
      - encrypted group media bootstrap:
        - web reuse'ит тот же ciphertext-only encrypted media relay v1 из `ADR-065`, без отдельной group-only media architecture;
        - файл шифруется внутри crypto runtime до upload, ciphertext blob живёт в обычном attachment relay, а encrypted descriptor уходит только внутри encrypted group `content` payload;
        - attachment linkage к logical encrypted message остаётся минимальным shared relay control-plane, чтобы участники группы могли легально получить ciphertext blob через существующий attachment access path;
        - локальный decrypt/use path reuse'ит existing encrypted attachment list и даёт bounded open/download/inline preview для file/image/audio/video там, где это уже поддерживается;
        - attachment-only encrypted media message usable, но encrypted search по-прежнему индексирует только локально расшифрованный text и не обещает media-content parity;
      - encrypted group unread/read recovery foundation:
        - viewer-relative unread/read для encrypted group lane считается по opaque control-plane metadata и не зависит от plaintext body;
        - `ListGroups` / `GetGroupChat`, realtime и active encrypted lane теперь умеют продвигать отдельный encrypted read progression;
        - legacy group read state и encrypted group read state остаются честно раздельными;
        - свёрнутое окно и экран информации группы сохраняют unread до открытия истории;
      - coexistence остаётся честным: encrypted lane не притворяется unified timeline поверх legacy plaintext history;
    - coexistence остаётся bounded и честной:
      - legacy plaintext group history не переписывается и не re-encrypt'ится;
      - encrypted lane forward-only и не dual-write'ит те же сообщения в plaintext path;
    - текущий slice не объявляет full MLS implementation, full encrypted group media parity во всех сценариях или backup/recovery.
  - encrypted DM v2 не мигрирует underlying legacy plaintext history; активный direct/group UI консолидирован вокруг encrypted path без routine выбора между plaintext и encrypted;
  - без claims о full encrypted DM/group parity, full encrypted search parity, backup/recovery или full MLS client completeness.
- explicit group moderation/admin policy foundation:
  - явная policy matrix для `owner` / `admin` / `member` / `reader`;
  - durable write restriction для участников группы без потери membership;
  - realtime convergence composer/typing state после restrict/unrestrict;
- message edit foundation для direct chats и groups с explicit edited marker;
- reply и compact quoted preview для direct chats и groups;
- первый attachment upload flow в direct chats и groups:
  - file picker;
  - presigned upload;
  - send text + attachment;
  - send attachment-only message;
  - polished file rendering для всех attachment kinds;
  - lazy inline preview для image/audio/video attachments;
  - bounded web voice-notes recording через существующий attachment upload/send flow;
  - безопасное explicit open/download через presigned access.
- attachment lifecycle hardening:
  - real expiration для stale upload sessions;
  - bounded cleanup path для orphaned unattached attachments;
  - conservative object deletion только по backend state и explicit message linkage.
- media quota foundation:
  - deterministic per-user byte quota на `CreateAttachmentUploadIntent`;
  - quota usage считается только по backend-owned attachment state;
  - `expired` и `deleted` lifecycle states больше не удерживают active quota budget.
- attachment retention/delete semantics foundation:
  - direct message tombstone переводит linked attachment из `attached` в `detached`;
  - `detached` больше не удерживает active quota budget;
  - object cleanup для `detached` остаётся staged и выполняется отдельно после retention grace period.
- encrypted media relay v1:
  - `attachment` теперь может явно работать как relay entity с `legacy_plaintext` или `encrypted_blob_v1` schema;
  - для encrypted relay quota и cleanup считают ciphertext-visible bytes;
  - user-facing filename/MIME/decrypt metadata для encrypted media больше не считаются server-visible source of truth.
- max groups per user rules foundation:
  - configurable per-user limit по active group memberships;
  - limit применяется на `CreateGroup` и `JoinGroupByInviteLink`;
  - `leave` и `remove` естественно освобождают capacity, потому что учитываются только текущие membership.
- bounded web video-notes recording через существующий attachment upload/send flow.
- desktop shell и mobile launcher adaptation:
  - на viewport от `1180px` web-клиент переходит в XP-style desktop shell с route-backed singleton и singleton-per-target окнами;
  - route-backed direct/group chat окна на desktop теперь не подменяются пустой фоновой заглушкой:
    - несколько открытых переписок остаются живыми одновременно;
    - у каждого окна сохраняется свой target/route context;
    - можно видеть новые сообщения в нескольких открытых окнах параллельно, даже если в фокусе другое окно;
  - direct/group thread surface теперь открывается с нижней границы переписки и на desktop, и на mobile, а header/composer остаются видимыми, пока история скроллится отдельно;
  - на mobile используется launcher home и route-backed app pages без desktop window runtime;
  - отдельное shell-приложение `Создать группу` теперь является дефолтным desktop entrypoint для group bootstrap:
    - оно открывается как отдельный singleton app, а не прячется внутри общего group page flow;
    - entrypoint доступен на рабочем столе, в Start menu и Explorer;
    - shortcut можно скрыть с рабочего стола и вернуть через Explorer без потери самого app target;
  - `Self Chat` теперь является каноническим route-backed системным entrypoint и открывает реальный self direct chat:
    - backend хранит его как специальный single-participant direct chat текущего пользователя;
    - encrypted media/message flow reuse'ит тот же device-aware path, поэтому self chat работает как честный multi-device handoff между вашими устройствами;
    - shell не плодит для него отдельный auto-populated direct-chat shortcut поверх системного `Я`.
- RTC/calls остаются частичными:
  - `aero-rtc-control` уже даёт signaling и server-backed call control-plane;
  - web 1:1 звонок существует как bounded audio-only bootstrap;
  - browser direct-call runtime теперь использует voice-oriented audio constraints / sender tuning,
    bounded peer-recovery backoff после `disconnected` / `failed`, explicit lightweight participant heartbeat
    и best-effort `pagehide` cleanup,
    чтобы звонок звучал стабильнее и stale active-participant хвосты после crash/закрытия вкладки сходились обратно в control-plane;
  - web direct-call awareness теперь сильнее опирается на realtime + deduplicated refresh,
    а fallback polling ограничен уже известными active direct chats вместо повторного fan-out по всем direct conversations;
  - `aero-rtc-control` теперь умеет opportunistic stale eviction active participants по bounded timeout,
    поэтому ложные active-call conflicts после жёстко закрытого браузера больше не должны жить бесконечно;
  - browser direct-call runtime теперь читает ICE servers из `aero-rtc-control` и держит repo-default STUN fallback,
    поэтому operator может задавать TURN/STUN policy без нового frontend build;
  - server/prod-like compose теперь включает repo-managed `turn` runtime с явным public relay IP contract,
    чтобы direct-call connectivity не зависела от вне-репозитарного ad-hoc coturn setup;
  - production-grade connectivity по-прежнему не гарантируется без корректно заданной operator-managed TURN/STUN policy;
  - group call UI сейчас остаётся lobby/control surface без multiparty browser media transport.


## Platform additions

- Web Push для первого unread в direct/group conversation и заявок в друзья; encrypted notification использует generic copy без plaintext preview. Нужны VAPID-настройки, разрешение браузера и secure context. Visible client suppress'ит OS notification; unread badges сохраняются.
- Manifest и web app install flow уже существуют. Offline caching, background sync и полноценная mobile/PWA готовность остаются отдельной задачей.

В inventory не включены обещания full E2EE/MLS parity, encrypted history backfill, backup/recovery или multiparty call media. Решения и rationale доступны через [навигатор](../README.md).
