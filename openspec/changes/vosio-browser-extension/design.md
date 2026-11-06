# Design

Motivace a dohoda: `proposal.md`. Požadavky: `specs/browser-extension-pairing`, `specs/browser-extension-capture-api`, `specs/browser-extension-meeting-recording`. Pracovní poznámky z brainstormingu: `docs/superpowers/specs/2026-11-06-vosio-browser-extension-design.md`.

## Context

Ověřeno čtením kódu a read-only dotazem na privátní target `kwtivytfnahlrxlydmfk` 06.11.2026:

- **OAuth bridge** běží celý v Edge Function `vosio-mcp` (`supabase/functions/vosio-mcp/index.ts`, sdílený kód `src/lib/mcp/*` balený `npm run build:mcp`). Web jen proxuje (`app/api/mcp/oauth/*` → `gateway.server.ts:proxyMcpOAuth`) a hostí souhlas (`app/mcp/consent`, `app/mcp/upstream-consent`) a seznam připojení (`app/mcp/connections/page.tsx`, odkaz jen z dokumentace).
- Tokeny jsou opaque (43 znaků, v DB jen SHA-256), access `min(300 s, upstream exp)`, grant 30 dní bez prodloužení, refresh rotuje a replay odvolá grant (`20261003143836_vosio_mcp_oauth_bridge.sql`, `oauth.server.ts:176-193`).
- **Scopes:** povinné `vosio:read` je natvrdo v SQL (`pending_scopes_check`, `grants_scopes_check` – živě ověřeno) i TS (`oauth.server.ts:17,29,32,54-58,176-178,282-283`, `oauth-store.server.ts:9`, `auth.server.ts:16` `grantSchema` a `authenticateMcpRequest` (`auth.server.ts:39-58`), `edge-handler.server.ts:15,53`, `app/mcp/consent/page.tsx:18`, `app/mcp/connections/page.tsx:16`). Souhlas zná jen volbu read/write (`oauth.server.ts:33`, approve skládá `{read}` `:282-283`), DCR validuje `scope` (`:217`), chyby `/authorize` vrací JSON místo přesměrování.
- **Grant při ověření tokenu:** custody `access` vrací `grant_json` (`20261003143836…sql:54-57`) bez `redirect_uri`; `grantSchema` ho také nemá. Chyba obnovy (i síťová) grant odvolá (`oauth.server.ts:189-191`), replay refresh tokenu taky.
- **Redirect:** `validateMcpRedirect` přijme libovolné kanonické `https:` URL; `https://<id>.chromiumapp.org/oauth` projde dnes bez změny (exact match). DCR (`mcp_register_dynamic_client_v1`) je zapnuté: 30 registrací/60 s, kapacita 256, úklid nepoužitých klientů po 24 h. Živě: instalace `enabled=true`, 3 dynamičtí klienti, 2 aktivní granty.
- **Resource binding:** token je vázaný na `<supabase>/functions/v1/vosio-mcp`; `authenticateMcpRequest` vyžaduje origin resource, dešifruje upstream session (`MCP_TOKEN_ENCRYPTION_KEY` jen ve Function) a vrací supabase-js klienta s JWT uživatele (RLS) na interní `config.supabaseUrl` (u self-hostu např. `http://kong:8000`, veřejná adresa je `publicSupabaseUrl`). `protocol.server.ts:57` a `edge-handler.server.ts:62` odmítají cizí `Origin`.
- **Capture kontrakty** (vše RPC pod JWT uživatele): `create_recording_with_access_v1` (idempotentní `p_request_id`), `get_recording_capture_state_v1`, `prepare_recording_live_part_v1` (vyžaduje `source_type='in_app_recording'`, stav `created|uploading|failed`, CAS `capture_revision`, části 0–999, cesta `<uid>/<rid>/live/part-NNNNNN.webm`), `complete_recording_live_parts_v1`, pak `prepare_recording_transcription_v1` + `start_recording_transcription_v1`. Worker umí přepsat vícedílný manifest s posunem časů (`transcription-worker.server.ts:101-120`).
- **Obnova ve webu:** `list_recoverable_recording_captures_v1` (`20261005010000:165-199`) nabízí `in_app_recording` ve stavu `uploading` s registrovanými částmi a přechod `recover` uzavře manifest z dosud registrovaných částí. `complete_recording_live_parts_v1` vyžaduje délku a přesný MIME/velikost uloženého objektu; zápis do už existujícího objektu Storage RLS odmítne (`can_write_recording_object_v1`). `create_recording_with_access_v1` má název v otisku idempotence.
- **Model přepisu:** aktivní jsou `stt-async-v5` i `stt-async-v6` (`20261103200000`), worker kontroluje jen `isApprovedSonioxAsyncModel`; neshoda modelu webu a Function by tedy tiše použila jiný model. `assertTranscriptionModel` závisí na `getServerEnv` (Next), který `build-mcp-edge.mjs:21` nahrazuje stubem – do Function lze bezpečně brát jen `model-options.ts`.
- **Dokončení dlouhých přepisů:** dispatch má rozpočet 240 s; delší joby dokončí webhook Sonioxu jen při HTTPS `NEXT_PUBLIC_APP_URL` (`transcription-dispatch.server.ts:17-23`), jinak `reconcile` při otevření detailu.
- **Spuštění přepisu** dnes jen `POST /api/recordings/[id]/transcription` (cookie + `assertInvitationOrigin`) s `after(runTranscriptionOperation)`. **Žádný plánovač neexistuje** (bez `vercel.json` cronu, bez `pg_cron`/`pg_net`; ověřeno). `POST /api/jobs/recording-transcription` vyžaduje `RECORDING_TRANSCRIPTION_WORKER_TOKEN`, nikdo ho nevolá.
- **Úložiště:** bucket `recordings` privátní, živě `file_size_limit=52428800` (50 MiB), MIME allowlist obsahuje `audio/webm`. Storage RLS: první složka = `auth.uid()`.
- **Nastavení:** `user_metadata.vosio_settings` – relevantní `liveAudioQuality` (32/64/96 kbit/s) a `sonioxRegion`. Režim nahrávání ani jazyk asynchronního přepisu nejsou nastavení (jazyk = `cs` nápověda + identifikace, natvrdo).
- **Chrome/Edge (oficiální dokumentace):** `tabCapture.getMediaStreamId` jen po aktivaci rozšíření na kartě (action klik, `commands` zkratka, kontextové menu); stream ID je jednorázové a platí sekundy; lze ho použít v offscreen dokumentu. Zachycená karta ztlumí zvuk, dokud se nepřesměruje do `AudioContext.destination`. Offscreen dokument sám nevyvolá dotaz na mikrofon – povolení musí proběhnout na viditelné stránce rozšíření (origin `chrome-extension://<id>`). `launchWebAuthFlow` funguje s libovolným OAuth serverem i v Edge desktop; Edge Add-ons přidělí jiné ID než Chrome Web Store. Store politika vyžaduje zásady ochrany soukromí a výrazné upozornění před sběrem osobní komunikace.

## Goals / Non-Goals

**Goals:** znovupoužít existující bridge, capture RPC a worker; žádná druhá implementace přepisu, žádná nová npm závislost; rozšíření bez tajemství a bez adresy konkrétní instalace.

**Non-Goals:** obecné cross-origin API pro webové klienty, CORS pro webové stránky, změna cookie routes a `assertInvitationOrigin`, nový plánovač pro existující worker, živý přepis, sdílení nahrávek z rozšíření.

## Decisions

### D1 Scope `vosio:capture` jako samostatná sada v existujícím bridge
Povolené sady: `{read}`, `{read,write}`, `{capture}`. Read/write požadavky zůstávají beze změny; povinnost `read` se přesune z obecné autentizace (`grantSchema`, `oauth.server.ts:176`) na MCP/audio endpointy – `edge-handler` odmítne capture token výslovně ještě před `handleMcpProtocol` (jinak by prošlo `initialize`/`tools/list`). Capture endpointy vyžadují přesně `{capture}`. `{capture}` se přijme při DCR i `/authorize` jen s návratovou adresou `^https://[a-p]{32}\.chromiumapp\.org/`. Souhlas dostane třetí režim (bez volby read/write) a approve složí `{capture}`. Discovery `scopes_supported` (AS metadata i `/resource-metadata`) **zůstává `[vosio:read, vosio:write]`** – MCP SDK (SEP-835) bere bez `scope` v 401 výzvě celý `scopes_supported` jako požadovanou sadu a `{read,write,capture}` by stávající klienty rozbilo; rozšíření žádá pevný `vosio:capture` a discovery scopes nepotřebuje. Refresh drží stejnou sadu. Chyby `/authorize` pro capture klienty se vrací přesměrováním s `error` na platnou návratovou adresu, aby `launchWebAuthFlow` nevisel; rozšíření má navíc timeout.
*Alternativy:* nový samostatný OAuth server (duplikace kryptografie a custody – zamítnuto); skutečná Supabase session v rozšíření (JWT dává plná RLS práva uživatele včetně čtení všech nahrávek – porušuje slib úzkého klíče, zamítnuto); `{read,capture}` (zbytečné čtení – zamítnuto).

### D2 Capture endpointy ve Function `vosio-mcp` pod `/capture/*`
Jen Function drží šifrovací klíč a upstream session, takže capture rozhraní žije tam a používá stejný resource (Function URL) – žádný nový resource indicator. Endpointy (JSON, `Cache-Control: no-store`, **všechny `POST`**, aby prohlížeč vždy poslal `Origin` – u `GET` z service workeru to není zaručené): `POST /capture/config`, `POST /capture/recordings`, `POST /capture/recordings/{id}/parts`, `POST /capture/recordings/{id}/complete`, `POST /capture/recordings/{id}/status`. Těla striktní zod schémata; žádné audio v těle. `/capture/config` vrací i veřejnou Supabase URL a veřejný (anon/publishable) klíč pro hlavičku `apikey` u podepsaného `PUT`, takže rozšíření funguje na hosted i self-host bez ohledu na to, zda brána `apikey` vyžaduje.
**Origin:** pro `/capture/*` se místo pravidla „Origin = resource origin“ vyžaduje `Origin: chrome-extension://<id>`, kde `<id>` je host návratové adresy grantu (`grants.redirect_uri` = `https://<id>.chromiumapp.org/…`; `grant_json` a `grantSchema` se o `redirect_uri` rozšíří). Bearer token není posílán automaticky, CSRF tedy nehrozí; vazba na ID brání použití tokenu jiným rozšířením nebo stránkou **v prohlížeči**. Proti zloději tokenu mimo prohlížeč Origin nechrání (lze ho podvrhnout) – tam platí krátká platnost tokenu a úzký scope. Rozšíření má host permission na origin Function, CORS se nepřidává; zda Chrome i Edge posílají `Origin` i u GET z service workeru, ověří úkol 0.
*Alternativa:* Next route s Bearer – vyžadovala by šifrovací klíč na webu (zakázáno `docs/api/mcp-plugin.md:117`), zamítnuto.

### D3 Vazba nahrávky na uživatele a rozšíření
Nová privátní tabulka (pracovně `vosio_mcp_private.capture_recordings`: `user_id`, `extension_id` (host návratové adresy), `recording_id`, `request_id`, `created_grant_id`, `completed_at`, `created_at`; FORCE RLS, bez grantů rolím) a service-only RPC pro zápis/ověření vazby, volané Function service klientem stejně jako custody. Každý `/capture/recordings/{id}*` ověří, že vazba patří uživateli **a** rozšíření aktuálního grantu; neexistující i cizí ID vrací stejnou 404. Vazba se neváže na konkrétní grant, protože grant snadno zanikne (chyba obnovy, replay, 30 dní) a rozšíření musí po novém spárování dokončit rozpracovaný upload. FK na nahrávku `ON DELETE CASCADE` (hard-delete z koše vazbu odstraní); `created_grant_id` bez FK, jen audit.
Vazba bez `completed_at` zároveň vyřadí nahrávku z `list_recoverable_recording_captures_v1` (nový `recovery_issue` / filtr), aby ji web neuzavřel z neúplných částí. Trvale selhaný upload (rozšíření ho zahodí, nebo vazba starší než nastavená lhůta, výchozí 7 dní) se do obnovy vrací.
*Alternativa:* vazba na grant (zamítnuto – rozpracovaná nahrávka by po novém spárování zůstala navždy nedostupná).

### D4 Nahrávka vzniká až při zastavení, audio po částech přes podepsané nahrání
Rozšíření nahrává lokálně (D6); při zastavení uloží do IndexedDB `requestId` a hotový název („<Platforma> – DD.MM.YYYY HH:MM“ v místním čase) a pak: `POST /capture/recordings {requestId, title}` → `create_recording_with_access_v1` (`source_type='in_app_recording'`, soukromá, bez projektu) → `POST …/parts {parts:[{index, sizeBytes}], mimeType:"audio/webm", captureRevision}` zaregistruje **všechny** části najednou (`prepare_recording_live_part_v1` pro 0..N-1; velikosti jsou po zastavení známé) a pro každou vrátí `{path, token}` z `storage.createSignedUploadUrl(path)` pod JWT uživatele → rozšíření sestaví URL z `publicSupabaseUrl` (nikdy z interního `SUPABASE_URL`) a pošle `PUT` s `Content-Type: audio/webm` (ne `audio/webm;codecs=opus`) → `POST …/complete {requestId, captureRevision, durationSeconds}` → `complete_recording_live_parts_v1`. Pokud je podpis pro existující objekt odmítnut, rozšíření pokračuje na `/complete`; jeho kontrola manifestu je autoritativní.
Velikost části: rozšíření rotuje `MediaRecorder` tak, aby část nepřekročila 90 % `maxPartBytes` z `/capture/config` (při 64 kbit/s a 50 MiB ≈ 1,7 h), takže běžná schůzka má jednu část a konzistentní číslování mluvčích.
*Alternativy:* TUS (vyžaduje JWT uživatele v rozšíření – D1); audio přes Function (limity těla a času Edge Function, zamítnuto); jeden soubor bez dělení (selže nad limitem bucketu). Signed upload je jednorázový PUT bez navazování – při selhání se opakuje celá část (≤ 50 MiB).
*Předpoklady k ověření v úkolu 0:* `createSignedUploadUrl` pod JWT uživatele z Deno Function projde Storage RLS; `complete_recording_live_parts_v1` přijme části nahrané touto cestou; zda `PUT` na podepsanou URL potřebuje `apikey` (hosted vs self-host); zda Storage při `PUT` znovu kontroluje RLS (pozdní `PUT` po smazání nahrávky by jinak mohl zanechat osiřelý objekt – pak úklid osiřelých objektů v existujícím purge).

### D5 Spuštění přepisu bez otevřeného Vosia
`/complete` po dokončení uploadu zavolá pod JWT uživatele `prepare_recording_transcription_v1` a `start_recording_transcription_v1`, potom server-to-server `POST <installation.web_origin>/api/jobs/recording-transcription/dispatch {operationId}` s `Authorization: Bearer <RECORDING_TRANSCRIPTION_DISPATCH_TOKEN>` (vlastní token, ne worker token – Function nemá umět spustit obecný discovery worker). Nová úzká route (`runtime="nodejs"`, `maxDuration=300`) ověří token (`timingSafeEqual` jako `app/api/jobs/recording-transcription/route.ts`), přijme jen UUID operace a v `after()` zavolá `runTranscriptionOperation(createAdminClient(), operationId)` – tutéž cestu jako cookie route. Selhání dispatch nevrací chybu rozšíření; operace zůstává pro existující dohledání/obnovu (`transcription/recover`).
*Idempotence:* `requestId` přepisu se odvodí deterministicky (UUIDv5 z `requestId` dokončení) a `captureRevision` z potvrzení dokončení; opakované `/complete` vrátí uložený výsledek dokončení, prepare vrátí existující operaci a start je idempotentní – nevznikne druhá operace ani druhé placené odeslání.
*Model:* Function bere `DEFAULT_SONIOX_ASYNC_MODEL` z `model-options.ts` (bez Next závislostí) s validovaným volitelným `SONIOX_ASYNC_MODEL` override; nesmí importovat `assertTranscriptionModel`/`transcription-worker.server.ts`. Protože jsou aktivní dva modely, DB neshodu nezachytí – postflight porovná `operation.model` capture přepisu s modelem webu.
*Dokončení dlouhých přepisů* bez otevřeného Vosia vyžaduje HTTPS `NEXT_PUBLIC_APP_URL` (webhook); jinak se dokončí při otevření detailu (spec to uvádí).
*Alternativy:* spoléhat na plánovač (neexistuje); volat Soniox z Function (duplikace provider logiky a dalšího secretu); obecný discovery worker (nejednoznačné, který job se zpracuje).

### D6 Architektura rozšíření (`extension/`)
- MV3, `minimum_chrome_version` 116. Oprávnění: `tabCapture`, `offscreen`, `storage`, `unlimitedStorage`, `identity`, `scripting`, `tabs`, `notifications`, `commands`, `alarms` (fronta odesílání); `host_permissions` jen Meet/Teams/Zoom; `optional_host_permissions: ["https://*/*"]` jen pro žádosti za běhu (origin Vosia, Supabase instalace, vlastní weby).
- **Service worker:** stav, párování (`launchWebAuthFlow`, PKCE, DCR, opakovaná registrace při `invalid_client`), jediný serializovaný refresh (zámek přes `navigator.locks` + uložení nového páru před použitím), fronta odesílání s `chrome.alarms`/startup obnovou.
- **Spuštění:** `action.onClicked` (Automaticky) nebo popup (Zeptat se/Vypnuto) a `commands` → ihned `getMediaStreamId({targetTabId})` → offscreen dokument.
- **Offscreen dokument (`USER_MEDIA`):** `getUserMedia` tab streamu + mikrofon, `AudioContext` mix do `MediaStreamDestination`, tab zdroj zároveň do `destination` (uživatel slyší), `MediaRecorder` `audio/webm;codecs=opus` s bitrate z configu, `timeslice` 5 s, každý chunk ihned do IndexedDB (session id, část, pořadí); rotace části podle D4.
- **Povolení mikrofonu:** samostatná stránka rozšíření (`permissions.html`) s `getUserMedia` při prvním spuštění nebo z nastavení.
- **Detekce schůzky:** content scripty pro Meet/Teams/Zoom (URL vzor + DOM signál „v hovoru“/„opuštěno“, konzervativní selektory v jednom modulu na platformu); vlastní weby přes `scripting.registerContentScripts` jen s URL + konec karty. Stop i při `tabs.onRemoved`, změně URL mimo vzor a `track.onended`.
- **Nastavení:** `chrome.storage.sync` (režim, vlastní weby, adresa Vosia); tokeny a nahrávky jen lokálně (`chrome.storage.local`/IndexedDB).
- **Build:** bez bundleru a bez npm závislostí v rozšíření – `scripts/build-vosio-extension.mjs` přeloží `extension/src/**/*.ts` přes nainstalovaný `typescript` (jako `build-mcp-edge.mjs`) do `.tmp/extension/<target>/` a zkopíruje manifest/HTML/ikony; varianty `chrome`, `edge`, `dev` (`key` jen pro dev). Unit testy ve Vitest (`tests/unit/extension-*.test.ts`) se stubem `chrome.*`.

### D7 Nastavení Vosia
Sekce „Připojené aplikace a rozšíření“ v `src/components/settings-panel.tsx` mezi `settings-storage` a `settings-appearance`, data z existujících `mcp_list_own_connections_v1` / `mcp_revoke_own_connection_v1` (stejné jako `app/mcp/connections`), popisek typu podle scopes (`vosio:capture` → „Rozšíření prohlížeče – nahrávání“). `app/mcp/connections` zůstává a sdílí formátování (dnes by capture grant popsal jako „Čtení“ – opravit). `mcp_list_own_connections_v1` nevrací návratovou adresu; v téže migraci se rozšíří o bezpečný identifikátor rozšíření (host `chromiumapp.org`), aby uživatel rozlišil Chrome a Edge.

### D8 Drátový kontrakt capture API (závazný pro backend i rozšíření)
Discovery: rozšíření z adresy webu načte `GET <web>/.well-known/oauth-authorization-server` (authorization/token/registration/revocation endpointy). Resource URL Function = `registration_endpoint` bez koncového `/oauth/register`; capture báze = `<resource>/capture`. Oprávnění k originu webu se žádá v gestu „Spárovat“, k originu Supabase (resource) druhým tlačítkem po discovery (další gesto). DCR: `token_endpoint_auth_method: "none"`, `grant_types: ["authorization_code","refresh_token"]`, `redirect_uris: [chrome.identity.getRedirectURL("oauth")]`, `scope: "vosio:capture"`, `client_name: "Vosio rozšíření prohlížeče"`. Authorize navíc s `resource=<resource>`.

Všechny požadavky `POST`, `Authorization: Bearer <access>`, `Content-Type: application/json`, `Origin` doplní prohlížeč. Úspěch 200 JSON; chyba `{ "error": { "code": string, "message": string } }` (zpráva česky, bez interních detailů):

| Endpoint | Tělo | Odpověď |
|---|---|---|
| `/capture/config` | `{}` | `{ audioBitsPerSecond, maxPartBytes, mimeType: "audio/webm", recorderMimeType: "audio/webm;codecs=opus", storage: { apiKey }, webOrigin, account: { email } }` |
| `/capture/recordings` | `{ requestId: uuid, title: string 1–200, startedAt: ISO 8601 }` | `{ recordingId, captureRevision, status, detailUrl }` (idempotentní podle `requestId`) |
| `/capture/recordings/{id}/parts` | `{ captureRevision, mimeType: "audio/webm", parts: [{ index 0–999, sizeBytes > 0 }] }` (souvislé od 0) | `{ captureRevision, parts: [{ index, state: "ready", uploadUrl } \| { index, state: "exists" }] }` |
| `/capture/recordings/{id}/complete` | `{ requestId: uuid, captureRevision, durationSeconds > 0, partCount }` | `{ recordingId, status, transcription: { state: "queued" \| "not_started", operationId \| null }, detailUrl }` (opakování vrátí uložený výsledek) |
| `/capture/recordings/{id}/status` | `{}` | `{ recordingId, status, captureRevision, transcriptionState \| null, detailUrl }` (`status` = `public.recording_status`; `uploaded`/`transcribing`/`completed` = upload hotov) |

`uploadUrl` = `<publicSupabaseUrl>/storage/v1/object/upload/sign/recordings/<path>?token=<token>`; rozšíření pošle `PUT` s tělem = surový blob části a hlavičkami `Content-Type: audio/webm`, `apikey: <storage.apiKey>`, `x-upsert: false`. Kódy chyb: 400 `invalid_request`, 401 `unauthorized` (s `WWW-Authenticate`; rozšíření zkusí jednou refresh), 403 `insufficient_scope` / `origin_mismatch`, 404 `not_found` (neexistující i cizí), 409 `revision_conflict` (rozšíření si načte `/status` a pokračuje s aktuální revizí) / `incomplete_parts` (některá část chybí nebo nesedí – nahrát znovu dotčené části přes nové `/parts`), 410 `recording_deleted` (vlastní nahrávka v koši/smazaná – ukončit opakování), 413 `part_too_large`, 429 `rate_limited`, 503 `unavailable` (opakovat s backoffem).

## Risks / Trade-offs

- [DOM detekce Meet/Teams/Zoom se rozbije aktualizací jejich UI] → izolované moduly na platformu, fallback zavření karty/změna URL/ruční stop, ruční start funguje vždy; selektory v gotchas.
- [Zachycení zvuku vyžaduje klik, uživatel může zapomenout] → ikona na rozpoznané schůzce, volitelná notifikace „Schůzka zjištěna – klikněte na ikonu“, klávesová zkratka.
- [Ozvěna nebo zdvojený zvuk bez sluchátek] → mix bez zpětné vazby (mikrofon se nepouští do `destination`), doporučení sluchátek v nápovědě.
- [Refresh replay odvolá grant při souběhu] → jediný serializovaný refresh (D6), test souběhu.
- [Malware na počítači přečte tokeny] → access 5 min, grant 30 dní, odpojení ve Vosiu; mimo kontrolu rozšíření.
- [Úniky nahrávek z lokálního úložiště] → smazání po potvrzeném dokončení, ruční smazání čekajících nahrávek, data jen v origin rozšíření.
- [Review ve store trvá dny až týdny; jiné ID v Edge] → DCR registruje každé ID samostatně, žádná konfigurace instalace; dev build se stabilním `key`.
- [Neshoda `SONIOX_ASYNC_MODEL` mezi webem a Function; DB ji nezachytí, protože v5 i v6 jsou aktivní] → Function bere sdílený default z `model-options.ts`, override jen výslovně, postflight porovná `operation.model`.
- [Projekt AGENTS.md a `docs/gotchas.md:238` uvádí TUS jako jedinou upload cestu] → úkol 3.3 tato pravidla doplní o podepsaný PUT po částech pro rozšíření (velké audio dál nikdy přes API routes).
- [Dispatch selže (web nedostupný)] → operace zůstane `started`, existující obnova; rozšíření hlásí uložení audia a stav přepisu ukáže Vosio.
- [Právní souhlas účastníků] → upozornění před prvním nahráváním, zásady ochrany soukromí; odpovědnost za informování účastníků nese uživatel.

## Migration Plan

Pořadí (každý krok s vlastní výslovnou autorizací pro konkrétní target):

1. Preflight read-only: stav migrací, check omezení scopes, ACL custody funkcí, verze Function, model webu (`SONIOX_ASYNC_MODEL` nebo default), HTTPS `NEXT_PUBLIC_APP_URL` (webhook).
2. Dopředná migrace: nová check omezení scopes (`{read}`, `{read,write}`, `{capture}`), tabulka vazeb, service-only RPC; ověření `node scripts/verify-mcp-postgres.mjs` na disposable DB, rolled-back zkouška a apply přes Management API podle konvence projektu, postflight.
3. Web build se souhlasem, sekcí Nastavení a dispatch route (zpětně kompatibilní – nové scopes zatím nikdo nežádá).
4. Nový `RECORDING_TRANSCRIPTION_DISPATCH_TOKEN` na webu i ve Function a volitelný `SONIOX_ASYNC_MODEL` ve Function (vkládá vlastník; adresa webu se bere z existujícího `installation.web_origin`); nasazení `vosio-mcp` s capture endpointy; HTTPS smoke: 401 bez tokenu, odmítnutí MCP tokenu na `/capture`, odmítnutí capture tokenu na MCP.
5. Interní dev build rozšíření (unpacked se stabilním `key`) a akceptace na privátním Vosiu; teprve potom store podání (vlastník).

Rollback: nasadit předchozí Function verzi (capture endpointy zmizí); odvolat capture granty; migrace je aditivní – zpětná migrace vrací původní check omezení jen pokud neexistuje grant/pending se `{capture}` (jinak nejdřív odvolat a uklidit).

## Open Questions

- Přesné DOM signály Meet/Teams/Zoom se určí v úkolu 0 a zapíšou do `docs/gotchas.md`; neovlivňují specifikaci (fallback je daný).
- Text zásad ochrany soukromí a URL, kde bude hostovaný (pravděpodobně stránka ve veřejném Vosiu/repu) – připraví se v úkolu 6, publikuje vlastník.
