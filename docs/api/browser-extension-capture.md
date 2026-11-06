# Capture API pro rozšíření prohlížeče

Úzké serverové rozhraní, přes které spárované rozšíření Vosio (Chrome/Edge) založí vlastní nahrávku,
nahraje audio po částech a spustí přepis bez otevřeného Vosia. Žije v Edge Function `vosio-mcp` pod
`/functions/v1/vosio-mcp/capture/*`, používá stejný resource, stejné opaque tokeny a stejný grant jako
MCP bridge (viz [MCP a plugin](mcp-plugin.md)). Kód: `src/lib/mcp/capture.server.ts`,
`src/lib/mcp/capture-store.server.ts`, dispatch route `app/api/jobs/recording-transcription/dispatch/route.ts`.

## Autentizace

- Všechny endpointy jsou `POST`, `Content-Type: application/json`, `Authorization: Bearer <access>`.
- Token musí mít přesně scope `{vosio:capture}`. `vosio:read`/`vosio:write` (i smíšená sada) dostane
  403 `insufficient_scope`; capture token naopak nepřijmou MCP ani audio (403 `insufficient_scope`).
- `Origin` musí být přesně `chrome-extension://<id>`, kde `<id>` je host návratové adresy grantu
  (`https://<id>.chromiumapp.org/…`, `grants.redirect_uri`). Jinak 403 `origin_mismatch`. Token se neposílá
  automaticky, CSRF tedy nehrozí; Origin chrání jen před použitím tokenu jiným rozšířením/stránkou
  v prohlížeči (mimo prohlížeč jde podvrhnout – tam platí 5minutový access token a úzký scope).
  Capture grant bez návratové adresy se odmítá.
- Při každém požadavku se ověřuje aktivní grant a živá upstream session; cookies se nepoužívají.
- Per-uživatelský limit 120 požadavků/min (best-effort v paměti instance) → 429 `rate_limited`.

## Chybová obálka

`{ "error": { "code": string, "message": string } }`, zpráva česky bez interních detailů.

| HTTP | code | Význam |
| --- | --- | --- |
| 400 | `invalid_request` | Neplatné tělo/hlavička, změněný název při stejném `requestId` |
| 401 | `unauthorized` | Neplatný/odvolaný/prošlý token (`WWW-Authenticate`); rozšíření zkusí jednou refresh |
| 403 | `insufficient_scope` / `origin_mismatch` | Špatný scope, nebo Origin neodpovídá grantu |
| 404 | `not_found` | Neexistující i cizí nahrávka (stejná odpověď), jiné rozšíření, neznámá cesta |
| 405 | `invalid_request` | Jiná metoda než POST (`Allow: POST`) |
| 409 | `revision_conflict` | Stará revize, nebo nahrávku už uzavřel web (rozšíření si načte `/status`) |
| 409 | `incomplete_parts` | Zaregistrovaná část chybí nebo nesedí velikost/MIME – nahrát znovu přes nové `/parts` |
| 410 | `recording_deleted` | Vlastní nahrávka v koši/smazaná – ukončit opakování |
| 413 | `part_too_large` | Část větší než `maxPartBytes` |
| 429 | `rate_limited` | `Retry-After` |
| 503 | `unavailable` | Dočasně, opakovat s backoffem |

## Endpointy

Všechny `{id}` jsou UUID nahrávky; každý `/recordings/{id}/*` ověří vazbu (`capture_recordings`) na uživatele
**a** rozšíření grantu.

| Endpoint | Tělo | Odpověď |
| --- | --- | --- |
| `/capture/config` | `{}` | `{ audioBitsPerSecond, maxPartBytes, mimeType: "audio/webm", recorderMimeType: "audio/webm;codecs=opus", storage: { apiKey }, webOrigin, account: { email } }` |
| `/capture/recordings` | `{ requestId: uuid, title: 1–200, startedAt: ISO 8601 }` | `{ recordingId, captureRevision, status, detailUrl }` |
| `/capture/recordings/{id}/parts` | `{ captureRevision, mimeType: "audio/webm", parts: [{ index 0–999, sizeBytes > 0 }] }` (souvislé od 0) | `{ captureRevision, parts: [{ index, state: "ready", uploadUrl } \| { index, state: "exists" }] }` |
| `/capture/recordings/{id}/complete` | `{ requestId: uuid, captureRevision, durationSeconds > 0, partCount }` | `{ recordingId, status, transcription: { state: "queued" \| "not_started", operationId \| null }, detailUrl }` |
| `/capture/recordings/{id}/status` | `{}` | `{ recordingId, status, captureRevision, transcriptionState \| null, detailUrl }` |

- `config`: `audioBitsPerSecond` podle uživatelského `liveAudioQuality` (32/64/96 kbit/s), `maxPartBytes` =
  min(limit bucketu `recordings`, 128 MiB); bez limitu 503. `storage.apiKey` je veřejný (publishable/anon) klíč Function,
  nikdy secret/service-role klíč.
- `recordings`: `create_recording_with_access_v1` (`in_app_recording`, soukromá, bez projektu) idempotentně podle
  `requestId` (název je v otisku), poté vazba přes `mcp_capture_binding_record_v1`. `startedAt` se jen validuje
  (čas je už v názvu). `detailUrl` = `<web>/recordings/<id>`.
- `parts`: `prepare_recording_live_part_v1` pro každou část (revize se čte před každou částí) a
  `createSignedUploadUrl(path)` pod JWT uživatele; `uploadUrl` =
  `<publicSupabaseUrl>/storage/v1/object/upload/sign/recordings/<uid>/<id>/live/part-NNNNNN.webm?token=<token>`
  (nikdy interní `SUPABASE_URL`). Rozšíření posílá `PUT` s tělem = blob části a hlavičkami
  `Content-Type: audio/webm`, `apikey: <storage.apiKey>`, `x-upsert: false`. Pokud Storage odmítne podpis, protože objekt
  existuje, vrací se `state: "exists"` (rozšíření bere i HTTP 409 nebo tělo „Duplicate/already exists“ u `PUT` jako
  existující objekt); o úplnosti rozhoduje kontrola manifestu v `/complete`. Audio neprochází Function ani webem.
- `complete`: `complete_recording_live_parts_v1` (délka se zaokrouhlí na celé sekundy, min. 1; `partCount` je jen
  vstupní kontrola 1–1000, autoritativní je manifest v DB), pak `prepare_/start_recording_transcription_v1` pod JWT
  uživatele a `POST <web>/api/jobs/recording-transcription/dispatch`. `requestId` přepisu = UUIDv5 z `requestId`
  dokončení, `captureRevision` z potvrzení dokončení. Opakované dokončení vrátí uložený výsledek (uloží se až po
  úspěšném startu přepisu; selhání prepare/start vrací 200 s `not_started` a opakování `/complete` se stejným
  `requestId` start zkusí znovu bez druhé operace). Selhání dispatch nevrací chybu – operace zůstává pro existující
  dohledání/obnovu. Model: `DEFAULT_SONIOX_ASYNC_MODEL` z `src/lib/model-options.ts` nebo schválený
  `SONIOX_ASYNC_MODEL`; region z uživatelského `sonioxRegion`; jazyk stejně jako ostatní async přepisy.
- `status`: `status` je surová hodnota `recording_status` (`created|uploading|uploaded|transcribing|completed|failed|deleted`),
  rozšíření bere `uploaded|transcribing|completed` jako „upload hotov“. `transcriptionState` ∈
  `queued|running|completed|failed|manual_required|null`. Nikdy nevrací obsah přepisu.
- Nahrávka, kterou už uzavřel web (ruční obnova), vrací u `parts`/`complete` 409 `revision_conflict`; rozšíření si
  načte `/status` a skončí. Rozpracovaný extension upload se 7 dní nenabízí v obnově ve webu (migrace
  `20261106120000`).

## Konfigurace a runbook

- Nový secret `RECORDING_TRANSCRIPTION_DISPATCH_TOKEN` (stejná hodnota na webu i ve Function, nikdy v kódu ani
  dokumentaci); adresu webu bere Function z `installation.web_origin`. Bez tokenu ve Function se dispatch přeskočí.
  Volitelný `SONIOX_ASYNC_MODEL` ve Function musí odpovídat webu (v5 i v6 jsou aktivní, DB neshodu nezachytí).
- Dokončení přepisů delších než okno dispatch (240 s) bez otevřeného Vosia vyžaduje HTTPS `NEXT_PUBLIC_APP_URL`
  (webhook Sonioxu); jinak se dokončí dohledáním při otevření nahrávky.
- Pořadí nasazení: migrace `20261106120000` → web (dispatch route + souhlas) → tokeny → Function. HTTPS smoke:
  401 bez tokenu, 403 pro MCP token na `/capture`, 403 pro capture token na MCP/audio, platný tok z rozšíření.
- Rollback: předchozí verze Function (capture endpointy zmizí), odvolat capture granty; migrace je aditivní.
- Předpoklady k ověření při akceptaci (bez Dockeru zatím neověřeno): `createSignedUploadUrl` pod JWT uživatele
  prochází Storage RLS, `PUT` na podepsanou URL bez/ s `apikey`, kontrola RLS při pozdním `PUT`.
