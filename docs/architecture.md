# Architecture

## Přehled

Vosio je cílově robustní Next.js PWA pro audio nahrávky, přepisy a AI zpracování. Aplikace běží na Vercelu, používá Supabase pro auth, databázi a storage, Soniox pro speech-to-text a OpenAI API jako výchozí AI provider s volitelným Google Gemini providerem.

Architektura musí podporovat mobil i desktop a nesmí předpokládat, že všechny dlouhé operace proběhnou uvnitř jednoho Vercel requestu.

Repo je source-available pod vlastní licencí v `LICENSE.md`. Soukromé a interní použití je povolené, ale placený hosted SaaS/subscription resale nebo white-label prodej vyžaduje písemné povolení. Aplikace obsahuje pouze pasivní license marker v HTML metadatech; neposílá žádný skrytý tracking ani licenční beacon.

## Hlavní komponenty

| Komponenta | Úloha |
| --- | --- |
| Next.js PWA | UI, mobilní/desktop přístup, auth flow, krátké API akce |
| Supabase Auth | interní email/password přihlášení a identita uživatele |
| Supabase Postgres | metadata, joby, transcript, AI výstupy, prompty, audit |
| Supabase Storage | private uložení audio souborů a případných exportů |
| Soniox API | async přepis souborů a cílově realtime WebSocket přepis |
| OpenAI API / Gemini API | AI zpracování transcriptů přes server-side provider adapter |
| Job layer | fronta/worker vrstva pro přepisy, retry a AI processing |
| Webhook endpoints | příjem stavů od providerů, pokud je provider podporuje |

## Datový tok Varianty A

Varianta A je upload existující nahrávky.

```text
Uživatel
-> vybere audio soubor
-> frontend vytvoří metadata v recordings přes authenticated Supabase klienta
-> audio se nahraje přímo do Supabase Storage
-> recording row přejde do stavu uploaded
-> server-side job vytvoří Soniox async transcription job
-> transcription job běží mimo UI request
-> hotový transcript se uloží do Supabase
-> uživatel spustí AI processing
-> AI output se uloží do Supabase
```

Audio nemá téct přes Vercel API route jako hlavní upload cesta.

Aktuální implementace používá authenticated Supabase browser klienta a RLS policies pro přímý resumable upload do private bucketu. Adaptér `tus-js-client` posílá soubor po 6 MiB částech na Supabase Storage TUS endpoint, při každém requestu obnoví access token a nikde nepoužívá service-role klíč. Manuálně vybrané soubory se zpracují sekvenčně, takže průběh a zrušení patří vždy právě jednomu aktivnímu souboru; zrušení přeruší TUS upload a pokusí se řádek nahrávky označit jako `failed`.

Server-side endpoint `POST /api/recordings/{recordingId}/transcription` vytvoří Soniox async job pro nahrané audio. Endpoint si přes service role vytvoří krátkodobou signed download URL k objektu v private bucketu a tu předá Soniox API jako `audio_url`. Pro velmi dlouhé nahrávky je cílově robustnější přechod na Soniox Files API nebo worker, aby stažení audia nebylo závislé na expiraci signed URL.

Endpoint `GET /api/recordings/{recordingId}/transcription` polluje Soniox stav, aktualizuje `transcription_jobs` a při dokončení uloží text a tokeny do `transcripts`.

Stejný `POST` endpoint podporuje manuální restart přes `?restart=1`. Restart ověří vlastníka, lokálně označí běžící staré transcription joby jako `cancelled`, založí nový Soniox async job ze stejného uloženého audio souboru a teprve po přijetí nového provider jobu smaže aktuální `transcripts` řádky pro nahrávku. Navázané AI joby/výstupy se odstraní kaskádově přes FK. Staré dokončené joby zůstávají v DB kvůli historii usage.

Při uložení async i realtime přepisu aplikace ukládá do `transcripts.segments` tokeny vrácené Sonioxem a do `transcripts.speakers` odvozený seznam detekovaných speaker ID. Obchodní role `Klient` vs. `Dodavatel / náš tým` se z diarizace nepozná automaticky; výchozí role je proto `unknown` a UI ji ukazuje jako nepřiřazenou. Uživatel může v detailu přepisu ručně doplnit jméno mluvčího a jeho obchodní roli. Tyto údaje se ukládají zpět do `transcripts.speakers` bez změny původních Soniox tokenů.

## Datový tok Varianty B

Varianta B je nahrávání přímo v aplikaci.

### B1 Standard recording

```text
Uživatel
-> klikne na nahrávání
-> browser nahrává přes MediaRecorder
-> po ukončení vznikne audio Blob
-> audio se uploaduje do Supabase Storage
-> další tok je stejný jako Varianta A
```

Tento režim je povinný cílový režim.

### B2 Realtime transcription

```text
Uživatel
-> spustí realtime nahrávání
-> browser otevře mikrofon
-> audio stream jde přes bezpečný realtime mechanismus do Soniox
-> segmenty se průběžně zobrazují a ukládají
-> po ukončení vznikne finální transcript
-> AI processing běží nad finálním transcript
```

Realtime je cílová schopnost. Datový model a UI stavy s ní musí počítat, i když implementace přijde až po standardním nahrávání.

Aktuální realtime implementace používá Soniox Web SDK v browseru a server-side endpoint pro vydání krátkodobého `transcribe_websocket` klíče. Hlavní `SONIOX_API_KEY` nikdy nejde do frontendu. Live karta nabízí dva režimy ukládání: `Audio do {live limit} + přepis`, kde browser zároveň nahrává lokální audio přes MediaRecorder a po ukončení ho uloží do private Supabase Storage, a `Jen live přepis`, kde se do Supabase ukládá text bez audio objektu. Oba live režimy zakládají `recordings` draft hned při startu a průběžně ukládají partial transcript přes `PUT /api/recordings/{recordingId}/live-draft`.

Živou browserovou relaci vlastní `PersistentRecordingSessionProvider` v root layoutu. Stránka `/recordings/new` poskytuje pouze plnou zobrazovací pozici a konfiguraci; při interní navigaci se stejná instance rekordéru přesune do globálního mini panelu, takže MediaStream, MediaRecorder, timer, Wake Lock i Soniox session zůstávají připojené. Návrat na capture stránku přesune stejné ovládání zpět bez restartu relace. Interní navigace proto live záznam nezastavuje, zatímco reload, zavření panelu, odchod mimo aplikaci a odhlášení zůstávají chráněné potvrzením. Tato architektura není background recording po zavření nebo uspání browseru.

Live recorder dovolí označit důležitý moment v plném capture pohledu i v kompaktním persistentním docku. Marker je připravený teprve tehdy, když patří stále aktuální Soniox session, capture skutečně přešel do aktivního stavu a existuje uložený `recordings` draft. V tom okamžiku se jednou uloží monotónní počátek z `performance.now()`. Offset markeru je zaokrouhlený rozdíl proti tomuto počátku, omezený na `0..86400000` ms; nepoužívá wall clock ani UI timer.

Každý nový marker pokus dostane klientské UUID a payload `important` / `note = null`. `POST /api/recordings/{recordingId}/markers` ukládá marker přes authenticated Supabase session a RLS. Neúspěšný request nemění capture stav a ponechá přesně stejný UUID, offset, typ i poznámku pro retry; až přesně potvrzená response pokus uzavře. Chyba markeru proto nesmí zastavit MediaRecorder, Soniox session, timer ani následný stop.

Recorder lifecycle odděluje identitu startovací session, okno pro finální Soniox result a vlastníka stop operace. Stará provider callback data, marker response nebo stop settlement nesmí zasáhnout novější session. Při stopu se result okno ponechá otevřené jen po dobu graceful Soniox `stop()`, aby se uložily finální tokeny, a potom se uzavře. Pokud `recordings` draft ještě vzniká, stop na něj čeká nejvýše 5 sekund. Pozdní audio-backed draft se označí jako failed jen pro přesný původní řádek; u transcript-only stopu s již dostupným textem se přesný pozdní draft dokončí na pozadí bez vytvoření fallback duplicitního záznamu. Každý další krok finalizace znovu ověřuje stejného stop ownera a generation.

Limit ručního uploadu je vždy aktuální `recordings.file_size_limit` bucketu. Live audio má samostatnou produktovou politiku: používá nižší z hodnot bucketu a 128 MiB. Proto placený bucket dovolí větší ruční soubory, ale live audio se nad 128 MiB neukládá. MediaRecorder vytváří jeden finální Blob; aplikace proto neprezentuje live limit jako paměťový strop. Velikost průběžně jen odhaduje z bitrate a audio bezpečně ukončí už před limitem s rezervou 5 %, nejvýše 2 MiB. Po `stop()` ověří skutečnou velikost Blobu proti plnému live limitu. Když se audio nezachová, Soniox realtime přepis pokračuje až do ručního zastavení. Pokud audio projde kontrolou, uloží se jako `{user_id}/{recording_id}/live/recording.<ext>` a `recordings.storage_path` ukazuje přímo na tento objekt. `/live-transcript` zapisuje finální transcript idempotentně, aby opakované nebo částečně selhané uložení nenechalo v DB jen `realtime done` job bez řádku v `transcripts`. Live recorder nemá časový ani tichý auto-stop.

Pokud live stránka skončí bez běžného stopu, `/recordings` načítá recovery panel přes `GET /api/recordings/recoverable`. Endpoint vrací jen bezpečná metadata o uložených Storage objektech a délce draft transcriptu, nikdy celý transcript text. Nové live audio se uploaduje až po běžném stopu, takže po pádu stránky je obvykle obnovitelný jen poslední autosave přepisu. Starší segmentované nahrávky zůstávají podporované: pokud jejich Storage části existují, recovery je může dokončit jako audio záznam pro následný async přepis.

Vedle audia a live nahrávání aplikace podporuje import hotového přepisu bez audio souboru. Uživatel může text vložit ručně nebo nahrát `.txt`, `.md` či `.docx` soubor; starý binární `.doc` se nepřijímá. Endpoint `POST /api/recordings/import-transcript` ověří běžnou Supabase session, vytvoří dokončený `recordings` řádek se `source_type = realtime`, `storage_path = null` a uloží `transcripts.raw_text` přes service role. Nevytváří `transcription_jobs`, protože neproběhl Soniox provider job; AI zpracování dál běží nad uloženým transcript řádkem.

## Stavový model

`recordings.status`:

- `created`
- `uploading`
- `uploaded`
- `transcribing`
- `completed`
- `failed`
- `deleted`

`transcription_jobs.status`:

- `queued`
- `running`
- `done`
- `failed`
- `cancelled`

`ai_processing_jobs.status`:

- `queued`
- `running`
- `done`
- `failed`
- `cancelled`

## Cílové tabulky

Aktuální zdroj pravdy pro nový Supabase projekt je baseline migrace `supabase/migrations/20260617000000_initial_schema.sql`. SQL vytváří public tabulky, enumy, indexy, forced RLS, private Storage bucket `recordings`, storage policies a finální systémové prompt templates. Existující produkční Supabase projekt může mít historicky jiné položky v `supabase_migrations.schema_migrations`; rozhodující je, aby aktuální schema odpovídalo baseline.

### recordings

- `id uuid`
- `user_id uuid`
- `title text`
- `source_type text`
- `storage_path text`
- `mime_type text`
- `duration_seconds integer`
- `file_size_bytes bigint`
- `status text`
- `retention_policy text`
- `created_at timestamptz`
- `updated_at timestamptz`

`source_type` podporuje `upload`, `in_app_recording` a `realtime`.

### transcription_jobs

- `id uuid`
- `recording_id uuid`
- `provider text`
- `provider_job_id text`
- `mode text`
- `status text`
- `error_message text`
- `started_at timestamptz`
- `completed_at timestamptz`

`provider` je výchozí `soniox`. `mode` podporuje `async` a `realtime`.

`provider_config jsonb` ukládá bezpečná nastavení provider requestu, například Soniox model, jazykové hinty, diarizaci a zdroj audia. Neukládá API klíče.

### transcripts

- `id uuid`
- `recording_id uuid`
- `user_id uuid`
- `language text`
- `raw_text text`
- `segments jsonb`
- `speakers jsonb`
- `confidence numeric`
- `created_at timestamptz`

### recording_markers

Source-only forward migrace `20260804120000_add_recording_markers.sql` definuje marker s klientským UUID, recording/user vazbou, offsetem, typem, volitelnou poznámkou a timestampy. Povolené typy jsou `important`, `task`, `decision` a `follow_up`. Unikátní `(user_id, client_marker_id)` zajišťuje retry idempotenci; kompozitní FK `(recording_id, user_id)` zajišťuje vlastnictví a cascade při smazání nahrávky. Tabulka ještě není DB-ověřený runtime stav, protože migrace nebyla aplikována.

### ai_processing_jobs

- `id uuid`
- `transcript_id uuid`
- `user_id uuid`
- `provider text`
- `model text`
- `processing_type text`
- `prompt_id uuid`
- `status text`
- `input_token_count integer`
- `output_token_count integer`
- `created_at timestamptz`

### ai_outputs

- `id uuid`
- `processing_job_id uuid`
- `transcript_id uuid`
- `output_text text`
- `output_json jsonb`
- `created_at timestamptz`

`ai_outputs` zůstává auditovatelný raw výstup AI provideru. Po uložení JSON výstupu aplikace vytváří odvozené pracovní projekce v normalizovaných tabulkách:

- `transcript_tasks` pro checklist úkolů, owner kategorii, termín, stav a důkaz,
- `transcript_chapters` pro obsahovou časovou osu,
- `transcript_decisions` pro rozhodnutí a potvrzení,
- `transcript_risks` pro rizika a blokery.

Tyto tabulky mají vlastní `user_id`, RLS a cascade vazbu na `ai_outputs`. Smazání AI výstupu proto odstraní i odvozené pracovní řádky, ale usage metadata v `ai_processing_jobs` zůstávají.

### prompt_templates

- `id uuid`
- `user_id uuid nullable`
- `name text`
- `processing_type text`
- `prompt_text text`
- `output_schema jsonb`
- `is_system boolean`
- `created_at timestamptz`

### audit_logs

- `id uuid`
- `user_id uuid`
- `action text`
- `entity_type text`
- `entity_id uuid`
- `metadata jsonb`
- `created_at timestamptz`

Audit logy nesmí obsahovat celé transcript texty, audio obsah ani plné AI výstupy.

## AI processing engine

AI processing se spouští nad dokončeným transcript.

Workflow:

```text
transcript completed
-> uživatel zvolí processing type nebo custom prompt
-> systém vytvoří ai_processing_job
-> worker načte transcript a prompt template
-> worker zavolá vybraný AI provider API
-> JSON výstup se parsuje, pokud ho provider vrátí jako JSON
-> ai_output se uloží do DB
-> strukturované položky se odvodí do transcript_tasks / transcript_chapters / transcript_decisions / transcript_risks
-> job přejde do done nebo failed
```

`output_schema` je aktuálně kontrakt pro prompt a provider request. Striktní JSON Schema validace před uložením zatím není aktivní gate; pokud se doplní, musí být napojená do AI workeru a testovaná pro OpenAI i Gemini odpovědi.

Systémové AI prompty jsou uložené v `prompt_templates` jako `is_system = true` a `user_id = null`. Uživatelé je mohou číst, ale nemohou je měnit. Vlastní uživatelské prompty mají `is_system = false` a `user_id = auth.uid()`. Systémové prompty rozlišují business roli mluvčích, pokud je dostupná z transcriptu nebo metadata: klient/zákazník (`client_customer`), dodavatelský nebo interní tým (`delivery_team`) a neznámá role (`unknown`). Číselné štítky mluvčích ze Soniox diarizace samy o sobě nestačí k přiřazení role. Endpoint AI processingu proto do `metadata` vždy přidává `speaker_context` odvozený z `transcripts.speakers`, aby prompt mohl použít ručně uložená jména a role mluvčích. Do `{{segments}}` se neposílá plný Soniox token-level JSON; backend ho před provider voláním kompaktně převádí na speaker utterances s časem, mluvčím a textem, aby dlouhé cally nepřekročily token limity providerů. Renderer promptů zároveň podporuje explicitní placeholdery `{{raw_text}}`, `{{segments}}`, `{{speakers}}`, `{{metadata}}` a zpětně kompatibilní aliasy `{{transcript_text}}`, `{{transcript}}` a `{{transcript_segments}}`.

Strukturované projekce jsou tolerantní k aktuálním i starším prompt kontraktům. Detail nahrávky preferuje uložené `transcript_chapters` pro časovou osu a `transcript_tasks` pro checklist, ale stále umí zobrazit původní `ai_outputs.output_json` jako fallback pro starší výstupy. Běžný uživatel má nad projekčními tabulkami jen čtení a u `transcript_tasks` úzké oprávnění změnit `status`; vytváření a přepis projekcí zůstává server-side přes service role.

## Přehrávání audia a navigace na důkaz

Pro přehrávání browser volá `GET /api/recordings/{recordingId}/audio`; route nejdřív ověří request-scoped Supabase Auth session, potom načte pouze řádek se shodným `recordings.user_id` a teprve pro jeden konkrétní objekt v private Storage bucketu vytvoří signed URL s životností 300 sekund. Raw DB hodnota `recordings.storage_path` se nevrací jako samostatné pole ani metadata, ale Supabase signed URL obsahuje encoded cestu k objektu. Bezpečnost proto nestojí na utajení cesty, nýbrž na auth a ownership kontrole, private bucketu, signed tokenu a jeho krátké expiraci. Pokud by produkční požadavek vyžadoval opaque path secrecy, bylo by nutné médium doručovat přes vlastní media proxy.

`Cache-Control: private, no-store` platí pro JSON envelope této API route, včetně chybových odpovědí; nepopisuje response ani cache metadata samotného Storage média. Uploady aktuálně nastavují Storage `cacheControl` na 3600 sekund. Platnost signed tokenu 300 sekund omezuje možnost nově URL autorizovaně použít, ale sama o sobě nezakazuje cache již staženého audia. Klient signed URL nedává do dlouhodobého aplikačního úložiště a po chybě média ji může načíst znovu nejvýše jedním retry.

Playback eligibility je odvozená pouze z bezpečného serverového metadata kontraktu:

- `single`: `storage_path` ukazuje na jeden konkrétní objekt; player se vyrenderuje a smí seekovat/přehrát,
- `none`: audio objekt neexistuje; transcript a navigace zůstávají dostupné bez playeru,
- `segmented`: legacy `storage_path` končí `/live/`; segmenty zůstávají čitelné pro recovery/retranscription, ale detail je nepřehrává jako jeden soubor.

Načtení detailu, změna tabu ani background fetch nevytváří play intent. Ten vzniká jen přímým uživatelským kliknutím na čas transcriptu nebo akci `Otevřít v přepisu`; podle připravenosti média se skutečné `play()` provede okamžitě, nebo se tento explicitní intent flushne po `loadedmetadata`. Ani druhý případ není autoplay. Bez eligible single audia stejná akce pouze přepne tab, scrollne a zvýrazní transcript.

Karta `Časová osa` zobrazuje sekci `Označené momenty` před AI kapitolami, stabilně podle `offset_ms` a potom `id`. Detail načítá všechny markery jedné nahrávky jedním RLS dotazem paralelně s nahrávkou a transcripty, ne N+1 dotazy. Bez aktivního transcriptu zůstávají marker řádky čitelné, ale navigační tlačítka jsou disabled a neslibují přehrání. S transcriptem přímý klik odmítne cizí `recordingId` nebo `transcriptId`, zvolí deterministicky blok obsahující čas markeru nebo nejbližší blok a provede jeden scroll/highlight. Pouze `single` audio dostane jeden seek a click-initiated play; `none` a legacy `segmented` zůstanou transcript-only bez audio fetch/seek/play.

Čas důkazu se nebere z providerem navržených milisekund. Server normalizuje quote přes Unicode NFC, český locale case folding, whitespace a Unicode punctuation, ale zachovává diakritiku, symboly a compatibility znaky. Přijme jen jeden přesný souvislý whole-token match v plných uložených `transcripts.segments`; opakovaný, částečný, nesouvislý nebo timestampově neúplný match vrátí `null`. Nové ověřené rozsahy se odvozují až po uložení raw `ai_outputs` a před označením AI jobu jako `done`.

Staré task/decision řádky s quote a nulovými časy získají při renderu pouze odvozenou runtime kopii lokace; risk ji získá jen tehdy, když má quote. Tato kopie nemění server props a nic nepersistuje. Nejednoznačný legacy quote zůstane textem bez falešné akce. Pro highlight se preferuje speaker block obsahující celý rozsah, jinak block vlastnící `startMs` v polouzavřeném intervalu `[start, end)`, takže přesná hranice patří novému bloku. Když renderovatelný block neexistuje, single audio stále seekne na přesný čas, ale UI nevytvoří falešný anchor ani highlight.

Forward migrace `20260804100000_add_evidence_locations.sql` přidává evidence ranges k tasks, decisions a risks a quote k risks. Forward migrace `20260804120000_add_recording_markers.sql` přidává marker tabulku, index, FK/cascade, granty a forced owner RLS. Obě jsou v této fázi pouze v source, nebyly parsované ani aplikované v disposable, staging nebo live DB a neproběhl skutečný dvouuživatelský RLS integration test. Deploy aplikačního kódu s novými evidence insert/select kontrakty nebo s `recording_markers` je blokovaný do explicitně schváleného apply a postflight kontroly skutečných sloupců/tabulky, constraintů, indexu, FK/cascade, grantů, forced RLS a cross-user izolace.

## Bezpečnost

- RLS na všech uživatelských tabulkách.
- Aplikace má interní login přes Supabase Auth; registrace není vystavená v UI.
- Private storage bucket pro audio.
- Signed upload/download URLs s krátkou expirací.
- Provider API keys pouze server-side.
- Žádné raw transcripty ve Vercel logs.
- Mazání musí zahrnovat DB záznamy i storage objekty.
- Realtime musí používat krátkodobé credentials nebo secure relay, ne hlavní provider key ve frontendu.

## Rozšiřitelnost

Provider integrace navrhuj přes adapter vrstvy:

- speech provider adapter: Soniox jako první implementace
- AI provider adapter: OpenAI jako výchozí implementace, Gemini jako volitelný provider
- storage adapter: Supabase Storage jako první implementace
- job adapter: zvolený queue/worker mechanismus jako vyměnitelná vrstva

## Aktuální pracovní plocha

Vosio má PWA manifest, PNG/SVG app ikony a lehký service worker, takže produkční HTTPS deployment je připravený k instalaci na mobil přes browserové instalační flow. Service worker zatím necachuje aplikační requesty, aby se neriskovala zastaralá auth/session data nebo staré stavy uploadu a přepisu.

Na desktopu používá workspace levý sidebar a full-bleed pracovní plochu přes celý viewport. Sidebar obsahuje primární navigaci, akci `Nová nahrávka`, malou ikonu přepínače světlého/tmavého režimu vedle značky Vosio, dobrovolný externí odkaz `Kup mi kafe` a účet uživatele. `Dokumentace` je sekundární odkaz u spodní části sidebaru přímo nad support odkazem a kartou účtu, aby nepůsobila jako běžná pracovní sekce. Sidebar neobsahuje duplicitní seznam nahrávek ani storage kartu; nahrávky patří do hlavní stránky `/recordings`. Na mobilu se sidebar schová a navigace je dostupná přes spodní fixed navigaci se safe-area paddingem; dokumentace tam zůstává dostupná, protože mobilní layout nemá spodní účetovou kartu.

Přepínač světlého a tmavého režimu je v desktopovém sidebaru jako icon-only akce v brand řádku. Volba se ukládá do `localStorage` i cookie `vosio-theme` a nastavuje `data-theme` na kořenovém `<html>` elementu. Cookie se čte už v serverovém layoutu, aby světlý režim po refreshi nezačínal krátce tmavým fallbackem.

Při live nahrávání se aplikace pokusí získat Screen Wake Lock, aby prohlížeč zbytečně neuspával aktivní capture workflow. Wake Lock je best-effort webová ochrana; pokud systém uspí počítač, prohlížeč, tab nebo PWA, může přerušit mikrofon nebo WebSocket i na desktopu. Po návratu aplikace do popředí se realtime Soniox session pokusí reconnectnout, ale během aktivního nahrávání je odolným bodem jen poslední uložený draft transcript. Manuální upload respektuje celý aktuální limit bucketu; live audio však může vytvořit finální objekt jen po běžném stopu v limitu `min(bucket, 128 MiB)`, s předčasným odhadem s rezervou a následnou kontrolou skutečné velikosti Blobu.

Workspace po přihlášení načítá reálná Supabase data přes RLS, ale routy mají úzké datové kontrakty. `/recordings` načítá jen seznam nahrávek, utility stránky jako `/settings`, `/templates`, `/trash` a `/documentation` netahají transcripty ani AI výstupy, pokud je samy nezobrazují. Detail `/recordings/[recordingId]` načítá pouze jednu nahrávku, její markery, transcript a AI výstupy k tomuto transcriptu. Markery se načtou jedním cíleným dotazem pro recording, ne per-row N+1. Dlouhé `raw_text`, `segments` a `output_json` payloady nesmí být součástí běžného shell/list přepínání.

Upload audio souboru vytvoří řádek v `recordings`, resumable TUS upload uloží soubor do private Storage bucketu `recordings` pod cestu `{user_id}/{recording_id}/{filename}` a aktualizuje stav na `uploaded`. UI zobrazuje aktuální soubor, jeho průběh i celkový byte-weighted průběh fronty; při úspěšném dokončení souboru se může zahájit další, nikdy ne paralelně.

Akce `Nová nahrávka` vede na samostatnou pracovní kartu `/recordings/new` se třemi vstupními režimy: upload existujícího audio souboru, live nahrávání přes mikrofon a import hotového textového přepisu. Obrazovka je kompaktní capture workspace, ne hero stránka. Live režim má caption plochu pro průběžné titulky z realtime přepisu, umí seskupovat live tokeny podle mluvčích, pokud je Soniox vrací, a má přepínač ukládání `Audio do {live limit} + přepis` / `Jen live přepis`. Live titulky se zobrazují s krátkým zpožděním, aby se partial realtime tokeny od Sonioxu stabilizovaly; uložený finální transcript dál vychází ze všech přijatých tokenů, ne jen ze zpožděného caption pohledu. Upload přijímá Soniox async formáty `aac`, `aiff`, `amr`, `asf`, `flac`, `m4a`, `mp3`, `ogg`, `wav`, `webm` a `mp4`. MP4 se může ukládat jako `video/mp4`, ale v aplikaci se dál chová jako nahrávka určená pro Soniox async přepis. Server-only `getRecordingStorageConfig()` čte přes admin klienta explicitní `file_size_limit` bucketu `recordings` a předává ho klientským komponentám; aplikace neodhaduje tarif. Live nahrávání pod vlastním limitem ukládá jeden finální objekt do private Storage; když se audio ukončí dříve kvůli rezervě nebo neprojde finální kontrolou, pokračuje jen přepis. Pokud limit nelze načíst, audio cesty jsou vypnuté a textové cesty zůstávají dostupné. Režim `Jen live přepis` neukládá audio soubor, takže se ho Storage limit netýká; partial transcript se v obou režimech ukládá průběžně do `transcripts`, aby šel záznam obnovit z `/recordings`. Server dál umí číst a znovu přepsat starší segmentované live nahrávky.

Během aktivního live záznamu nebo uploadu UI chrání běžné kliknutí na interní odkaz, označený navigační submit a zavření či reload stránky. Potvrzení je společné pro více aktivních operací a po zrušení akce nenechá navigaci pokračovat. Pro Back/Forward App Router nenabízí spolehlivý intercept bez křehkého history hacku; tato cesta proto zůstává vědomě mimo ochranu a důležitý stav se průběžně ukládá. Stavové zprávy pro průběh, Wake Lock a realtime připojení mají oddělenou sémantiku, aby ztracený Wake Lock nebyl prezentován jako ukončené nahrávání.

Transcript panel načítá uložené `transcripts` z Supabase. Pokud je přepis hotový, zobrazí uložený text; pokud uložené `segments` obsahují Soniox tokeny s polem `speaker`, karta `Přepis` seskupí navazující tokeny do jedné řádkované tabulky se sloupci čas, mluvčí a text. Každý mluvčí má stabilní barevný štítek, může mít ručně zadané jméno a roli a dlouhý transcript se roluje uvnitř transcript tabulky, ne přes celou stránku. UI nepoužívá jednotlivé rozbalovací mini-tabulky pro každý speaker úsek. Pokud není přepis hotový, panel ukazuje stav podle `recordings.status`. U stavu `transcribing` detailová stránka každých zhruba 15 sekund volá `GET /api/recordings/{recordingId}/transcription` s `cache: "no-store"`, aby aktualizovala Soniox job a po dokončení uložila transcript. Toto je foreground polling v otevřeném prohlížeči; cílový webhook nebo worker zůstává samostatná robustnější orchestrace.

Detail nahrávky má kompaktní header s názvem, stavem, datem, délkou, velikostí, zdrojem a akcemi. Metadata jsou malé inline chipy vedle názvu, aby header nezabíral vertikální místo. Editor názvu v detailu i editor názvu v seznamu používají scope a revision kontrakt: během ukládání zůstávají otevřené a blokují dismiss i další submit, po potvrzeném úspěchu se zavřou a vrátí focus na trigger, při chybě zůstanou otevřené s rozepsanou hodnotou a inline alertem. Úspěch oznamuje persistentní `aria-live` mimo zavíranou plochu a rezervovaný feedback slot brání skoku výšky při chybě nebo retry. Organizace nahrávek do klientů, projektů, složek a štítků je zatím pouze plánovaná; její budoucí kompaktní editory musí tento kontrakt znovu použít.

Pod headerem jsou client-side záložky `Přepis`, `AI zpracování`, `Časová osa` a `Soubory`. Aktivní záložka se pamatuje per recording přes browser storage i cookie, aby refresh serverově vyrenderoval rovnou poslední pracovní tab bez viditelného přeskoku. `AI zpracování` spouští server-side provider adapter nad hotovým transcriptem přes uložené `prompt_templates`; uživatel volí pouze model z aktuálního katalogu. `gpt-5.6-terra` se volá s reasoning `high`, `gpt-5.6-luna` s `xhigh` a `gemini-3.6-flash` s thinking `medium`. Tyto modely nepoužívají uživatelskou `temperature`. Výsledek se ukládá do `ai_processing_jobs` a `ai_outputs` a po refreshi se zobrazuje v detailu nahrávky. AI tab je jeden vertikální pracovní tok: nahoře nastavení a rychlé akce, pod tím normalizované pracovní výstupy a sbalené output cards s krátkým preview, kopírováním, Markdown exportem, smazáním a u e-mailu po hovoru `mailto:` akcí. Checklist úkolů se seskupuje podle owner kategorie a změna stavu úkolu probíhá optimisticky přes úzký JSON endpoint bez redirectu, aby uživatel zůstal ve stejné pozici v dlouhém checklistu. Důkaz z přepisu je kompaktní disclosure uvnitř existující owner skupiny a raw markdown artefakt se automaticky nerozbaluje, pokud existují strukturované projekce. Checklist má vlastní rychlé akce `Kopírovat` a `MD`, které exportují jen pracovní checklist bez celého transcriptu a bez ostatních AI výstupů. Při opakovaném generování se pracovní checklist deduplikuje podle ownera, názvu a termínu, aby dvě podobné AI generace nevytvořily duplicitní položky; smazání checklistu smaže zdrojové AI výstupy a navázané projekce. Běžící AI generování se ukazuje přímo v tabu a stejný typ výstupu lze spustit znovu i během předchozího běhu.

Karta `Časová osa` zobrazuje nejdřív uživatelské `Označené momenty` a pod nimi obsahovou AI časovou osu, ne technický seznam segmentů po sekundách. Processing typ `timeline_chapters` vytváří kapitoly hovoru s časovým rozsahem, názvem, shrnutím, mluvčími a navázanými úkoly nebo rozhodnutími. Pokud AI kapitoly ještě nejsou vytvořené, tab nabízí přechod do AI zpracování, ale uložené markery zůstávají dostupné. Technické `segments` zůstávají zdrojová data pro Soniox diarizaci, marker navigaci a časování.

Stránka `/settings` ukládá netajné uživatelské preference do Supabase Auth `user_metadata.vosio_settings`. Tato metadata jsou pouze preference, nesmí se používat pro autorizaci. Patří sem výchozí AI model s orientační cenou, jazyk výstupu, Soniox realtime model, automatické AI výstupy, retence audia a upozornění na dlouhou nahrávku. Aktuální katalog obsahuje pouze `gpt-5.6-terra`, `gpt-5.6-luna` a `gemini-3.6-flash`; staré uložené OpenAI modely se migrují na Terra a staré Gemini modely na Gemini 3.6 Flash. Gemini vyžaduje `GEMINI_API_KEY`. EU region, API klíče, Supabase projekt, storage bucket a bezpečnostní limity zůstávají systémové hranice řízené kódem nebo Vercel env.

Nastavení zároveň zobrazuje read-only usage souhrn pro aktuální měsíc. Souhrn se počítá přes authenticated Supabase klienta a RLS z existujících tabulek `ai_processing_jobs`, `transcription_jobs` a `recordings`; nevyžaduje samostatnou billing tabulku ani migraci. AI cena je orientační výpočet z uložených `input_token_count`, `output_token_count` a lokální mapy cen pro model uložený v `ai_processing_jobs.model`. Pokud job nemá tokeny nebo model nemá lokální cenu, UI to označí jako neúplný odhad. Soniox cena je orientační výpočet z dokončených Soniox STT jobů a známé délky nahrávky. Async přepis se počítá jako přibližně $0.10/h, realtime jako přibližně $0.12/h. Joby bez známé délky se do ceny nezapočítají a UI ukáže coverage; zdroj pravdy pro fakturaci zůstává provider dashboard.

Stránka `/recordings` je čistý seznam nahrávek. Řádek nahrávky se otevírá kliknutím na hlavní část řádku a tlačítko `Otevřít` se nepoužívá. Název nahrávky lze upravit přímo v seznamu přes malý ukotvený editor v akčním sloupci; editor neroztahuje řádek, kliknutí uvnitř něj neotevírá detail nahrávky a zavře se až po potvrzeném uložení. Změna se zapisuje přes authenticated Supabase klienta a RLS. Nad seznamem se zobrazí recovery panel, pokud existují nedokončené live drafty s uloženým partial transcriptem nebo audio segmenty. Seznam má URL parametr `q` pro lehké serverové hledání v metadatech nahrávky: název, stav, zdroj a MIME typ. Fulltext přes `transcripts.raw_text` se nemá přidávat jako neindexovaný scan; patří do samostatné FTS/RPC vrstvy. Nahrávku lze přes samostatné tlačítko koše soft-smazat do stavu `deleted`; tím zmizí z hlavního seznamu a objeví se na `/trash`. Koš podporuje trvalé smazání přes server action, která ověří vlastníka, odstraní soubor ze Storage bucketu `recordings` a poté smaže DB řádek; související přepisy, joby a AI výstupy se mažou kaskádou. Mazání v UI vždy vyžaduje potvrzení a po potvrzení se řádek nebo karta optimisticky schová ještě před doběhnutím server action.

Detail nahrávky obsahuje export menu místo placeholder tlačítka nastavení přepisu. Export běží lokálně v browseru a umí stáhnout nebo zkopírovat Markdown pro celou nahrávku, pracovní balíček, samotný přepis nebo vybraný AI výstup. Pracovní balíček spojuje metadata, transcript, raw AI výstupy a normalizované pracovní projekce: checklist úkolů, kapitoly časové osy, rozhodnutí a rizika. Uložené AI výstupy mají vlastní akce pro kopírování, Markdown export a smazání. Follow-up e-mail výstup navíc nabízí `mailto:` odkaz, který předá draft výchozímu mail handleru uživatele.

Aktivní aplikační routy po přihlášení jsou:

- `/` přesměruje přihlášeného uživatele na `/recordings`,
- `/recordings` pro seznam nahrávek,
- `/recordings/new` pro samostatnou kartu nové nahrávky s uploadem a live titulky,
- `/recordings/[recordingId]` pro detail vybrané nahrávky,
- `/ai` pro uložené AI výstupy,
- `/templates` pro systémové a uživatelské prompty,
- `/documentation` pro uživatelskou dokumentaci k workflow aplikace,
- `/settings` pro netajné uživatelské preference,
- `/trash` pro soft-smazané nahrávky.

Stránka `/templates` odděluje vlastní prompty od systémové knihovny. Vlastní prompty jsou editovatelné formuláře ukládané přímo do `prompt_templates` pod `user_id`. Systémové prompty se zobrazují jako read-only formuláře; uživatel z nich může založit vlastní kopii a tu následně upravit.
