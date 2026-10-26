# Architecture

Invitation email configuration is versioned in `supabase/templates/`, shared by
local CLI Auth and the explicit hosted `setup:auth` installer. It preserves the
direct application-token plus email-OTP contract; SQL migrations do not configure
hosted Auth. [Installation and upgrade](api/invitation-email-setup.md).

## Tým a oprávnění

Tým používá variantu A se seznamem osob a detailem přístupů; na mobilu patří pod Více. Server každé chráněné stránky načítá aktuální `team_authority_v1` pro navigaci. Samotná stránka i API vynucují roli a rozsah znovu. Správce instalace má výslovný privátní registr bez bootstrapu; zakladatel spravuje své projekty. Seznam je osobní, nikoli globální Auth adresář, a role správce nedává implicitní přístup k cizímu obsahu.

Klientské a složkové granty dynamicky rozšiřují původní kanonický recording resolver o současné a budoucí nesoukromé nahrávky. Soukromé se vždy vynechají. Pevná projektová hranice, aktuální autorita autora grantu a původní sharing lock chrání přesuny a revokace. Pozvánky všech čtyř rozsahů používají stávající token/delivery/accept tok. Čekající pozvánka není aktivní grant. Kontrakt, preflight a bezpečný návrat: [team-access](api/team-access.md). Nové migrace jsou na skutečných targetech dosud neaplikované.

## Dokončení browser nahrávky a stavy detailu

Stop zahájí navigaci na potvrzený draft ještě před finalizací bezpečnostních částí a uploadem. Dokončení dál vlastní stejný `BrowserRecorder` v root `PersistentRecordingSessionProvider`; navigace jej přesune do docku. Kontext drží pouze ID nahrávky, fázi, bezpečnou stavovou zprávu a potvrzení audia. Detail zobrazuje jen odpovídající relaci. Bez serverem potvrzeného draftu zůstává uživatel u okamžitého ukládacího stavu; neotevírá se neexistující detail. Konečné uložení obnoví data aktuální stránky, nevrací uživatele zpět po jeho další navigaci.

Při chybě dokončení s místním přepisem nebo audio blobem provider zachová recorder i po návratu do idle. Dock nabízí stažení a existující obnovu; místní data se uvolní až po úspěšném vyřešení nebo výslovném potvrzení zavření obnovy. Ochrana zavření zůstává aktivní. Transcript-only Stop při draftu čekajícím déle než pět sekund dál vlastní saving generaci až do potvrzení ID; další nahrávání je do jejího ukončení zablokované.

Zablokovaný přepis s aktuální manager capability a přesným operation ID se automaticky dohledává přes existující `transcription/recover` s `action=resume`, nejvýše třikrát s odstupem 30 a 60 sekund. Tato větev nezastavuje operaci ani nepřipravuje nový placený pokus. Nejasný nebo nenalezený provider submit zůstává blokovaný pro výslovné řešení. Platný realtime přepis se použije i při segmentovaném audio archivu; samotný formát archivu není důvod k novému placenému přepisu.

AI a Časová osa čtou společný transcript-scoped seznam serverových jobs. Starší kapitoly zůstávají dostupné při novém explicitním běhu. Již otevřené AI a Chat plochy zachovávají koncepty a volby při přepnutí; změna přepisu vytvoří nové lokální plochy. Skrytý Chat neprovádí polling. Otevření záložky nevytváří ruční AI job.

Inbox i hledání oddělují klienta a projekt. Pojmenovaný editor `Název a zařazení` z nabídky nahrávky spojuje dvě samostatné ukládací sekce; title mutation a atomické organizační RPC zůstávají oddělené. Osobní taxonomie a capability filtry se tím nemění.

## Přehled

Vosio je cílově robustní Next.js PWA pro audio nahrávky, přepisy a AI zpracování. Aplikace je self-hostovatelná v běžném Next.js runtime, používá Supabase pro auth, databázi a storage, Soniox pro speech-to-text a OpenAI API jako výchozí AI provider s volitelným Google Gemini providerem.

Architektura musí podporovat mobil i desktop a nesmí předpokládat, že všechny dlouhé operace proběhnou uvnitř jednoho Vercel requestu.

Seznam nahrávek načítá aktuální oprávnění každé vrácené položky souběžně s organizačními volbami a počty stavů. Detail nejdřív ověří právo číst, potom načítá zařazení hned po získání řádku souběžně s přepisem a ostatními daty. Capture a founder oprávnění projektu se ověřují souběžně; osobní metadata projektu se čtou až po potvrzení founder autority. Tyto úpravy pořadí nepřidávají cache oprávnění ani nemění RLS.

Repo je source-available pod vlastní licencí v `LICENSE.md`. Soukromé a interní použití je povolené, ale placený hosted SaaS/subscription resale nebo white-label prodej vyžaduje písemné povolení. Aplikace obsahuje pouze pasivní license marker v HTML metadatech; neposílá žádný skrytý tracking ani licenční beacon.

## Hlavní komponenty

Veřejný zdroj obsahuje celou aplikaci, 41 migrací, Supabase Function `vosio-mcp`,
webové OAuth/consent/discovery adaptéry a univerzální Codex plugin. Každá instalace
používá vlastní Supabase projekt a kanonický HTTPS webový origin. Osobní OAuth
bridge vydává opaque resource-bound tokeny se scopes `vosio:read`/`vosio:write`;
obsah čte ověřený user JWT přes aktuální RLS a canonical capabilities. Credentials
a tokenová custody zůstávají serverové. `verify_jwt=false` na gateway nenahrazuje
autentizaci handleru. Dynamic registration přijímá `native|web`, PKCE S256 a přesné
HTTPS nebo loopback callbacky. Úzký katalog má 11 nástrojů bez placené AI či mazání.

MCP zůstává disabled-first. Správce nasadí migrace, web a Function, nastaví vlastního
confidential OAuth klienta a dva runtime secrets, ověří identitu a výslovně aktivuje.
Uživatel veřejného pluginu zadává pouze adresu svého webu a dokončí osobní přihlášení.
[MCP kontrakt](api/mcp-plugin.md), [plugin](api/vosio-plugin.md),
[český owner setup](../plugins/vosio/SETUP.md).

Source-only sdílený Koš má úzké session mutation RPC a oddělený receipt-bound
Storage worker kontrakt v [shared Trash API](api/shared-recording-trash.md).
Forward `20260922220000` zachovává retenční worker a zavádí atomickou manager
autoritu pro Koš i granular task/output delete. Rollout vyžaduje současnou adopci
T3 volajících a workeru; DB/Storage/race ověření dosud není provedeno.

Pozdější purge repair atomicky zruší přesný vlastní požadavek i tehdy, když první
prepare kvůli zastaralé verzi nevytvořil receipt. Cancellation tombstone zabrání
pozdnímu prepare stejným klíčem. Zahájené/nejisté práce se takto neuvolňují;
nepotvrzené dokončení zachová lokální recovery klíč.

| Komponenta | Úloha |
| --- | --- |
| Next.js PWA | UI, mobilní/desktop přístup, auth flow, krátké API akce |
| Supabase Auth | interní email/password přihlášení a identita uživatele |
| Supabase Postgres | metadata, joby, transcript, AI výstupy, prompty, audit |
| Supabase Storage | private uložení audio souborů a případných exportů |
| Soniox API | async přepis souborů a cílově realtime WebSocket přepis |
| OpenAI API / Gemini API / Mistral API | AI zpracování transcriptů přes server-side provider adapter |
| Job layer | fronta/worker vrstva pro přepisy, retry a AI processing |
| Webhook endpoints | příjem stavů od providerů, pokud je provider podporuje |

## Datový tok Varianty A

Varianta A je upload existující nahrávky.

```text
Uživatel
-> vybere audio soubor
-> frontend vytvoří draft a přesný access scope jedním authenticated RPC
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

Endpoint `POST /api/recordings/{recordingId}/transcription` připraví a zahájí přesnou durable operaci přes session RPC a po potvrzeném startu spustí bounded worker přes Next `after`. Provider POST, podpis konkrétního objektu, polling a finalizaci stále provádí service worker s DB fencing. Nové Soniox joby na nakonfigurovaném HTTPS `NEXT_PUBLIC_APP_URL` dostávají per-job HMAC webhook; callback ověří přesnou DB custody a výsledek čte nezávisle přes provider GET. Session `POST .../transcription/reconcile` probudí jednu jednotku stávající autorizované operace, GET pouze čte stav. Externí Bearer worker zůstává dostupný pro scheduler a recovery. Přepis nemá globální enable přepínač. Přesný kontrakt a provozní limity jsou v [capture API](api/capture-operation-contracts.md).

Endpoint `GET /api/recordings/{recordingId}/transcription` čte bezpečný stav a manager enrichment. Nemění joby, nevolá providera ani nedokončuje přepis; pokračování přijaté operace nezávisí na browser pollingu autora.

Manager recovery `POST .../transcription/recover` ověří přesnou původní Soniox úlohu a naváže její sledování, případně potvrdí bezpečné uzavření před explicitním novým přepisem. Zastavení má service provider proof a následný authenticated manager/snapshot CAS; zachovává audio, text i historii. Zablokovaný stav ukončí automatický browser polling. Definitní odmítnutí submitu se odlišuje od nejistého výsledku POST, který se nesmí opakovat. Viz [capture API](api/capture-operation-contracts.md).

Stejný `POST` používá explicitní `purpose=capture|retry|retranscribe`, request UUID a capture revision. Nové spuštění znovu kontroluje aktuální autoritu. Přijatá async operace může dokončit po revokaci přes přesný job/custody receipt, nikoli obnovením uživatelova přístupu. Nová generace zachová historické přepisy, AI výstupy, joby a intents; legacy destruktivní completion cesta se nepoužívá. Nejasný provider POST se automaticky neopakuje.

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
-> browser otevře mikrofon a ve výchozím desktopovém režimu vyžádá kartu hovoru se zvukem
-> Web Audio smíchá mikrofon a zvuk vybrané karty do jednoho master streamu
-> audio stream jde přes bezpečný realtime mechanismus do Soniox
-> segmenty se průběžně zobrazují a ukládají
-> po ukončení vznikne finální transcript
-> AI processing běží nad finálním transcript
```

Realtime je cílová schopnost. Datový model a UI stavy s ní musí počítat, i když implementace přijde až po standardním nahrávání.

Aktuální realtime implementace používá Soniox Web SDK v browseru a server-side endpoint pro vydání krátkodobého `transcribe_websocket` klíče. Hlavní `SONIOX_API_KEY` nikdy nejde do frontendu. Live karta nabízí přesně tři režimy: `Audio do {live limit} + live přepis`, `Jen audio do {live limit}` a `Jen live přepis`. Zdroj zvuku je samostatná volba: podporovaný desktopový Chrome nebo Edge s Web Audio předvolí `Videohovor: mikrofon + karta`, zatímco nepodporované prostředí zůstane na `Jen mikrofon`. Videohovorový režim přes povinný browser picker získá mikrofon a audio vybrané browserové karty, smíchá je přes Web Audio do jediného master streamu a teprve z něj oddělí vlastněné klony pro kontinuální archiv a Soniox source; rotující safety rekordér používá svůj vlastní klon stejného masteru. Zrušený picker, jiný typ sdílené plochy, karta bez audio stopy, ukončený raw vstup nebo neaktivní AudioContext nikdy tiše nespadne na samotný mikrofon. Dočasné ztlumení každého raw audio vstupu má samostatné UI varování. Ukončení některého raw vstupu během aktivního záznamu spustí bezpečný stop a finalizaci dosavadní nahrávky. Zastavení nebo restart Sonioxu nesmí zastavit archiv. Audio-only vůbec nežádá realtime klíč a async přepis spustí až po potvrzeném uploadu. Combined při terminálním výpadku provideru dál nahrává audio a po jeho potvrzeném uložení spustí restart-safe async přepis. Transcriptové režimy průběžně ukládají partial draft přes `PUT /api/recordings/{recordingId}/live-draft`.

Live Soniox jazyk je samostatná preference od režimu ukládání audia. Nabídka podporuje `auto` (Automaticky), `cs` (čeština), `en` (angličtina), `de` (němčina), `es` (španělština), `it` (italština), `sk` (slovenština), `sl` (slovinština), `hu` (maďarština) a `pl` (polština). `auto` zapíná identifikaci jazyka a neposílá žádné `language_hints`; pevná volba posílá jeden `language_hints` kód s `language_hints_strict = true`. V obou režimech zůstává `enable_speaker_diarization = true`, protože volba jazyka sama o sobě rozpoznávání mluvčích nevypíná. Hint je providerovi pouze preference/omezení podle jeho runtime chování, ne absolutní záruka výsledného jazyka.

Výchozí live jazyk se ukládá jako netajná preference `user_metadata.vosio_settings.sonioxRealtimeLanguage` a při chybějící nebo neplatné hodnotě se použije `auto`. Před startem konkrétního live hovoru lze v plném rekordéru vybrat dočasný jazykový override; po startu se výběr uzamkne pro danou relaci a při návratu na idle se znovu synchronizuje s výchozí preferencí. Toto nastavení platí pouze pro živé mikrofonní nahrávání. Ruční audio upload a jeho Soniox async přepis používají nezměněnou async konfiguraci a live override na ně nepůsobí.

Živou browserovou relaci vlastní `PersistentRecordingSessionProvider` v root layoutu. Stránka `/recordings/new` poskytuje pouze plnou zobrazovací pozici a konfiguraci; při interní navigaci se stejná instance rekordéru přesune do globálního mini panelu, takže MediaStream, MediaRecorder, timer, Wake Lock i Soniox session zůstávají připojené. Návrat na capture stránku přesune stejné ovládání zpět bez restartu relace. Interní navigace proto live záznam nezastavuje, zatímco reload, zavření panelu, odchod mimo aplikaci a odhlášení zůstávají chráněné potvrzením. Tato architektura není background recording po zavření nebo uspání browseru.

Live recorder dovolí označit důležitý moment v plném capture pohledu i v kompaktním persistentním docku. Marker je připravený teprve tehdy, když patří stále aktuální Soniox session, capture skutečně přešel do aktivního stavu a existuje uložený `recordings` draft. V tom okamžiku se jednou uloží monotónní počátek z `performance.now()`. Offset markeru je zaokrouhlený rozdíl proti tomuto počátku, omezený na `0..86400000` ms; nepoužívá wall clock ani UI timer.

Každý nový marker pokus dostane klientské UUID a payload `important` / `note = null`. `POST /api/recordings/{recordingId}/markers` ukládá marker přes authenticated Supabase session a RLS. Neúspěšný request nemění capture stav a ponechá přesně stejný UUID, offset, typ i poznámku pro retry; až přesně potvrzená response pokus uzavře. Chyba markeru proto nesmí zastavit MediaRecorder, Soniox session, timer ani následný stop.

Recorder lifecycle odděluje identitu startovací session, okno pro finální Soniox result a vlastníka stop operace. Stará provider callback data, marker response nebo stop settlement nesmí zasáhnout novější session. Při stopu se result okno ponechá otevřené jen po dobu graceful Soniox `stop()`, aby se uložily finální tokeny, a potom se uzavře. Pokud `recordings` draft ještě vzniká, stop na něj čeká nejvýše 5 sekund. Pozdní audio-backed draft se označí jako failed jen pro přesný původní řádek; u transcript-only stopu s již dostupným textem se přesný pozdní draft dokončí na pozadí bez vytvoření fallback duplicitního záznamu. Každý další krok finalizace znovu ověřuje stejného stop ownera a generation.

Limit ručního uploadu je efektivní minimum explicitního `recordings.file_size_limit` bucketu a případného per-user stropu z volby `auto`, `free` nebo `paid`. Live audio má navíc politiku `min(effective upload limit, 128 MiB)`. Uživatel před startem volí kvalitu `Úsporná` 32 kbit/s, `Vyvážená` 64 kbit/s nebo `Vysoká` 96 kbit/s; UI ukazuje desetinný odhad 14,4, 28,8 nebo 43,2 MB/h. Režim, jazyk i kvalita se po startu zamknou a Soniox používá vlastní nezávislé kódování. Dosažení odhadované hranice ukončí celou generation přes `audio_limit`; audio se nezahodí za běhu a transcript-only režim se tímto limitem neřídí. Po `stop()` se skutečný Blob ještě ověří proti plnému limitu.

Bezpečnostní rekordér každých 15 sekund úplně uzavře samostatný Blob. Každou část nejprve atomicky uloží do IndexedDB a teprve potom ji generation-scoped, bounded a idempotentně nahraje do private Storage. Běžný stop nejprve dokončí poslední část a promotion frontu, potom kontinuální archiv `{user_id}/{recording_id}/live/recording.<ext>` a metadata. Teprve přesné potvrzení tohoto řádku dovolí pořadí remote cleanup -> local cleanup. Když archiv selže a všechny serverové části jsou kompletní, `storage_path` se přepne na segmentovaný prefix `{user_id}/{recording_id}/live/` a spustí se segmentovaný async přepis; local-only části zůstanou v recovery panelu. Selhání kvóty IndexedDB snižuje jen crash protection a nezastaví archiv.

Recovery panel přes `GET /api/recordings/recoverable` slučuje owner-scoped serverová metadata s lokálními manifesty. Nevrací celý transcript a neumí obnovit nic, co browser nestihl uzavřít a persistovat. Selhání STT nesmaže potvrzené audio: recording zůstane `uploaded` s retry. Když selžou všechny audio cesty, finální transcript se nejprve generation-scoped dopersistuje; recording je označen failed až potom a UI nesmí tvrdit, že text je uložený, pokud save nebyl potvrzen.

Jediná platná gramatika části je `part-000000.webm` nebo `part-000000.m4a`, vždy lowercase, šest číslic a index od nuly. Shared validator ignoruje jiné objekty, numericky seřadí platné části a při duplicitě, mixu přípon nebo mezeře fail-closed vrací z recovery či transcription cesty bezpečný konflikt `409`. Provider create failure nebo explicitní terminal failure status selže pouze odpovídající transcription job nebo celý aktuální segmentový batch; recording se vrátí do `uploaded` bez změny audio metadat, takže další explicitní retry založí nový pokus. Přechodná chyba provider poll requestu nebo ukládání jeho průběžného statusu nechá existující job či batch v dosavadním retryable stavu a další poll může pokračovat.

G1 browser evidence potvrdila v Chrome i Edge souběžnou topologii kontinuálního archivu, Soniox source a rotující safety instance včetně odděleného bitrate a event ordering. Do repozitáře se dočasný harness neukládá. Stále nejde o garanci po ztrátě browseru, zařízení nebo OS a před produkčním tvrzením o velmi dlouhé relaci zůstává nutný 100minutový soak.

Vedle audia a live nahrávání aplikace podporuje import hotového přepisu bez audio souboru. Uživatel může text vložit ručně nebo nahrát `.txt`, `.md` či `.docx` soubor; starý binární `.doc` se nepřijímá. Endpoint `POST /api/recordings/import-transcript` kontroluje origin a Supabase session, vytvoří přesný scoped draft přes create RPC a dokončí jej session `import_final` transition s původním requestem a revision. Neprovádí split-check/admin insert. Výsledek má `source_type = realtime`, `storage_path = null`; nevytváří fake provider job. AI zůstává samostatně autorizovaná osobní operace.

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

Níže je zdrojový kontrakt schématu. Stav konkrétní instalace musí správce ověřit
samostatně; aktuální target preflight je brána v sharing runbooku.

Zdroj pravdy pro bootstrap nového Supabase projektu je celý seřazený migrační řetězec, ne samotná baseline: `20260617000000_initial_schema.sql`, potom `20260804100000_add_evidence_locations.sql`, `20260804110000_add_recording_organization.sql`, `20260804120000_add_recording_markers.sql`, `20260804130000_add_transcript_fulltext_search.sql`, `20260810005550_restore_recordings_from_trash.sql`, `20260813000000_add_recording_status_filters.sql`, `20260813090000_add_prompt_overrides_and_job_snapshots.sql`, `20260815073029_harden_prompt_override_privileges.sql`, `20260827094435_add_automatic_timeline_idempotency.sql` a `20260827100000_add_trash_retention_deadlines.sql`, následované všemi pozdějšími forwards až po `20261007100000_vosio_mcp_dynamic_registration.sql`. Úplný kanonický seznam všech 41 migrací je v [Supabase návodu](../supabase/README.md). Baseline vytváří core public tabulky, enumy, indexy, forced RLS, private Storage bucket `recordings`, storage policies a systémové prompt templates; každá novější migrace mění výsledné schema až po svém apply.

### recordings

Následující seznam popisuje výsledný source kontrakt. `client_id`, `project_id` a `folder_id` nejsou součástí baseline a v databázi existují až po aplikaci `20260804110000_add_recording_organization.sql`.

- `id uuid`
- `user_id uuid`
- `title text`
- `source_type text`
- `storage_path text`
- `mime_type text`
- `duration_seconds integer`
- `file_size_bytes bigint`
- `client_id uuid nullable`
- `project_id uuid nullable`
- `folder_id uuid nullable`
- `status text`
- `retention_policy text`
- `created_at timestamptz`
- `updated_at timestamptz`

`source_type` podporuje `upload`, `in_app_recording` a `realtime`.

### Organizace nahrávek

Source-only kontrakt projektového sdílení přidává forward migrace `20260922190000_add_project_sharing.sql`.
Navazující source-only migrace `20260922200000_add_project_sharing_read_paths.sql` připravuje
session RPC pro společný přístupný list, detail, fulltext a stavové facety. Maskuje osobní
taxonomii cizích autorů; přesný selected grant dovolí pouze název projektu u dané nahrávky,
nikoli celý projektový seznam. Koš zůstává omezený na současnou správu obsahu.
Navazující migrace také odebírá přímé čtení projektové vazby a autorského UUID;
projektové ID prochází pouze maskovaným RPC a autorské UUID veřejná projekce nevrací.
Přesná rozhraní, pořadí migrací a dosud neprovedené runtime ověření popisuje
[read contract](api/project-sharing-read-paths.md). Source T3 volající již používají přístupné
RPC; rollout stále blokuje neprovedené DB/Storage/Auth/provider runtime ověření a target preflight.
Source-only aplikační tok pozvánek používá výhradně úzká session RPC, oddělené Auth OTP
ověření a explicitní accept POST. Panely jsou napojené na pracovní plochu pouze přes
server-resolved manageAccess/founder; první emailový příjemce samostatné private nahrávky získá přístup až atomickým
přijetím, které změní pouze přesné pozvané položky na selected. Šablony e-mailů a
izolovaný runtime test zůstávají podmínkou dokončení podle [kontraktu pozvánek](api/recording-invitations.md).
Migrace nejsou aplikované. Read/edit/AI/chat/audio, Koš i capture mají společnou source adopci; samostatný apply není připravený. Aktuální požadavky jsou v [projektovém sdílení](requirements/project-sharing.md), provozní postup v [runbooku](api/project-sharing-runbook.md).
Umožňuje projekty bez klienta, explicitní `private/project/selected`, role reader/editor a správu sdíleného
projektového obsahu zakladatelem. Legacy data zůstávají private. Přesné RPC, custody, concurrency a neprovedené
databázové ověření popisuje [databázový kontrakt sdílení](api/recording-sharing.md). Následující odstavce
popisují organizační tok; osobní taxonomie se sdíleným příjemcům nezobrazuje.

Source kontrakt po sharing forward migraci obsahuje uživatelské klienty/firmy (`recording_clients`), projekty s volitelným klientem, ploché složky bez hierarchie (`recording_folders`) a štítky (`recording_tags`). Nahrávka může mít nejvýše jednoho klienta, projekt a složku, ale libovolný počet štítků přes `recording_tag_links`. Projekt bez klienta je platný. Vazba nahrávky na projekt používá samostatný `project_id`; původní kompozitní `(project_id, client_id, user_id)` už není aktuálním kontraktem. Jde o stav zdrojového checkoutu, nikoli potvrzení live DB.

Osobní klientské, složkové a štítkové vazby nadále používají `user_id` v kompozitních foreign keys. Projektovou autoritu a custody vynucují sharing helpery, triggery a zamykající RPC, nikoli shoda technického autora s founderem. Klientské vazby mají `ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`: běžné smazání klienta s projekty nebo přiřazenými nahrávkami je blokované, ale úplné smazání `auth.users` může v jedné transakci kaskádově odstranit všechny potomky. Smazání projektu vynuluje pouze `recordings.project_id`, smazání ploché složky vynuluje pouze `recordings.folder_id` a smazání nahrávky nebo štítku kaskádově odstraní odpovídající tag links. Názvy jsou po `btrim` unikátní bez ohledu na velikost písmen: klient, složka a štítek v rámci uživatele, projekt v rámci uživatele a klienta; projekty bez klienta mají vlastní částečný unique index v rámci uživatele.

Organizační tabulky mají enabled i forced RLS; sharing forward omezuje projektové grants a přístup podle scope. `assign_recording_organization_v1` zamkne vlastní aktivní private nahrávku, ověří oprávnění capture v cílovém projektu a vlastnictví osobních vazeb a v jedné transakci nahradí klienta, projekt, složku i deduplikovanou sadu štítků. U projektu vlastního foundera zachovává shodu klienta; spolupracovník má osobní taxonomii nezávislou. T3 seznam používá `list_accessible_recordings_v1`, nikoli legacy owner-only seznamy: vrací přesnou přístupnou množinu, osobní metadata pouze vlastníkovi, vybrané štítky interpretuje jako ALL a stránkuje stabilním sestupným keysetem `(created_at, id)`.

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

Detail i fulltext hledání vybírají nejnovější transcript jedné nahrávky deterministicky přes `created_at desc, id desc`. Tím je pořadí stabilní i při shodném timestampu.

### transcript_search_chunks

Forward migrace `20260804130000_add_transcript_fulltext_search.sql` přidává odvozený vyhledávací index přepisů. `transcript_search_chunks` drží po sobě jdoucí speaker bloky se stabilní 1-based pozicí, volitelným `start_ms`/`end_ms`, speaker labelem, textem a uloženým `tsvector` sloupcem s GIN indexem. Kompozitní vazba `(transcript_id, recording_id, user_id)` brání smíchání vlastníků a při smazání transcriptu odvozené řádky kaskádově zmizí.

Aplikační zápisy async, realtime, recovery, importu a změny speaker metadata po uložení transcriptu volají service-only `replace_transcript_search_chunks_v2` s verzí čerstvého uloženého snapshotu, která index atomicky nahradí pouze při shodné `search_version`. Diarizovaný transcript se indexuje po renderovatelných speaker blocích se zachovaným časem. Bez renderovatelných speaker bloků se uloží jediný fallback chunk z `raw_text` bez času; DB trigger stejný raw fallback zachová už v transakci zápisu transcriptu, i když následné přesné indexování selže. Selhání přesného indexu proto nesmaže ani nezneplatní uložený transcript, ale vrátí nefatální one-shot warning. Warning se po vykreslení odstraní z URL pomocí `history.replaceState`, aniž by se zahodily ostatní query parametry nebo vytvořila další položka historie.

`search_accessible_recordings_v1` používá PostgreSQL `websearch_to_tsquery('simple', ...)`, GIN indexy pro transcript chunks i metadata názvů, přidává status filtr a vrací jen jednu nejlépe hodnocenou shodu pro každou přístupnou nahrávku. Bere pouze nejnovější transcript, vylučuje `status = deleted`, zachovává exact access scope a organizační filtry a vrací excerpt, volitelný čas shody a `total_count`. Search UI používá stránkování po 25 výsledcích přes bounded `page` a RPC `limit/offset`; běžný seznam bez `q` dál používá sestupný keyset `(created_at, id)` a servisní backfill používá vzestupný keyset podle transcript `id`.

`count_accessible_recording_statuses_v1` počítá přesné facety aktivních stavů nad celým aktuálním `q`, organizačními filtry a ALL sadou štítků. Facety záměrně ignorují aktivní `status`, aby šlo jedním kliknutím přepnout na jiný stav. `Smazáno` je samostatný úplný počet spravovaných řádků v Koši a vede na `/trash`.

Source UI používá `list_accessible_recordings_v1` bez `q` a `search_accessible_recordings_v1` s neprázdným `q`. Historické owner-only RPC zůstávají v migracích, nikoli v těchto volajících. Nové kontrakty vyžadují koordinovaný rollout celé sharing řady.

Inbox nahrávek volí řádky nebo skládané karty podle skutečné inline šířky panelu, ne jen podle šířky viewportu. Nad 680 px obsahu zůstávají desktopové sloupce s pružným názvem a pevným 128 px pruhem akcí pro celý text `Upravit` i 44px Koš; při 680 px a méně se řádek skládá jako karta a akce přecházejí pod metadata. Tím se zohlední i 248px workspace sidebar. Chyba soft-delete se v obou režimech vykreslí jako rezervovaný blok přes celou šířku pod hlavním obsahem, takže nepřekrývá další řádek.

### recording_markers

Forward migrace `20260804120000_add_recording_markers.sql` definuje marker s klientským UUID, recording/user vazbou, offsetem, typem, volitelnou poznámkou a timestampy. Povolené typy jsou `important`, `task`, `decision` a `follow_up`. Unikátní `(user_id, client_marker_id)` zajišťuje retry idempotenci; kompozitní FK `(recording_id, user_id)` zajišťuje vlastnictví a cascade při smazání nahrávky. Každý target vyžaduje vlastní schema/grants/RLS postflight a runtime akceptaci; source publikace jeho stav nepotvrzuje.

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
- `execution_mode text` (`manual` nebo `automatic`)
- `attempt_count integer`
- `max_attempts integer`
- `lease_token uuid nullable`
- `lease_expires_at timestamptz nullable`
- `failure_code text nullable`
- `retry_after_at timestamptz nullable`
- `created_at timestamptz`

### ai_outputs

Source-only `20260922210000_add_shared_ai_output_types.sql` přidává omezené session
RPC `get_accessible_ai_output_types_v1(uuid[])`: pro nejvýše 1000 vstupních ID
vrací pouze `output_id` a autoritativní job `processing_type`, pokud nahrávka
výstupu právě projde T1 `can_read_recording`. Joby zůstávají privátní; čtení samotných
výstupů dál řídí jejich RLS. Kontrakt, návaznost na T3 a neprovedené DB ověření jsou
v [API projekce typů](api/shared-ai-output-types.md).

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
-> uživatel zvolí přesně jeden ze šesti quick-action typů: summary, action_items, timeline_chapters, meeting_minutes, crm_note nebo follow_up_email
-> serverový resolver vybere efektivní text ze systémového promptu nebo aktivního uživatelského override a připojí autoritativní systémové output_schema
-> systém vytvoří ai_processing_job
-> worker načte transcript a vyřešený prompt snapshot
-> worker zavolá vybraný AI provider API
-> JSON výstup se parsuje, pokud ho provider vrátí jako JSON
-> ai_output se uloží do DB
-> strukturované položky se odvodí do transcript_tasks / transcript_chapters / transcript_decisions / transcript_risks
-> job přejde do done nebo failed
```

Manuální quick action vytváří UUID už v browseru a při jednom transportním retry ho znovu použije. Authenticated `POST /api/transcripts/{id}/process` nejdřív vrátí existující shodný owner/transcript job, jinak snapshotne účinný prompt, vloží přesné `ai_processing_jobs.id` ve stavu `queued` se `started_at = null`, zaregistruje práci přes Next.js `after()` a vrátí `202` před provider dokončením. Serverový owner pak atomicky claimne pouze nový tvar `execution_mode = manual`, `queued -> running`, `attempt_count = 0`, `max_attempts = 1` a bez lease; callback bez claimu končí. Před placeným voláním navíc kontroluje existující raw output pro stejné job ID. Nový manual tok persistuje pouze machine-readable `failure_code` a případné `retry_after_at`; raw provider message, prompt, transcript ani output obsah se do error metadata, API nebo logu nepřenášejí.

### Manuální AI joby: durable claim a bezpečná obnova

Každý nový ruční požadavek zůstává v `ai_processing_jobs` jako auditovatelný řádek. Job má `execution_mode = 'manual'`, `attempt_count = 0`, `max_attempts = 1`, přesný prompt/model/provider snapshot a začíná jako `queued`. `POST /api/transcripts/{id}/process` používá request UUID jako idempotency identity: opakování stejného requestu pro stejného vlastníka a transcript vrátí existující stav a nespustí nové plánování ani provider call. Nový uživatelský retry vždy vytvoří nové UUID; starý job se nemaže.

Provider volání je možné zahájit pouze po úspěšném service-role claimu `claim_manual_ai_job_v1`, který pod krátkým row lockem nastaví `running`, `attempt_count = 1` a přesný lease na 480 sekund. Runtime processing route i reconcile route mají `maxDuration = 300` sekund; lease proto obsahuje 180 sekund recovery grace. Lease se neprodlužuje a `running` práce se nikdy automaticky nereclaimuje. Settlement `settle_manual_ai_job_v1` přijímá pouze shodný `job_id`, `transcript_id`, `user_id` a přesný `lease_token`; zero-row nebo špatný token není úspěch.

| Stav a podmínka | Reconcile výsledek | Provider |
| --- | --- | --- |
| nový `queued` job přesně odpovídá manual shape | `schedule`, poté vyhraje nejvýše jeden claim | nejvýše jeden call po claimu |
| legacy/manual shape mimo nový protokol | `operator_required` | nikdy automaticky |
| `running` s platným lease | `busy` | žádný nový call |
| stale `running` s owner-consistentním `ai_outputs` | atomicky `done`, lease se vyčistí | žádný |
| stale `running` bez outputu | atomicky `failed` s `execution_interrupted`, lease se vyčistí | žádný |
| `done` nebo `failed` | terminální no-op | žádný |

`POST /api/transcripts/{transcriptId}/manual-ai/reconcile` je owner-authenticated endpoint s body `{ jobId, action: "reconcile" | "interrupt" }`. Session a ownership se kontrolují request-scoped klientem; server-side reconcile pak používá service-role-only `SECURITY INVOKER` RPC. `interrupt` ukončí pouze nový `queued` nebo stale `running` job; čerstvý `running` vrátí konflikt a neslibuje zrušení provideru. Endpoint nic nemaže.

Bezpečná chyba je pouze jeden z kódů `insufficient_credit_or_quota`, `rate_limited`, `invalid_model`, `provider_unavailable`, `provider_configuration`, `execution_interrupted`, `persistence_failed` nebo `unknown`. UI kódy převádí na pevné české zprávy a nikdy nezobrazuje raw provider detail. Stale rozhodnutí vychází z persistovaného `lease_expires_at`, nikoli z času mountu. Tato source migrace je pouze `supabase/migrations/20260904140126_harden_manual_ai_job_recovery.sql`; nebyla aplikována na produkční databázi.

Detail nahrávky nenačítá AI bodies ani projekce v serverovém critical path. Transcript-scoped klient načítá owner-scoped metadata až pro AI/Timeline/export, nejvýše 50 manuálních job summaries a samostatně nejvýše šest automatických jobů aktuální generace, plus 50 output metadata na stránku bez promptu/provider configu/transcriptu. Těla se načítají podle potřeby; export projde celou historii v omezených dávkách. Stavový poll používá serverové `poll_eligible`, 10 s prvních 30 s, 30 s mezi 30 a 120 s a 60 s poté, pouze visible/online relevantní plochu, nejvýše jeden request a backoff po chybě nejméně 30 s. Lifecycle catch-up nastane jen více než 30 s po dokončené kontrole. Same-transcript server props zachovávají cache a DOM; explicitní potvrzená ID smazání/mutace se slučují lokálně s tombstones, staré odpovědi odděluje generation fence. Žádný kompletní `router.refresh` při těchto operacích.

Workflow `custom_prompt` v této etapě není součástí runtime. Browser neposílá prompt ID ani vlastní prompt text; upravený text se automaticky použije pod původním quick-action tlačítkem.

Settings má šest nezávislých automatických výstupů. Nová preference `automaticOutputTypes` vybírá shrnutí, úkoly, zápis, CRM poznámku a navazující e-mail; výchozí prázdný seznam nikdy nepřebírá souhlas ze starých dormant polí. Samostatný existující `autoTimelineAfterTranscription` dál řídí časovou osu. Vše vypnuto znamená žádné nové automatické AI. Regular/segmented STT, live, import i obnova používají history-preserving capture kontrakty. Completion trigger uloží pro každý zvolený typ soukromý immutable prompt/model/provider snapshot, nikoli intent/job. Následný schedule_capture_automatic_intents_v2 jej spotřebuje až po aktuální osobní read/manage autorizaci a dosud platném opt-in. Partial drafts, změna nastavení a otevření historického přepisu nevytvářejí nové intenty. Stejná generace zachová původní rozhodnutí; v1 timeline wrapper zachová starou signaturu a digest.

Capture completion zachová consent a privátní immutable snapshot aktuálního osobního modelu, provider konfigurace a effective promptu, nikoli novou AI/provider operaci. Samostatné scheduling vyžaduje aktuálního původního osobního vlastníka s read i management oprávněním a používá tento snapshot. Editor, revokovaný autor ani founder cizí nahrávky tím nové AI oprávnění nezískají. Legacy `complete_transcript_generation_v1` se pro nový capture nepoužívá, protože jeho cleanup porušuje zachování historie. Historické přepisy bez completion eligibility se po zapnutí preference nedoplňují.

Po commitu se nejvýše šest jobů nezávisle zařadí z uložených intentů. Provider fan-out běží přes Next `after()`, s 240s provider timeoutem, 300s route budgetem a 900s lease; host termination není garance dokončení. Obnova při aktivaci AI/Timeline nebo způsobilém pollu čte pouze současné intenty. Automatická publikace používá `publish_automatic_ai_output_v2`: zamkne transcript a job, před jakýmkoli zápisem ověří generaci, vlastníka, typ a platný lease, pak atomicky uloží raw output, serverem odvozené projekce, usage a done settlement. SQL chyba projekce nesmí být spolknutá. Úspěšný či terminální job se nespouští znovu ani po smazání outputu. Manuální protokol zůstává samostatný. [Přesný rollout a ověření](api/automatic-ai-outputs.md).

`output_schema` je aktuálně kontrakt pro prompt a provider request. Striktní JSON Schema validace před uložením zatím není aktivní gate; pokud se doplní, musí být napojená do AI workeru a testovaná pro OpenAI i Gemini odpovědi.

Systémové AI prompty jsou uložené v `prompt_templates` jako `is_system = true` a `user_id = null`. Uživatelé je mohou číst, ale nemohou je měnit. Vlastní uživatelské prompty mají `is_system = false` a `user_id = auth.uid()`. Systémové prompty rozlišují business roli mluvčích, pokud je dostupná z transcriptu nebo metadata: klient/zákazník (`client_customer`), dodavatelský nebo interní tým (`delivery_team`) a neznámá role (`unknown`). Číselné štítky mluvčích ze Soniox diarizace samy o sobě nestačí k přiřazení role. Endpoint AI processingu proto do `metadata` vždy přidává `speaker_context` odvozený z `transcripts.speakers`, aby prompt mohl použít ručně uložená jména a role mluvčích. Do `{{segments}}` se neposílá plný Soniox token-level JSON; backend ho před provider voláním kompaktně převádí na speaker utterances s časem, mluvčím a textem, aby dlouhé cally nepřekročily token limity providerů. Renderer promptů zároveň podporuje explicitní placeholdery `{{raw_text}}`, `{{segments}}`, `{{speakers}}`, `{{metadata}}` a zpětně kompatibilní aliasy `{{transcript_text}}`, `{{transcript}}` a `{{transcript_segments}}`.

Strukturované projekce jsou tolerantní k aktuálním i starším prompt kontraktům. Detail nahrávky preferuje uložené `transcript_chapters` pro časovou osu a `transcript_tasks` pro checklist, ale stále umí zobrazit původní `ai_outputs.output_json` jako fallback pro starší výstupy. Běžný uživatel má nad projekčními tabulkami jen čtení a u `transcript_tasks` úzké oprávnění změnit `status`; vytváření a přepis projekcí zůstává server-side přes service role.

## Přehrávání audia a navigace na důkaz

Pro přehrávání browser volá `GET /api/recordings/{recordingId}/audio`. Source T3 route nejdřív ověří request-scoped Supabase Auth session a aktuální canonical `read` capability pro přesné ID nahrávky. Teprve potom interní admin lookup načte úzký technický locator pro totéž ID; technický `user_id` slouží k validaci kanonického objektu, nikoli jako owner-only autorizace. Signed URL pro jediný validovaný objekt s životností 300 sekund vytváří session Storage klient, takže přístup znovu vynucuje Storage RLS, nikdy admin signer. Revoke blokuje nové podpisy; již vydané URL může platit do expirace. Raw DB `storage_path` ani technická metadata se nevracejí jako samostatná pole, ale signed URL obsahuje encoded cestu objektu. Bezpečnost stojí na aktuálním přístupu, private bucketu, signed tokenu a expiraci, ne na path secrecy; opaque cestu by vyžadovala media proxy. Route i capture integrace jsou součástí aktuálního source. Každá instalace musí ověřit živou DB, Storage a vlastní runtime.

`Cache-Control: private, no-store` platí pro JSON envelope této API route, včetně chybových odpovědí; nepopisuje response ani cache metadata samotného Storage média. Uploady aktuálně nastavují Storage `cacheControl` na 3600 sekund. Platnost signed tokenu 300 sekund omezuje možnost nově URL autorizovaně použít, ale sama o sobě nezakazuje cache již staženého audia. Klient signed URL nedává do dlouhodobého aplikačního úložiště a po chybě média ji může načíst znovu nejvýše jedním retry.

Playback eligibility je odvozená pouze z bezpečného serverového metadata kontraktu:

- `single`: `storage_path` ukazuje na jeden konkrétní objekt; player se vyrenderuje a smí seekovat/přehrát,
- `none`: není dostupný validní single locator; nejde o potvrzení fyzické neexistence Storage objektu, transcript a navigace zůstávají dostupné bez playeru,
- `segmented`: legacy `storage_path` končí `/live/`; segmenty zůstávají čitelné pro recovery/retranscription, ale detail je nepřehrává jako jeden soubor.

Načtení detailu, změna tabu ani background fetch nevytváří play intent. Ten vzniká jen přímým uživatelským kliknutím na čas transcriptu nebo klikací citaci důkazu; podle připravenosti média se skutečné `play()` provede okamžitě, nebo se tento explicitní intent flushne po `loadedmetadata`. Ani druhý případ není autoplay. Bez eligible single audia stejná akce pouze přepne tab, scrollne a zvýrazní transcript.

Výsledek hledání odkazuje na kanonický detail `?tab=transcript&at=<ms>&highlight=<dotaz>`. Server i browser přijímají jen jednu hodnotu každého parametru, `at` v rozsahu `0..86400000` a normalizovaný highlight nejvýše 120 znaků. Časový resolver volí nejdřív blok obsahující čas, potom nejbližší následující blok a nakonec nejbližší předchozí blok. Bez speaker bloků může použít raw-text anchor. Highlight se zobrazí jen tehdy, když patří vybranému bloku; URL bez času se naviguje pouze při právě jednom výskytu v celém renderovatelném přepisu. Nejednoznačný nebo nenalezený text nevytvoří falešný highlight. Deep link je one-shot: po převzetí se z URL odstraní jen `at` a `highlight`, ostatní parametry a browser history state zůstanou zachované. URL navigace nikdy nepřehrává automaticky; u `single` audia provede nejvýše seek bez play, u `none` a `segmented` jen scroll/highlight.

Karta `Časová osa` zobrazuje sekci `Označené momenty` před AI kapitolami, stabilně podle `offset_ms` a potom `id`. Detail načítá všechny markery jedné nahrávky jedním RLS dotazem paralelně s nahrávkou a transcripty, ne N+1 dotazy. Bez aktivního transcriptu zůstávají marker řádky čitelné, ale navigační tlačítka jsou disabled a neslibují přehrání. S transcriptem přímý klik odmítne cizí `recordingId` nebo `transcriptId`, zvolí deterministicky blok obsahující čas markeru nebo nejbližší blok a provede jeden scroll/highlight. Pouze `single` audio dostane jeden seek a click-initiated play; `none` a legacy `segmented` zůstanou transcript-only bez audio fetch/seek/play.

Čas důkazu se nebere z providerem navržených milisekund. Server normalizuje quote přes Unicode NFC, český locale case folding, whitespace a Unicode punctuation, ale zachovává diakritiku, symboly a compatibility znaky. Přijme jen jeden přesný souvislý whole-token match v plných uložených `transcripts.segments`; opakovaný, částečný, nesouvislý nebo timestampově neúplný match vrátí `null`. Nové ověřené rozsahy se odvozují až po uložení raw `ai_outputs` a před označením AI jobu jako `done`.

Staré task/decision řádky s quote a nulovými časy získají při renderu pouze odvozenou runtime kopii lokace; risk ji získá jen tehdy, když má quote. Tato kopie nemění server props a nic nepersistuje. Nejednoznačný legacy quote zůstane textem bez falešné akce. Pro highlight se preferuje speaker block obsahující celý rozsah, jinak block vlastnící `startMs` v polouzavřeném intervalu `[start, end)`, takže přesná hranice patří novému bloku. Když renderovatelný block neexistuje, single audio stále seekne na přesný čas, ale UI nevytvoří falešný anchor ani highlight.


Každá instalace vyžaduje vlastní two-user runtime RLS, auth-user cascade, authenticated GIN `EXPLAIN` a current-vs-old/manual/raw/deleted search ověření. `supabase db push` na target s neznámým driftem je blokovaný do samostatně schváleného history reconciliation; legacy historii nemaž ani neresetuj. Zveřejnění zdroje nepotvrzuje apply, postflight ani deploy konkrétní instalace.

### Prompty a sekundární AI archiv

`/templates` zůstává stabilní URL a v UI se jmenuje `AI prompty`. Desktop používá master-detail a na šířce 900 px a méně samostatnou plochu editoru s návratem do seznamu. Editor zobrazuje právě šest systémových quick-action základů a canonical `template=<uuid>` vždy drží jejich systémové UUID. Uživatel upravuje pouze `prompt_text`; systémový název, `processing_type` a `output_schema` jsou read-only. Pokročilé parametry jsou výchozí zavřené a schema nemá form `name`, takže ho browser neposílá.

`prompt_templates` obsahuje neměnné systémové základy. `prompt_template_overrides` obsahuje nejvýše jeden owner-scoped revisioned textový override na základ a nemá schema sloupec. Save/reset jsou `SECURITY INVOKER` RPC s `auth.uid()`, forced RLS a expected revision; stale revision `40001` se zobrazí jako bezpečný konflikt a draft zůstane mounted. Reset override pouze deaktivuje a staré AI výstupy ani jejich atribuci nepřepisuje. Legacy libovolné vlastní templates zůstávají uložené, ale tato UI fáze je nezobrazuje.

Quick-action request z browseru obsahuje pouze model a jeden ze šesti processing typů. Authenticated serverový resolver vybere effective text, vždy připojí autoritativní systémové `output_schema` a před provider callem uloží do `ai_processing_jobs` přesnou identitu i immutable snapshot textu/schema. Nové joby mají `prompt_snapshot_exact=true`; historicky backfillované joby mají poctivě `false`.

`/ai` je sekundární archiv celých uložených generací, nikoli globální primární navigace ani místo pro spouštění nového zpracování. Archivní query používá explicitní inner joins a načítá pouze payload `ai_outputs`, processing type, `transcripts.recording_id` a identitu/název/stav nahrávky; nenačítá `raw_text`, segmenty, speakers, storage cestu ani provider konfiguraci. Forced RLS zůstává hranicí čtení. Canonical URL filtry `type` a `recording` podporují Back/Forward. Aktivní nahrávka vede na `?tab=ai`, smazaná na `/trash` se stavem `V koši`. Mazání se týká celé generace; optimistic stav patří přesně archivní kartě a při neočekávaném selhání se stejná karta obnoví se sanitizovaným alertem. Existující query filtry se zachovají i v chybovém redirectu.

Detail nahrávky přijímá přesně jednu hodnotu `tab=transcript|ai|timeline|files|chat`. Platná URL záložka má přednost před cookie; `tab=transcript` dál zachovává one-shot `at`/`highlight` deep-link kontrakt. Neplatná nebo duplicitní záložka se canonicalizuje na výchozí stav bez `tab`, `at` a `highlight`, aby SSR a hydratace vycházely ze stejného rozhodnutí.

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

Route loading a obnovitelné chyby šesti pracovních ploch používají stejný
`VosioWorkspace` shell jako hotové stránky. `pendingContent` mění jen vnitřní
obsah; metadata AI/timeline a historie chatu mají samostatný neznámý stav.
Načtené kapitoly zůstávají při chybě background kontroly připojené. Rozsah
zdrojového auditu a browser důkazu je v [loading kontraktu](requirements/ui-loading.md).

Detail a archiv nabízejí smazání konkrétního AI výstupu podle jeho metadata ID
i před načtením těla. Celý checklist používá samostatný task-only snapshot a
atomický RPC: zachovává původní AI zdroje, zápisy, shrnutí, přepis a audio.
Per-output suppression brání opožděné obnově projekcí ze starého zdroje;
nové output ID může vytvářet nové úkoly. [Checklist kontrakt](api/checklist-delete.md)
a [modelový kontrakt](api/ai-model-selection.md) popisují source forwardy, které
vyžadují samostatný DB apply a runtime proof před deploymentem.

Desktopový sidebar je 224 px rozbalený a 64 px sbalený; netajná preference railu se ukládá lokálně. Pracovní obsah začíná 72px globálním topbarem s breadcrumbem a přepínačem motivu. Na šířce 900 px a méně zůstává přesně pět cílů spodní mobilní navigace.

V inboxu tvoří hledání, pokročilé filtry a `Spravovat` jeden kompaktní toolbar. Při viewportu 900 px a méně se toolbar složí do jednoho sloupce a `Spravovat` zabere celou šířku. Hledání zůstává vždy viditelné a organizační filtry jsou v keep-mounted pokročilém disclosure. Správa organizace používá keep-mounted pravý Drawer, takže zavření nezahodí draft ani pending save. Stavové chips jsou URL odkazy na serverové facety; samostatné `Smazáno` vede na úplný Koš. Capture workspace zobrazuje storage limity jako jeden informační řádek.

Koš podporuje bounded bulk restore nejvýše 100 položek. Permanentní bulk mazání je klientská fronta: každá položka volá vlastní jednopoložkovou server mutation a nejvýše dvě jsou současně in flight. Zastavení fronty neukončuje již běžící requesty a partial settlement schová pouze úspěšné řádky. Ruční permanentní smazání zůstává dostupné po neměnném 24hodinovém bezpečnostním intervalu a není svázané s pozdějším automatickým deadlinem.

Vosio má PWA manifest, PNG/SVG app ikony a lehký service worker, takže produkční HTTPS deployment je připravený k instalaci na mobil přes browserové instalační flow. Service worker zatím necachuje aplikační requesty, aby se neriskovala zastaralá auth/session data nebo staré stavy uploadu a přepisu.

Na desktopu nad 900 px používá workspace 224px sticky levý sidebar a pracovní plochu přes celou zbývající šířku viewportu s responzivním vnitřním odsazením, bez globálního max-width stropu. Primární část obsahuje v pořadí `Nahrávky`, `Nová nahrávka` a `AI prompty`; spodní utility část obsahuje `Koš`, `Nastavení`, `Dokumentace`, nezměněný externí odkaz `Kup mi kafe` a účet uživatele. Přepínač motivu je v pravé části globálního topbaru. Sidebar neobsahuje globální AI položku, duplicitní seznam nahrávek ani storage kartu. Na šířce 900 px a méně se sidebar schová a fixed navigace se safe-area paddingem má přesně pět cílů: `Nahrávky`, `Nová`, `AI prompty`, `Nastavení`, `Více`. Persistentní recorder dock na stejném breakpointu dostává safe-area offset nad navigaci, takže ji nepřekrývá ani mezi 761 a 900 px. `Více` otevírá focus-managed Drawer s `Košem`, `Dokumentací`, přepínačem motivu, support odkazem a účtem s odhlášením. Drawer přebírá Escape, backdrop, focus trap a návrat focusu ze sdílené UI primitive; pending stav se po změně pathname resetuje.

Detail nahrávky je na všech šířkách jednosloupcový dokument bez dominantního vedlejšího railu. Desktopový shell používá jako jediný hlavní svislý scroll owner `.content-area-document`; na šířce 900 px a méně přechází stejný obsah do běžného scrollu dokumentu/prohlížeče. Transcript, AI výstupy, časová osa ani soubory nevytvářejí další vnořený scroll. Přilepený blok drží audio přehrávač a záložky dostupné při čtení dlouhého přepisu a na desktopu dosedá při scrollu bez mezery k horní hraně scroll owneru. Na mobilním breakpointu je přehrávač fixed nad spodní navigací a dokument má odpovídající rezervu, takže poslední řádek zůstane dosažitelný a žádný podporovaný viewport nevytváří horizontální posun.

Přepínač světlého a tmavého režimu je v desktopovém globálním topbaru jako icon-only akce. Volba se ukládá do `localStorage` i cookie `vosio-theme` a nastavuje `data-theme` na kořenovém `<html>` elementu. Cookie se čte už v serverovém layoutu, aby světlý režim po refreshi nezačínal krátce tmavým fallbackem.

Při live nahrávání se aplikace pokusí získat Screen Wake Lock, aby prohlížeč zbytečně neuspával aktivní capture workflow. Wake Lock je best-effort webová ochrana; pokud systém uspí počítač, prohlížeč, tab nebo PWA, může přerušit mikrofon nebo WebSocket i na desktopu. Návrat aplikace do popředí obnovuje pouze Wake Lock a nerestartuje zdravou Soniox relaci; skutečný výpadek spojení řeší `auto_reconnect` SDK. Při skutečném reconnectu aplikace zachová poslední partial tokeny a následující session-relative časy posune na jednu globální časovou osu nahrávky. Odolnými body jsou poslední potvrzený transcript draft a v audio režimech úplně uzavřené 15sekundové safety části; právě otevřený interval ani události po ztrátě browseru garantované nejsou.

Workspace po přihlášení načítá reálná Supabase data přes RLS, ale routy mají úzké datové kontrakty. `/recordings` načítá jen seznam nahrávek, utility stránky jako `/settings`, `/templates`, `/trash` a `/documentation` netahají transcripty ani AI výstupy, pokud je samy nezobrazují. Detail `/recordings/[recordingId]` načítá pouze jednu nahrávku, její markery, transcript a AI výstupy k tomuto transcriptu. Markery se načtou jedním cíleným dotazem pro recording, ne per-row N+1. Dlouhé `raw_text`, `segments` a `output_json` payloady nesmí být součástí běžného shell/list přepínání.

Upload audio souboru vytvoří řádek v `recordings`, resumable TUS upload uloží soubor do private Storage bucketu `recordings` pod cestu `{user_id}/{recording_id}/{filename}` a aktualizuje stav na `uploaded`. UI zobrazuje aktuální soubor, jeho průběh i celkový byte-weighted průběh fronty; při úspěšném dokončení souboru se může zahájit další, nikdy ne paralelně. Produktový katalog je záměrně omezený na běžné formáty M4A, MP3, WAV, WebM, OGG, FLAC a MP4; skutečně povolená sada je jejich runtime průnik s explicitním `recordings.allowed_mime_types` bucketu. Picker používá jediný filtrovaný vstup. Přípona je pouze picker hint; prázdný nebo obecný MIME typ se odmítne před vytvořením DB řádku a TUS přenosem. Server stejný uložený MIME znovu ověří před odesláním single objektu do Sonioxu.

Akce `Nová nahrávka` vede na samostatnou pracovní kartu `/recordings/new` se dvěma rovnocennými primárními metodami v pevném pořadí: live nahrávání přes mikrofon a upload existujícího audio souboru. Import hotového textového přepisu zůstává funkční jako vedlejší, výchozí zavřená sekce pod nimi. Obrazovka je kompaktní capture workspace, ne hero stránka. Desktop nad 900 px drží primární karty vedle sebe stejně široké; na 900 px a méně se skládají live -> upload bez horizontálního scrollu. Běžný desktop používá jako svislý scroll owner `.content-area-document`; krátký desktop do výšky 640 px přepne celý shell na jediný dokumentový scroll, aby zůstaly dostupné sidebar i spodní importní akce. Mobilní breakpoint používá také dokumentový scroll. Live karta nabízí přesně `Audio do {live limit} + live přepis`, `Jen audio do {live limit}` a `Jen live přepis`; v audio režimech ukazuje kvalitu a desetinný MB/h odhad a po startu zamkne režim, jazyk i kvalitu. Caption plocha seskupuje live tokeny podle mluvčích, pokud je Soniox vrací, a ukládání vždy nahrazuje celé aktuální okno partial tokenů. UI nemá vlastní limit čtyř mluvčích a vykreslí všechny speaker ID, které provider vrátí; Soniox session podporuje nejvýše 15 mluvčích. Upload přijímá běžné Soniox async formáty `m4a`, `mp3`, `wav`, `webm`, `ogg`, `flac` a `mp4`; dropzone a jediný filtrovaný picker vedou do stejného sériového TUS toku. Server-only `getRecordingStorageConfig()` čte explicitní `file_size_limit` i `allowed_mime_types`; když je nelze načíst, audio cesty jsou vypnuté a textové zůstávají dostupné. Audio limit ukončí a finalizuje celou audio generation. Normální stop uloží single archiv a přesně uklidí safety části; potvrzené části slouží jako segmentovaný fallback a local-only části zůstávají pro recovery. Režim `Jen live přepis` audio nevytváří a Storage limit se ho netýká.

Během aktivního live záznamu nebo uploadu UI chrání běžné kliknutí na interní odkaz, označený navigační submit a zavření či reload stránky. Potvrzení je společné pro více aktivních operací a po zrušení akce nenechá navigaci pokračovat; shell v takovém případě ani nenastaví pending stav, ani nezavře mobilní Drawer. Pro Back/Forward App Router nenabízí spolehlivý intercept bez křehkého history hacku; tato cesta proto zůstává vědomě mimo ochranu a důležitý stav se průběžně ukládá. Stavové zprávy pro průběh, Wake Lock a realtime připojení mají oddělenou sémantiku, aby ztracený Wake Lock nebyl prezentován jako ukončené nahrávání.

Transcript panel načítá uložené `transcripts` z Supabase. Pokud je přepis hotový, zobrazí uložený text; pokud uložené `segments` obsahují Soniox tokeny s polem `speaker`, karta `Přepis` seskupí navazující tokeny do jedné řádkované tabulky se sloupci čas, mluvčí a text. Každý mluvčí má stabilní barevný štítek, může mít ručně zadané jméno a roli a dlouhý transcript pokračuje v dokumentovém scrollu celé detailové stránky. UI nepoužívá jednotlivé rozbalovací mini-tabulky pro každý speaker úsek. Jméno mluvčího se ukládá po změně a opuštění pole, role okamžitě po výběru. Jeden otevřený detail serializuje všechny speaker zápisy, protože každý request čte a přepisuje celý JSON `transcripts.speakers`; per-speaker revision ignoruje starší settlement a chyba ponechá draft s retry. Po durable uložení server stále spouští `replaceTranscriptSearchChunks`, aby zobrazené štítky a vyhledávací chunks zůstaly synchronizované. Vlastní audio přehrávač zůstává mounted i při přepínání záložek, načítá private signed URL s retry a dovoluje opakované hledání přes range, klávesnici i timestampy. Samotné hledání v progress baru přehrávání nespouští; explicitní timestamp zachovává dosavadní seek-and-play kontrakt. Pokud není přepis hotový, panel ukazuje stav podle `recordings.status`. U stavu `transcribing` detailová stránka každých zhruba 15 sekund volá `GET /api/recordings/{recordingId}/transcription` s `cache: "no-store"`, aby načetla stav DB a po dokončení uložený přepis. Před čtením používá session POST reconcile k probuzení jedné jednotky již přijaté operace; samotný GET neprovádí provider ani DB mutation. Po návratu dokumentu do viditelné záložky nebo focusu okna spustí stejnou kontrolu okamžitě, protože browser může interval na pozadí utlumit. Ownership lookup vrací 404 jen tehdy, když vlastněný řádek skutečně neexistuje; přechodná chyba Supabase je retryable 503 a nesmí se zobrazit jako falešné „Nahrávka nebyla nalezena“. Foreground kontrola doplňuje bounded after worker a autentizovaný Soniox callback; externí scheduler zůstává samostatná provozní konfigurace.

Detail nahrávky má kompaktní header s názvem, stavem, datem, délkou, velikostí, zdrojem, Exportem, editací, soft delete a odpovídajícími akcemi/stavem přepisu. Za uzavřeným headerem následuje jediný persistentní audio přehrávač a teprve pod ním přesně pět pracovních záložek; Export se v tab řádku neopakuje. Lucide ikony uvnitř pracovního detailu používají jednotný 12px glyph, ale interaktivní prvky si zachovávají 44px hit area. Metadata jsou malé inline chipy vedle názvu, aby header nezabíral vertikální místo. Tlačítko úpravy zařazení je na pravém okraji stejného souhrnného řádku; trojice akcí editoru je uvnitř společného jemného rámečku a `Uložit` má pouze mírně vyšší vizuální prioritu. Editor názvu v detailu i editor názvu v seznamu používá scope a revision kontrakt: během ukládání zůstávají otevřené a blokují dismiss i další submit, po potvrzeném úspěchu se zavřou a vrátí focus na trigger, při chybě zůstanou otevřené s rozepsanou hodnotou a inline alertem. Úspěch oznamuje persistentní `aria-live` mimo zavíranou plochu a rezervovaný feedback slot brání skoku výšky při chybě nebo retry. Stejný save-collapse kontrakt používá přiřazení organizace i vytváření a přejmenování klientů, projektů, plochých složek a štítků: editor se nesbalí při submitu, ale až po potvrzeném úspěchu pro vlastní scope; chyba zachová rozepsaná data a editor otevřený.

Pod headerem jsou client-side záložky `Přepis`, `AI zpracování`, `Časová osa`, `Soubory` a `Chat`. Aktivní záložka se pamatuje per recording přes browser storage i cookie, aby refresh serverově vyrenderoval rovnou poslední pracovní tab bez viditelného přeskoku. `AI zpracování` spouští server-side provider adapter nad hotovým transcriptem přes uložené `prompt_templates`; uživatel volí model a jeho podporovanou úroveň uvažování ve společném pickeru varianty A pro AI detail, Nastavení a Chat. Aktivní OpenAI katalog pro nové požadavky nabízí GPT-6.1 Sol a GPT-6 Astra s odděleným reasoning effort low/medium/high/xhigh/max; Gemini 3.6/3.8 Flash a Mistral Small 4/Large 3 zůstávají dostupné. Přesné API ID a parametry určuje `src/lib/model-options.ts`; nový job je snapshotuje v `provider_config.provider_model`. Nové OpenAI snapshoty uchovávají model i effort odděleně; historické přijaté modely a explicitní retry zachovávají původní immutable snapshot. Ceny jsou orientační a účtování určuje provider. Nové podporované Gemini/Mistral požadavky používají temperature 0,3; Sol/Astra parametr neposílají. Silnější modely obvykle zachytí více souvislostí, ale žádný model nezaručuje úplnost; u složitých nebo důležitých callů je nutné výstupy ověřit proti přepisu. Výsledek se ukládá do `ai_processing_jobs` a `ai_outputs` a po refreshi se zobrazuje v detailu nahrávky. AI tab je jeden vertikální pracovní tok: nahoře nastavení a rychlé akce, pod tím normalizované pracovní výstupy a sbalené output cards s krátkým preview, kopírováním, Markdown exportem, smazáním a u e-mailu po hovoru `mailto:` akcí. Checklist úkolů se seskupuje podle owner kategorie a změna stavu úkolu probíhá optimisticky přes úzký JSON endpoint bez redirectu, aby uživatel zůstal ve stejné pozici v dlouhém checklistu. Důkaz z přepisu je kompaktní disclosure uvnitř existující owner skupiny a raw markdown artefakt se automaticky nerozbaluje, pokud existují strukturované projekce. Checklist má vlastní rychlé akce `Kopírovat` a `MD`, které exportují jen pracovní checklist bez celého transcriptu a bez ostatních AI výstupů. Každý úkol má jedinou kompaktní ikonu koše. Source T3 endpoint vyžaduje aktuální recording capability `delete`: founder u project/selected obsahu, private/standalone owner, nikdy editor nebo pouhý technický autor sdílené nahrávky. Přes session-safe reads sestaví logickou skupinu podle `getTaskDedupeKey` a jedním atomickým `delete_managed_transcript_task_group_v1` ověří verzi i odstraní odpovídající řádky s potvrzeným `deletedCount`, aby po refreshi nevyskočila starší ekvivalentní generace; nesmaže zdrojový `ai_outputs` ani rozhodnutí, rizika nebo kapitoly. Celý uložený AI artefakt se dál maže pouze na vlastní output card a zachovává se audit jobu. Běžící AI generování se ukazuje přímo v tabu a stejný typ výstupu lze spustit znovu i během předchozího běhu.

`Chat` je nad hotovým uloženým `transcripts` řádkem, nikoli nad živým audiem nebo browserovým bufferem. Pro kombinaci vlastníka a `transcript_id` drží jedno persistentní vlákno a chronologické tahy; další otázka může zvolit model z téhož katalogu, ale model, provider, prompt snapshot a usage každého tahu zůstávají uložené. Source T3 `GET` a `POST /api/transcripts/{transcriptId}/chat` vyžadují Supabase session, vlastní transcript i osobní vlákno/tahy a současný `read` přístup k nahrávce. Samotné vlastnictví po revoke nestačí; founder ani sdílený reader/editor nesmí číst cizí osobní chat. Nový provider tah navíc vyžaduje `usePrivateChat` a `runPersonalAi`. Browser pro POST posílá jen UUID pokusu, povolený model a otázku; server vytváří kontext z uloženého přepisu, mluvčích a omezené dokončené historie, bez audia a Storage URL. Opakovaný UUID vrátí stejný tah bez dalšího provider callu a databázový partial unique index dovolí jen jeden `running` tah na vlákno. Provider quote se stane navigovatelným důkazem až po jednoznačném exact contiguous matchi proti uloženým Soniox tokenům; server odvodí čas, nebere ho od providera. Chat používá `OPENAI_API_KEY`, `GEMINI_API_KEY` nebo nový volitelný serverový `MISTRAL_API_KEY` podle vybraného modelu. Nepřidává druhý Supabase projekt.

Karta `Časová osa` zobrazuje nejdřív uživatelské `Označené momenty` a pod nimi obsahovou AI časovou osu, ne technický seznam segmentů po sekundách. Processing typ `timeline_chapters` vytváří kapitoly hovoru s časovým rozsahem, názvem, shrnutím, mluvčími a navázanými úkoly nebo rozhodnutími. Ruční akce prázdné Timeline smí spustit `timeline_chapters` s aktuálním výchozím AI modelem pouze při serverově ověřeném `runPersonalAi`: technický osobní AI vlastník musí mít i současný přístup a management nahrávky. Editor, reader ani founder nad cizím osobním AI obsahem provider nespustí; samotné zobrazení záložky nic negeneruje. Stávající transcript processing endpoint vytvoří job, raw output i kapitoly; úspěch refreshne uložené kapitoly a selhání ponechá retryable empty state. Uložené markery zůstávají dostupné i během generování a po chybě. Tato cesta nepřidává nový endpoint ani databázové schéma. Technické `segments` zůstávají zdrojová data pro Soniox diarizaci, marker navigaci a časování.

Stránka `/settings` začíná částí Účet s přihlášeným e-mailem a změnou hesla, teprve potom následují produktové preference. Ukládá netajné uživatelské preference do Supabase Auth `user_metadata.vosio_settings`. Tato metadata jsou pouze preference, nesmí se používat pro autorizaci. Patří sem výchozí AI model s orientační cenou, jeho vždy viditelné vysvětlení Model a kvalita, Soniox region, výchozí Soniox realtime jazyk a model, čerstvé volby `automaticOutputTypes`, zachovaný explicitní opt-in `autoTimelineAfterTranscription` a `trashRetentionHours`. Všechny automatické výstupy jsou defaultně vypnuté; po dokončení nové transcript generation se snapshotne souhlas, výchozí model a účinný prompt pro každý zvolený typ do soukromého completion snapshotu; samostatný intent vzniká až pod aktuální osobní read/manage autorizací. Nevzniká historický backfill. Pokud první enqueue selže nebo se browser zavře, detail při příštím otevření obnoví chybějící job pouze z tohoto snapshotu/intentu a s runPersonalAi; historický transcript bez intentu zůstane `not_scheduled`. Trash retence přijímá pouze `24`, `168` nebo `720` hodin, při chybějící či neplatné hodnotě používá `720` a ovlivňuje pouze budoucí přesuny do Koše; konkrétní deleted řádek drží neměnný snapshot deadline. Část Účet mění heslo pouze po ověření aktuálního hesla v request-scoped Supabase session; nové hodnoty se neukládají do metadata ani action state. Global je výchozí Soniox region; EU volba se použije pro realtime i nové async joby a každý async job si region uloží do `provider_config`, aby další polling nezávisel na pozdější změně preference. EU vyžaduje EU-enabled Soniox projekt a odpovídající regionální klíč. Samostatné nastavení upozornění na dlouhou nahrávku není aktivní runtime funkce a nesmí se prezentovat jako ochrana nebo ukončení nahrávání. Aktuální katalog a ceny má `src/lib/model-options.ts`; zahrnuje OpenAI, Gemini a Mistral. Normalizují se jen vyjmenované historické aliasy; neznámý model selže validací a automatický souhlas se vypne. Menším a levnějším modelům může uniknout více detailů, úkolů nebo důkazů i při stejném promptu a schématu; evidence zůstává smluvně povinná, ale výsledek je nutné u důležitých callů ověřit v přepisu. Gemini vyžaduje `GEMINI_API_KEY`, Mistral `MISTRAL_API_KEY`. API klíče, Supabase projekt, storage bucket a bezpečnostní limity zůstávají systémové hranice řízené kódem nebo serverovou konfigurací.

Vosio má jeden instalační model: každá osoba nebo firma nasazuje vlastní aplikaci a připojuje vlastní Supabase, Soniox a AI účty. Production, preview nebo jiné deployment prostředí, které má plně fungovat, potřebuje stejné povinné názvy proměnných; se stejnými hodnotami používá stejná data a provider náklady. Veřejná `/configuration` bezpečně ukazuje jen názvy chybějících public Supabase proměnných; po přihlášení zobrazuje sekce Technické informace v nastavení pouze připravenost, prostředí a názvy chybějících serverových proměnných, nikdy hodnoty.

Nastavení zároveň zobrazuje read-only usage souhrn pro aktuální měsíc. Source implementace čte vlastní `ai_processing_jobs` a `transcription_jobs` přes authenticated RLS, měsíční metadata nahrávek přes `get_owned_recording_usage_summary_v1` a délky pro Soniox přes bounded `get_owned_recording_durations_v1`. Účetnictví používá technické vlastnictví nezávisle na aktuálním content read: cizí sdílená nahrávka součet nezvýší, revoke nesmaže vlastní historickou délku. Vyžaduje sharing forward `20260922230000`; live apply a PostgREST serializace zatím nejsou ověřené. AI cena je orientační výpočet z uložených `input_token_count`, `output_token_count` a lokální mapy cen pro model uložený v `ai_processing_jobs.model`. Pokud job nemá tokeny nebo model nemá lokální cenu, UI to označí jako neúplný odhad. Soniox cena je orientační výpočet z dokončených Soniox STT jobů a známé délky nahrávky. Async přepis se počítá jako přibližně $0.10/h, realtime jako přibližně $0.12/h. Joby bez známé délky se do ceny nezapočítají a UI ukáže coverage; zdroj pravdy pro fakturaci zůstává provider dashboard.

Stránka `/recordings` je Appica-inspired inbox na neutrálním `#f7f8fa` pozadí. Hlavička má název, vysvětlení a tmavou primární akci `Nová nahrávka`; pod ní je kompaktní toolbar s hledáním, keep-mounted pokročilými filtry a `Spravovat`. Stavové facety tvoří měkký segmentovaný řádek a samotný seznam je jediný bílý 16px panel s jemným okrajem. Název je hlavní Next odkaz na detail a zároveň pružný sloupec. Editace názvu a přesun do Koše jsou schované pod samostatnou přístupnou ellipsis akcí na konci řádku, aby starý pevný action track nezabíral trvale místo. Otevřené menu nesmí vnořit interaktivní prvky do odkazu na detail. Editor se zavře až po potvrzeném uložení; změna se zapisuje přes authenticated Supabase klienta a RLS. Správa klientů, projektů, plochých složek a štítků používá keep-mounted pravý Drawer; zavření odstraní obsah z focus/accessibility stromu, ale nezahodí draft, pending save ani jeho settlement. Nad seznamem se zobrazí recovery panel, pokud existují nedokončené live drafty s uloženým partial transcriptem nebo audio segmenty. Stavový řádek používá exact serverové facety přes celý aktuální `q`, organizační filtry a ALL sadu štítků; facety ignorují aktivní `status` a samostatné `Smazáno` ukazuje úplný Koš. Existující URL-backed filtry jsou `q`, `status`, `client`, `project`, `folder` a opakovatelný `tag`; source ani date filtr tento UI-only řez nepřidává. `q` používá indexed PostgreSQL hledání v nejnovějším přepisu, názvu nahrávky, klientovi, projektu, složce a štítcích. Změna organizačních filtrů zachovává `q` i nesouvisející query parametry; vyčištění hledání zachová rozepsané organizační filtry a vyčištění organizace zachová rozepsané `q`. Neplatné, cizí, duplicitní nebo klientovi neodpovídající hodnoty se kanonizují. Více štítků má ALL sémantiku. Vyhledávání vrací stránku 25 výsledků s excerptem a bezpečným odkazem na transcript; bez `q` aplikace načítá organizační seznam stabilním keysetem `(created_at, id)`. Při viewportu 900 px a méně se skládá toolbar a `Spravovat` zabere celou šířku; seznam se nezávisle přepne z flat řádků na skládané karty při skutečné šířce content containeru 680 px a méně. Nahrávku lze z ellipsis menu soft-smazat do stavu `deleted`; tím zmizí z hlavního seznamu a objeví se na `/trash`. Source implementace ručního trvalého smazání používá session prepare/start RPC s kontrolou aktuálního managera a durable receiptem; service worker maže pouze receipt-bound Storage prefix s fencing tokenem a DB finalize RPC smí kaskádově odstranit řádek i potomky až po ověření prázdného prefixu. Nejde o owner-check následovaný přímým admin smazáním; live DB, Storage běh ani scheduler nejsou tímto checkoutem ověřené. Mazání v UI vždy vyžaduje potvrzení a po potvrzení se řádek nebo explicitně označená search karta optimisticky schová ještě před doběhnutím server action; neočekávaný reject obnoví stejný element a zobrazí sanitizovanou chybu v rezervovaném plnošířkovém druhém řádku uvnitř řádku nebo karty. Route-level loading udržuje geometrii inboxu; route error nezobrazuje interní detail chyby a volá skutečné App Router `reset()`.

Development browser E2E se musí spouštět přes `npm run test:e2e`. Vnější runner vytvoří jediný hlídaný dočasný Next workspace pod repo `.tmp`, kopíruje pouze explicitní aplikační allowlist, předá jeho cestu Playwrightu a smaže pouze přesně ověřený vlastní temp adresář. Playwright config odmítne přímé spuštění bez runner guardu a vždy startuje vlastní izolovaný server s `reuseExistingServer: false`; runner používá skryté child procesy a nevyhledává ani neukončuje cizí PID nebo porty.

Detail nahrávky obsahuje export menu místo placeholder tlačítka nastavení přepisu. Export běží lokálně v browseru a umí stáhnout nebo zkopírovat Markdown pro celou nahrávku, pracovní balíček, samotný přepis nebo vybraný AI výstup. Pracovní balíček spojuje metadata, transcript, raw AI výstupy a normalizované pracovní projekce: checklist úkolů, kapitoly časové osy, rozhodnutí a rizika. Uložené AI výstupy mají vlastní akce pro kopírování, Markdown export a smazání. Follow-up e-mail výstup navíc nabízí `mailto:` odkaz, který předá draft výchozímu mail handleru uživatele.

Aktivní aplikační routy po přihlášení jsou:

- `/` přesměruje přihlášeného uživatele na `/recordings`,
- `/recordings` pro seznam nahrávek,
- `/recordings/new` pro samostatnou kartu nové nahrávky s uploadem a live titulky,
- `/recordings/[recordingId]` pro detail vybrané nahrávky,
- `/ai` pro uložené AI výstupy,
- `/templates` pro úpravu textu šesti AI promptů,
- `/documentation` pro uživatelskou dokumentaci k workflow aplikace,
- `/settings` pro netajné uživatelské preference,
- `/trash` pro soft-smazané nahrávky.

Stránka `/templates` zobrazuje šest efektivních AI promptů pod jejich systémovou identitou. Upravený text se automaticky použije pod původním tlačítkem; reset deaktivuje override a vrátí systémový text bez změny historických job snapshotů.

Koš uchovává původní stav nahrávky v `deleted_from_status` a neměnný čas přesunu v `deleted_at`. Při přechodu z aktivního stavu trigger atomicky snapshotne také validní `trash_retention_hours` a `purge_after`; další update již smazaného řádku snapshot nezmění, restore všechna retention i claim metadata vyčistí a nové smazání po restore vytvoří nový snapshot podle aktuální preference. Historické smazané řádky se backfillují na 720 hodin a `purge_after = deleted_at + 30 dní`, aniž by se měnil pravdivý `deleted_at`. Trvalé smazání je jediná cesta, která odstraní řádek i private Storage objekty; session nejprve atomicky připraví a přijme purge receipt a service worker následně používá pouze jeho RPC-returned kanonický prefix a fencing token. Segmentovaná live cesta smí mít pouze tvar `{user_id}/{recording_id}/live/`. Ruční purge je povolený po 24 hodinách bez ohledu na automatický deadline, protože oficiální Supabase TUS upload URL může zůstat platná až 24 hodin.

Source Edge Function `trash-retention` je oddělený service-role worker pro již splatné `purge_after`. Claimuje atomicky nejvýše 20 řádků, zpracovává přesně dva současně a každý claim váže na vlastní lease token s omezeným počtem pokusů. Před Storage mutací znovu ověří lease i kanonický `{user_id}/{recording_id}/` prefix, objekty odstraňuje pouze přes Supabase Storage API a DB řádek finalizeuje jen po potvrzení prázdného prefixu. Chyba před prvním Storage delete pokusem claim bezpečně releaseuje; po zahájení mutace zůstane claim držený, blokuje restore a je reclaimovatelný až po jednotné 15minutové stale hranici. Ztracený claim nikdy nedokončí cizí lease a summary/logy obsahují jen agregované počty a stabilní kódy. Funkce fail-closed vyžaduje vlastní scheduler token a přesnou enable hodnotu `true`. Repo neobsahuje schedule ani rollout; migrace, secrets, deploy i případný harmonogram vyžadují samostatný schválený apply/postflight.

## CI a release boundary

GitHub Actions job `check` má jediný automatický trigger `pull_request` s výchozími activity types `opened`, `synchronize` a `reopened`. `actions/checkout@v7` a `actions/setup-node@v7` používají runtime Node 24, zatímco setup aplikace zůstává na Node 22; checkout bez `ref` override ověřuje PR merge ref. Workflow nemá `push`, post-merge běh ani `workflow_dispatch`, takže přímý push do `main` není tímto workflow automaticky pokrytý. Po `npm ci` běží produkční audit, typecheck, lint a build; testy se na GitHubu nespouštějí. Lokální `npm run check` nadále zahrnuje unit testy a lokální E2E ověření zůstává součástí release gate. Job má `contents: read`, PR concurrency a timeout 20 minut.

Manual AI recovery migration `20260904140126_harden_manual_ai_job_recovery.sql` je součástí aktuálního migračního řetězce. Stav starších manuálních jobů, apply a postflight se ověřuje pro každou instalaci samostatně; zveřejnění zdroje nepotvrzuje úspěch žádného deploymentu.

Aplikační manual-purge worker a jeho bounded recovery endpoint popisuje [aplikační purge API](api/manual-recording-purge-worker.md). Local request klíč se uchovává před prepare; started operace jsou durable DB queue. Scheduler, exhausted-work alert ani live ověření nejsou nakonfigurované či provedené.

## Atomický capture a durable async operace

Forward `20260923010000` zavádí session capture state machine s request receipts a `capture_revision` CAS a oddělenou async prepare/start/work/settle cestu. Realtime browser zápisy vždy znovu ověřují aktuální autoritu; po revoke nejsou povolené ani s historickým receiptem. Async provider work po přijatém startu naopak dokončuje přesný service receipt i po revoke. Nejasný výsledek provider POST není bezpečný retry: zůstává `uncertain`, blokuje destruktivní cleanup a vyžaduje externě ověřený service/operator postup. Nový worker musí používat durable DB discovery, fencing, expiry prepared reservations a upozornění na vyčerpané pokusy; Web, workery a databáze se nasazují jako kompatibilní celek.

Nová async finalizace vytvoří jednu novou transcript generaci a zachová staré transcript/AI artefakty. Nevolá legacy completion cleanup ani provider AI. Forward `20261002060000` ukládá pouze neměnné soukromé completion-time snapshots šesti osobních automatických typů, bez jobu/intentu. Následná samostatná reconciliation vyžaduje aktuální osobní oprávnění i opt-in a používá uložené konfigurace; editor ani odvolaný autor nové AI nespustí. Capture routes v tomto kandidátu používají session receipt/CAS kontrakty, durable audio přesné manifesty a worker exact accepted custody. Nasazení celé kompatibilní sady a DB/Storage/provider runtime ověření zůstávají oddělené brány. Přesné API, mapování starých cest, limity, lock pořadí a neprovedené pgTAP/isolation/provider/Storage runtime gates jsou v [capture operation kontraktu](api/capture-operation-contracts.md).
