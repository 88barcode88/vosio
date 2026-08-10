# Gotchas

## Soniox název

V původní úvaze se objevil název SONiVOX. Pro speech-to-text provider v tomto projektu jde o Soniox. SONiVOX je jiný název a nemá se používat jako název provider integrace.

## Vercel a audio

Audio soubory mohou být velké a dlouhé zpracování nepatří do jednoho Vercel requestu. Hlavní upload cesta je frontend -> Supabase Storage TUS endpoint přes authenticated browser session, ne frontend -> Vercel API route -> storage/provider. TUS adaptér posílá 6 MiB chunky a před každým requestem znovu čte access token, protože dlouhému uploadu může mezitím expirivat session.

Manuální vícesouborový upload běží sekvenčně. Průběh celé fronty se počítá z odeslaných bytů, ne z průměru procent jednotlivých souborů; nesmí klesnout při přechodu na další soubor. Zrušení musí ukončit aktivní TUS upload a zapsat `recordings.status = failed`. Když selže i tento zápis, UI musí ukázat tuto skutečnou chybu místo falešného tvrzení, že zrušení proběhlo čistě.

## Playback signed URL není veřejný ani trvalý odkaz

`GET /api/recordings/{recordingId}/audio` smí podepsat jen jeden konkrétní objekt vlastněný aktuálním Supabase Auth uživatelem. Route filtruje současně `recordings.id` i `user_id` a vrací signed URL na 300 sekund. Raw DB `storage_path` se neposílá jako samostatné pole ani metadata, Supabase signed URL však encoded cestu objektu obsahuje. Bezpečnost stojí na auth a ownership kontrole, private bucketu, signed tokenu a expiraci, ne na path secrecy; opaque cesta by vyžadovala media proxy. Do klienta nesmí uniknout service role ani provider error detail. `storage_path = null` znamená `none`; prefix končící `/live/` znamená legacy `segmented`; player je eligible pouze pro `single` objekt.

`Cache-Control: private, no-store` patří JSON envelope audio API, ne Storage media response nebo cache metadata média. Upload má aktuálně `cacheControl = 3600`; TTL signed tokenu 300 sekund neznamená zákaz cache již staženého audia.

Načtení playeru, signed URL nebo změna tabu nesmí samo vytvořit play intent. Intent s `play: true` smí vzniknout jen z přímého uživatelského kliknutí. Pokud metadata ještě nejsou připravená, skutečné `play()` může tento uložený explicitní intent flushnout až po `loadedmetadata`; stále nejde o autoplay. Akce transcriptu bez single audia dál scrolluje/highlightuje, pokud existuje renderovatelný block, ale nesmí zkoušet audio fetch/seek ani předstírat anchor, který v transcriptu není.

## Realtime není jen UI funkce

Realtime přepis ovlivňuje credentials, storage průběžných segmentů, reconnect logiku, mobilní uspávání a stavový model. I když nebude implementovaný první, datový model a UI stavy s ním musí počítat.

## API privacy policy se musí ověřovat

Požadavek projektu je používat jen API režim providerů, kteří defaultně nepoužívají zákaznické API vstupy a výstupy k tréninku modelů. Před implementací nebo změnou providera je nutné ověřit aktuální znění podmínek.

## Consumer aplikace nejsou totéž co API

ChatGPT, Claude nebo Gemini v běžném webovém rozhraní nejsou totéž jako jejich API produkty. Pro tento projekt se citlivější obsah posílá jen přes server-side API integrace.

## Auth není veřejná registrace

Vosio má zatím interní přihlášení přes Supabase Auth. Uživatelé se zakládají ručně v Supabase dashboardu a aplikace nemá nabízet registraci, dokud není navržený veřejný onboarding a abuse/rate-limit model.

## Mazání není jen smazání řádku

Uživatel musí umět smazat audio, transcript a AI výstupy. Implementace musí odstranit také související objekty v Supabase Storage a nesmí zanechat citlivý obsah v auditu nebo logu.

Aktuální tlačítko koše u nahrávek dělá soft-delete změnou `recordings.status` na `deleted`, aby položka zmizela z hlavního seznamu a zobrazila se v Koši. Trvalé mazání storage objektů je samostatný destruktivnější krok a nesmí se zaměňovat se soft-delete akcí.

Trvalé mazání z Koše musí nejdřív ověřit vlastníka přes běžnou Supabase Auth session a až potom použít service role operace pro Storage a DB delete. Přímé klientské mazání storage objektu nestačí, protože permanent delete má odstranit i kaskádovaná data a nesmí umožnit smazat cizí objekt.

## Browser MIME typy obsahují codec parametry

MediaRecorder může vracet MIME typ ve tvaru `audio/webm;codecs=opus`. Supabase Storage bucket ale porovnává povolené MIME typy proti čistému typu jako `audio/webm`. Před validací, uložením metadat a uploadem do Storage je proto nutné MIME typ normalizovat odstraněním parametrů za středníkem.

Mobilní nebo Windows picker může pro platné `.m4a` vrátit generický `application/octet-stream`. Takový typ nesmí automaticky znamenat odmítnutí ani univerzální povolení: fallback se smí použít jen pro příponu z nahrávacího allowlistu a musí ji převést na její známý Storage MIME (`.m4a` -> `audio/mp4`). Neznámá přípona s generickým MIME zůstává nepodporovaná. Hranice velikosti je inkluzivní (`size <= effective limit`); 33 MiB soubor proto při 50 MiB limitu projde lokální kontrolou.

Upload chyby se do UI nesmí propouštět podle prefixu. Zobrazit se smí jen přesně povolené, délkově omezené lokální validační zprávy; provider detail, request id nebo tajný suffix za jinak známým začátkem se převádí na obecnou bezpečnou chybu. Výběr nového souboru musí před jeho validací vyčistit progress předchozího pokusu, jinak odmítnutý soubor zdědí zavádějící procenta.

Vývojová route `new-recording-e2e` používá skutečný `VosioWorkspace`, ale live a importní capture sloty musí být inertní lokální prezentace. Fixture nesmí mountovat `PersistentRecorderSlot`, `BrowserRecorder` ani `TranscriptImportForm`; testovací kliknutí nesmí spustit Supabase, Soniox ani aplikační API mutaci. Produkční defaulty injekce nemění.

## Soniox realtime region není websocket URL

Pro EU realtime Soniox konfiguraci používej ideálně `SONIOX_REGION=eu`. Pokud je kvůli zpětné kompatibilitě v `SONIOX_STT_WS_URL` hodnota `eu`, aplikace ji interpretuje jako region, ne jako URL. Plná URL má smysl jen ve tvaru `wss://...`.

Soniox temporary API key musí vzniknout ve stejné regionální REST API doméně, do které se pak připojuje realtime WebSocket. Pro `SONIOX_REGION=eu` tedy backend používá `https://api.eu.soniox.com` a browser SDK se připojuje do EU realtime endpointu. Kombinace US auth API a EU realtime WebSocketu vede na chybu typu `Invalid or expired temporary API key`.

## Auth metadata jen pro preference

Vosio používá `user_metadata.vosio_settings` pro netajné uživatelské preference, například výchozí AI model, Soniox realtime model a výchozí jazyk live přepisu. Tato metadata jsou uživatelsky editovatelná a nesmí se používat pro autorizaci, RLS rozhodnutí, role ani bezpečnostní limity.

## Soniox live jazyk a diarizace

Live jazykový katalog používá kódy `auto`, `cs`, `en`, `de`, `es`, `it`, `sk`, `sl`, `hu` a `pl`. Automatický režim posílá `enable_language_identification = true` bez `language_hints`; pevná volba posílá právě jeden hint a `language_hints_strict = true`. Sonioxu tím dáváme preferenci nebo omezení, ale výsledek není absolutní garance pro každý zvukový úsek. `enable_speaker_diarization` zůstává zapnuté v obou režimech, protože jazyk a rozpoznání mluvčích jsou nezávislé volby.

Výchozí jazyk je uložený v uživatelských Auth metadata a lze ho před konkrétním startem přepsat v idle rekordéru. Po zahájení se hodnota pro danou relaci nemění. Tato volba se týká jen live mikrofonu; ruční soubory se přepisují stávající async konfigurací. Nastavení upozornění na dlouhou nahrávku není aktivní lifecycle kontrola a nemá zastavovat ani prodlužovat záznam. Live nahrávání nemá tichý ani časový auto-stop.

## Theme se musí znát už na serveru

Světlý/tmavý režim nestačí držet jen v `localStorage`, protože první serverový render by vždy poslal tmavý `:root` fallback a světlý režim by po refreshi krátce probliknul. Vosio proto ukládá theme i do cookie `vosio-theme`, kterou `app/layout.tsx` čte před vyrenderováním `<html data-theme="...">`. Klientský init skript dál synchronizuje `localStorage`, aby fungovali i uživatelé, kteří cookie ještě nemají.

## Systémové prompty se neupravují přímo

`prompt_templates` obsahuje systémové prompty s `is_system = true` a `user_id = null`. RLS je dovoluje číst, ale ne upravovat běžným uživatelem. UI proto u systémového promptu ukládá upravené hodnoty jako vlastní kopii pod aktuálního uživatele; přímý update platí jen pro `is_system = false`.

Nový systémový prompt nestačí vložit jen do databáze, pokud používá nové placeholdery. Server-side renderer v `POST /api/transcripts/{transcriptId}/process` musí umět každý placeholder nahradit, jinak do AI providera odejde doslovný text jako `{{speakers}}` nebo `{{raw_text}}`. Aktuální podporované placeholdery jsou `{{raw_text}}`, `{{segments}}`, `{{speakers}}`, `{{metadata}}`, `{{custom_prompt}}` a starší aliasy `{{transcript_text}}`, `{{transcript}}`, `{{transcript_segments}}`.

## Gemini modely potřebují samostatný server key

Gemini modely jsou v UI běžné AI modely vedle OpenAI, ale backend je směruje na Google Gemini API podle `ai_processing_jobs.provider`. Pokud uživatel vybere Gemini model a ve Vercelu není `GEMINI_API_KEY`, AI processing selže na server-side konfiguraci. Gemini Free tier podle Google pricing tabulky používá obsah ke zlepšování produktů; pro produkční call obsah používej placený Gemini API režim nebo OpenAI.

## Reasoning modely, ceny a úplnost výstupu

Aktuální katalog modelů nemá uživatelské nastavení `temperature`. OpenAI Responses API dostává pro `gpt-5.6-sol` reasoning `xhigh`, pro `gpt-5.6-terra` `high` a pro `gpt-5.6-luna` `xhigh`; Gemini `generateContent` dostává pro `gemini-3.6-flash` thinking `medium`. Katalogové ceny jsou pouze orientační: Sol $5/$30, Terra $2/$12, Luna $0.20/$1.20 a Gemini $1.50/$7.50 za 1M vstupních/výstupních tokenů; fakturaci potvrzuje provider dashboard. Silnější modely obvykle zachytí více souvislostí, ale menším a levnějším modelům může uniknout více detailů, úkolů nebo důkazů. Evidence pole zůstávají povinnou součástí strukturovaného kontraktu, nezaručují však, že model najde každý relevantní úsek. Pro složité nebo důležité cally preferuj Sol/Terra a výstup zkontroluj proti přepisu. Staré hodnoty modelu v user metadata se při načtení bezpečně normalizují na aktuální model stejné provider rodiny. Pokud provider vrátí chybu modelu, API endpoint ji vrací jako bezpečný `detail`, aby UI neukazovalo jen obecné selhání.

## AI prompt nesmí obsahovat plné Soniox tokeny

`transcripts.segments` může obsahovat token-level Soniox JSON s časem a speaker id pro každé slovo. U delších callů to může vytvořit stovky tisíc až milion tokenů, pokud se JSON pošle přímo do AI promptu. AI endpoint proto před renderem promptu používá kompaktní speaker utterances a do metadat přidává, jestli byly segmenty zkrácené. Plný token-level JSON zůstává v DB pro UI přepis, ale providerům se neposílá celý.

Nový Supabase projekt začíná baseline `20260617000000_initial_schema.sql` a pokračuje přes evidence `20260804100000`, organization `20260804110000`, markers `20260804120000` a transcript search `20260804130000`. Samotná baseline není celý aktuální bootstrap ani kompletní source of truth; tím je pouze celý timestampově seřazený řetězec. Veřejný repozitář stav konkrétní runtime databáze neeviduje, proto před deployem ověř skutečné schema i migration history targetu. Baseline už obsahuje enum `public.ai_provider` s hodnotami `openai` i `gemini`. U existující produkční databáze kontroluj skutečný enum obsah, ne jen historický seznam migrací; bez hodnoty `gemini` spadne založení `ai_processing_jobs` ještě před voláním Gemini API.

## Strukturované AI tabulky jsou odvozené projekce

`ai_outputs` je raw výstup AI providera a zůstává zdroj pro audit, export i fallback zobrazení. `transcript_tasks`, `transcript_chapters`, `transcript_decisions` a `transcript_risks` jsou odvozené pracovní projekce pro UI. Pokud parser strukturovaných položek selže, aplikace nesmí ztratit raw AI výstup. Pokud se smaže `ai_outputs`, odvozené řádky se smažou kaskádou; pokud se uživatel v checklistu označí úkol jako hotový, mění se jen `transcript_tasks.status`, ne původní JSON output.

Běžný authenticated uživatel nemá mít široký update/insert/delete grant nad odvozenými projekcemi. Checklist potřebuje pouze `update (status)` na `transcript_tasks`; ostatní změny obsahu mají vznikat z AI processing endpointu přes service role. Jinak by klient mohl přepsat auditovatelnou projekci bez nového AI jobu.

Individuální smazání úkolu tento grant záměrně nerozšiřuje. Authenticated endpoint nejdřív ověří `auth.getUser()`, pak přes server-only admin klienta načítá i maže jen řádky vlastněné stejným `user_id`. Kvůli deduplikaci opakovaných generací odstraní všechny současné fyzické řádky se stejným owner/title/deadline klíčem v rámci vlastněné nahrávky, jinak by se po refreshi znovu ukázala starší kopie. Raw `ai_outputs` zůstává uložený a další AI generování může stejný úkol vytvořit znovu; trvalé potlačení budoucích generací by vyžadovalo samostatný tombstone kontrakt.

Checklist v AI zpracování může být hluboko ve scrollovatelném detailu. Pokud změna stavu úkolu používá server action s `redirect(nextPath)`, browser po revalidaci skočí nahoru a akce působí pomalu. Interaktivní checklist proto používá optimistický client update a JSON endpoint bez redirectu; SQL grant `update(status)` jen povoluje zápis a sám o sobě scroll problém neřeší.

Opakované AI generování zůstává auditovatelné přes více `ai_outputs`, ale pracovní checklist v UI nesmí slepě zobrazit každou opakovanou projekci. Aplikace deduplikuje strukturované řádky pro zobrazení podle normalizovaného obsahu a u checklistu preferuje uživatelsky změněný stav (`done`, `in_progress`, `waiting`) před čerstvým duplicitním `new` řádkem.

## Evidence quote není důvěryhodný čas

AI provider může poslat quote i milisekundy, ale autoritativní čas vzniká jen unique exact contiguous whole-token matchem quote proti plným uloženým `transcripts.segments`. Normalizace používá NFC, český locale case, whitespace a Unicode punctuation. Nesmí používat NFKC, odstraňovat Unicode symboly ani odstraňovat diakritiku: `C++` nesmí odpovídat `C`, `①` nesmí odpovídat `1` a `pátek` nesmí odpovídat `patek`. Repeated/ambiguous quote musí skončit `null`, ne prvním náhodným výskytem.

Legacy task/decision/risk časy se při renderu jen odvozují do nové kopie; nic se nepersistuje a risk bez quote žádný fallback nedostane. Pro cross-speaker rozsah se preferuje block obsahující celý range, potom block vlastnící start v intervalu `[start, end)`. Díky tomu předchozí block s `endMs === evidence.startMs` nevyhraje nad novým blockem. Když žádný renderovatelný block neexistuje, exact seek single audia může proběhnout bez anchoru, ale UI nesmí předstírat scroll/highlight.

## Marker UUID představuje neměnný pokus

`client_marker_id` není jen náhodné ID řádku. Browser ho vytvoří jednou spolu s přesným offsetem, typem a poznámkou. Když marker request selže, retry musí poslat stejný payload; nesmí přepočítat `performance.now()` ani vytvořit nové UUID, jinak může nejistý první request vytvořit duplicitní moment. Server vrátí existující řádek jen při přesné shodě všech polí. Stejné UUID s jiným recordingem, offsetem, typem nebo poznámkou je konflikt `409`, ne idempotentní úspěch.

Marker clock může začít až po současné připravenosti aktuálního capture a uloženého draftu. Používá monotónní `performance.now()`, ne `Date.now()`, text timeru nebo Soniox timestamp. Offset se ukládá jako integer včetně hranic `0..86400000` ms. Chyba markeru je izolovaná od recorder lifecycle: nesmí volat stop, čistit stream, měnit session generation ani zastavit přepis.

## Organizace nahrávek není strom

`recording_clients` představuje klienta/firmu, `recording_projects` vždy patří jednomu klientovi, ale `recording_folders` jsou záměrně ploché a globální pro daného uživatele. Nepřidávej parent folder ani odvozenou vazbu složky na klienta/projekt bez nového produktového a migračního rozhodnutí. Nahrávka má nejvýše jednoho klienta, projekt a složku, zatímco štítky jsou many-to-many.

Owner bezpečnost nestojí jen na RLS. Každá organizační FK nese i `user_id` a projektová vazba nese `(project_id, client_id, user_id)`, takže projekt jiného klienta nebo vlastníka nesmí projít přímým zápisem. Case-insensitive unikátnost používá funkční indexy nad `lower(btrim(name))`; prostý `unique(name)` by dovolil vizuální duplicity.

Klientské FK mají deferred `NO ACTION`, ne cascade. To záměrně blokuje běžné smazání používaného klienta, ale odklad má umožnit úplné smazání `auth.users`, při kterém se potomci odstraní v téže transakci. Projektová vazba používá PostgreSQL 15 column-list `ON DELETE SET NULL (project_id)`, aby po smazání projektu zůstal `client_id`; složka vynuluje jen `folder_id` a tag links se při smazání nahrávky nebo štítku mažou kaskádou. Tyto dvě citlivé PostgreSQL cesty musí před live apply projít skutečným PG15 parse/runtime testem, nelze je potvrdit regex testem SQL source.

`assign_recording_organization_v1` nahrazuje klienta, projekt, složku i kompletní tag set v jedné transakci. Nerozděluj assignment do více browser zápisů, protože chyba u cizího štítku nebo neodpovídajícího projektu by mohla zanechat částečný stav. Forced RLS, owner policies a přesné grants musí být ověřené i dvěma reálnými uživateli; textový security test není runtime důkaz.

Filtr více štítků znamená ALL, nikoli ANY. Bez `q` používá seznam `list_own_recordings_v1`, řadí `created_at desc, id desc` a další stránku omezuje tuple cursorem `(created_at, id)`, protože offset při souběžném insert/delete může řádky přeskočit nebo zopakovat. Všechny keyset stránky musí používat stejné organizační filtry a opakovaný cursor je chyba. Každé neprázdné `q` jde místo tohoto list flow přes samostatné indexed `search_own_recordings_v1`, které používá vlastní `limit/offset` stránkování a stejné organizační filtry. Kanonizace `client/project/folder/tag` nesmí zahodit `q` ani nesouvisející URL parametry; same-URL navigace nesmí vytvořit trvalý loading lock.

Breakpoint viewportu sám nestačí pro geometrii inboxu uvnitř desktopového workspace. Například viewport 901 px nechá po 248px sidebaru a shell gutters panel široký jen přibližně 599 px, takže pevné desktopové metadata tracky by kolidovaly s akcemi. Řádky proto používají container query nad skutečnou šířkou `.recordings-inbox`: do 680 px obsahové šířky přecházejí na karty, zatímco 1024px a 1440px shell zůstává v desktopovém režimu. Browser regresi měř ve skutečném shellu a ověř zvlášť hlavní obsah, action track i pending/failure stav, ne pouze celkový `scrollWidth`.

## Forward migrace jsou release blocker

Pořadí releasu je evidence `10000`, organization `11000`, markers `12000`, search `13000`, DB postflight každé cílové databáze a teprve potom deploy aplikace. Veřejný Git stav není důkazem, že konkrétní target migrace aplikoval. U neověřeného targetu musí postflight zkontrolovat skutečné sloupce/tabulky/funkce/trigger, PostgreSQL syntaxi, GIN index a authenticated `EXPLAIN`, constrainty, grants, forced RLS, anon-vs-auth a dvouuživatelskou izolaci, current-vs-old transcript výběr, manual/raw/deleted search, runtime keyset/offset stránkování a potřebný backfill. Nikdy nezaměňuj `npm test`, `check` nebo `build` za důkaz stavu vzdálené databáze.

## License marker není tracking

Vosio obsahuje pasivní `vosio-license-marker` v HTML metadatech pro rozpoznání nezměněných nasazení. Marker se nikam neposílá, neidentifikuje uživatele a nesmí se měnit na skrytý phone-home beacon bez výslovného produktového a právního rozhodnutí.

## Search přes transcript je odvozený index

`20260804130000_add_transcript_fulltext_search.sql` přidává stored `tsvector` a GIN indexy; nepřidávej vedle nich neindexované `ilike` nad `transcripts.raw_text` ani netahej celé transcripty do list shellu. `search_own_recordings_v1` používá `websearch_to_tsquery('simple', ...)`, hledá pouze v nejnovějším transcriptu podle `created_at desc, id desc`, vylučuje deleted rows a před rankingem aplikuje owner i organizační filtry. UI posílá jen normalizovaný text do 120 znaků, ne ručně sestavenou SQL/tsquery syntaxi.

`transcript_search_chunks` musí být synchronizované se stejnými renderovatelnými speaker bloky jako UI. Bez speaker bloků patří do indexu jeden raw/manual fallback bez času; trigger ho zapíše v transcript transakci a service-only replace ho při úspěchu atomicky nahradí přesnými chunks. Když přesné indexování selže, uložený transcript se nesmí rollbacknout ani smazat. Zůstane raw fallback a uživatel dostane one-shot warning. Warning se z URL odstraňuje pouze přes `history.replaceState`; nesmí zahodit jiné query parametry ani vytvořit novou history položku.

Vyhledávání s `q` stránkuje po 25 výsledcích pomocí bounded page + RPC offsetu. Běžný seznam bez `q` dál používá keyset `(created_at, id)`. Backfill používá třetí, vzestupný keyset podle transcript UUID. `npm run search:backfill` vyžaduje explicitní environment a live guard; v tomto plánu ho **nespouštět**, protože nebyl schválen žádný DB zápis.

Deep link z výsledku má tvar `tab=transcript&at&highlight`. Čas vybírá obsahující blok, potom následující a až nakonec předchozí; raw transcript může použít vlastní anchor. Highlight-only odkaz je bezpečný jen při jediném výskytu v celém renderovatelném transcriptu. Nejednoznačnost nebo chybějící text musí skončit bez highlightu, ne prvním náhodným výskytem. URL deep link nikdy nevytváří autoplay: `single` audio smí dostat nejvýše jeden seek bez play, `none` a `segmented` pouze scroll/highlight. Po spotřebování se mažou jen `at` a `highlight`, `tab`, ostatní query a browser history state zůstávají.

## Development E2E patří do izolovaného runneru

Playwright nespouštěj přímo. `npm run test:e2e` vytvoří jeden hlídaný temp workspace pod repo `.tmp`, kopíruje jen explicitní allowlist a spustí vlastní Next server s `reuseExistingServer: false`. Config bez runner guardu záměrně selže. Cleanup smí odstranit pouze přesně ověřený přímý temp child; runner nesmí hledat, přebírat ani ukončovat cizí PID nebo listener na portu.

## Submit není potvrzené uložení

Client `onSubmit` proběhne dřív, než server action potvrdí validaci, auth a databázový zápis. Zavření popoveru nebo disclosure přímo v `onSubmit` proto schová chybu a může působit jako falešný úspěch. Kompaktní editory názvu i organizace, včetně create/rename klienta, projektu, složky, štítku a assignmentu nahrávky, se zavírají jen po nové success revision pro vlastní scope; transport rejection se převádí na error state. Při přepnutí záznamu musí settlement starého scope zůstat ignorovaný. Po ručním zavření erroru si editor pamatuje dismissed scope/revision, aby stejný alert po reopen neožil, ale nový vyšší error se zobrazil.

## Mazání je potvrzené a optimistické

Destruktivní akce v UI musí mít potvrzovací dialog. Po potvrzení se položka ve frontendu schová okamžitě a server action doběhne na pozadí přes běžné revalidace/redirecty. Neočekávaný client-action reject musí obnovit přesně označený řádek nebo kartu a ukázat sanitizovanou chybu v plnošířkovém druhém řádku běžného toku layoutu; rozšíření desktop action sloupce nebo absolutní feedback uvnitř tabulky může obsah přetéct, oříznout nebo překrýt s dalším řádkem. Next redirect se propouští beze změny a cílová stránka ukáže stav podle databáze. Optimistické schování nesmí nahrazovat server-side autorizaci ani RLS.

## Mailto není plná mail integrace

Follow-up e-mail v UI používá `mailto:` pro otevření výchozího mail handleru uživatele. To je záměrně jen předání draftu do prohlížeče nebo primární mail aplikace. Skutečné odesílání přes Gmail, Zoho nebo jiného providera vyžaduje samostatnou OAuth/API integraci a nesmí být prezentované jako hotové, dokud není implementované.

## PWA service worker zatím necachuje data

Vosio registruje service worker kvůli instalaci aplikace na mobil. Service worker zatím záměrně necachuje requesty ani API odpovědi, protože audio upload, Supabase Auth session a stavy přepisů musí zůstat online-first a aktuální. Offline cache patří až do samostatného návrhu se sync strategií.

PWA veřejné assety (`/manifest.webmanifest`, `/sw.js`, ikony) musí být vyjmuté z auth proxy. Když je proxy přesměruje na `/login`, mobilní prohlížeč neuvidí manifest ani service worker a aplikace nebude korektně instalovatelná.

## Ochrana opuštění aktivního capture workflow má záměrnou hranici

Aktivní live rekordér je připojený v root layoutu přes `PersistentRecordingSessionProvider`, ne uvnitř route `/recordings/new`. Běžné Next.js přechody, včetně Back/Forward mezi stránkami aplikace, proto zachovají stejnou instanci MediaRecorderu a Soniox session; mimo capture stránku se ovládání přesune do fixed mini panelu. Live blocker dovoluje interní odkazy, ale dál chrání označený navigační submit (zejména odhlášení) a browserové zavření či reload přes `beforeunload`. Souborový upload persistentní není a jeho samostatný token dál blokuje i interní odkazy. Více operací musí používat vlastní tokeny, aby cleanup jedné z nich ochranu druhé omylem nevypnul.

## Stop musí patřit přesné recorder session

Nestačí kontrolovat jen React `status`. BrowserRecorder drží generation pro start session, samostatnou result session a stop ownera tvořeného recording instancí a stop generation. Soniox může při graceful `stop()` dodat poslední result tokeny, proto se jejich okno zavírá až po stopu, ale starší callback už potom nesmí změnit text nové session. Stejnou kontrolu ownera musí dělat upload, metadata update, transcript save, error fallback i `finally`; jinak pozdní promise starého stopu vyčistí nový stream nebo draft.

Draft může při stopu stále vznikat. Recorder na přesně spárovaný pending draft čeká nejvýše 5 sekund. Po timeoutu se audio-backed pozdní řádek failne jen přes jeho původní id/user data. Transcript-only cesta s již dostupným textem dokončí přesný pozdní draft jednou na pozadí a nesmí současně založit fallback řádek. Cleanup nebo settlement jiné generation se ignoruje.

## Development recording factory nesmí být produkční cesta

`developmentRecordingFactory` existuje jen jako úzký seam pro browser E2E skutečného `BrowserRecorder` a `PersistentRecordingSessionProvider`; nahrazuje pouze externí Soniox Recording factory/events. Komponenta factory tvrdě odmítne, pokud `NODE_ENV` není `development`, a route `/login/live-marker-e2e` v produkci volá `notFound()`. E2E dál mockuje pouze MediaDevices/MediaRecorder a HTTP hranice. Nepoužívej tento prop k přepínání provideru, bypassu auth/RLS nebo fake produkčnímu ukládání.

## Next.js public env v client bundle

Ve frontend kódu nevaliduj celé `process.env` jako objekt. Next.js umí spolehlivě inlinovat jen přímé přístupy typu `process.env.NEXT_PUBLIC_SUPABASE_URL`. Když client helper předá celé `process.env` do validátoru, produkční bundle může skončit chybou `Missing or invalid public Supabase environment variables`, i když jsou proměnné ve Vercelu správně nastavené.

## MP4 z telefonu má video MIME typ

MP4 exporty z mobilu obvykle přijdou jako `video/mp4`, i když nás zajímá hlavně audio stopa. Supabase Storage bucket i frontend validace proto musí povolit `video/mp4`; samotný Soniox async přepis podporuje formát `mp4` a audio z kontejneru autodetekuje.

Mobilní file picker filtruj přes kombinaci MIME typů, wildcard `audio/*` a přípon souborů. Některé záznamníky v mobilu neposílají přesný MIME typ, ale soubor s příponou `.m4a`, `.amr` nebo podobně. Validace proto používá MIME typ i fallback podle přípony.

## Supabase plan preference není konfigurace projektu

Každý uživatel může mít v `user_metadata.vosio_settings.supabaseStoragePlan` jinou volbu `auto`, `free` nebo `paid`. Nemění billing, globální limit projektu ani `recordings.file_size_limit` bucketu. Server čte explicitní bucket limit a aplikace použije pouze efektivní minimum `min(bucket, optional plan cap)`; volba jej může jen snížit, nikdy zvýšit nebo autorizovat Storage. Globální limit projektu se bezpečně nedetekuje, proto zůstává `unknown`, ne unlimited. Pokud bucket nebo kladný explicitní limit nelze načíst, aplikace fail-closed vypne audio upload a audio-backed live režim, zatímco text-only přepis zůstane dostupný. Vlastník týmu musí preference jednotlivých uživatelů s reálnou konfigurací projektu sladit ručně.

Live audio má navíc samostatný produktový limit `min(effective upload limit, 128 MiB)`. Není to limit paměti prohlížeče: aktuální MediaRecorder drží jeden Blob až do `stop()`. Aplikace proto odhaduje velikost z bitrate a lokální audio zastaví s rezervou 5 %, nejvýše 2 MiB, aby se vyhnula překročení storage limitu. Před uploadem ještě kontroluje skutečnou velikost finalizovaného Blobu proti plnému live limitu. Přepis po odhození audia pokračuje.

## Text-only live přepis nemá audio zálohu

Režim `Jen live přepis` průběžně ukládá realtime transcript draft do `transcripts`, ale nevytváří Storage audio objekt. Storage file-size limit se ho proto netýká, ale výsledek závisí na funkčním Soniox realtime spojení. Režim `Audio do {live limit} + přepis` ukládá jeden finální audio soubor jen tehdy, když uživatel nahrávání běžně zastaví dřív, než odhad dosáhne bezpečnostní rezervy nebo finalizovaný Blob nepřekročí live limit. Po předčasném ukončení audia přepis pokračuje bez audia.

Tlačítko `Přepsat znovu` funguje jen tam, kde má nahrávka uložené audio. U text-only live přepisu není uložený audio objekt, takže aplikace nemá z čeho Soniox async přepis znovu spustit. Restart přepisu nesmí mazat aktuální transcript hned při založení nového Soniox jobu. Starý transcript musí zůstat uložený až do chvíle, kdy nový provider transcript úspěšně doběhne a server ho jde uložit; teprve tehdy se smažou navázané AI joby/výstupy, aby nezůstaly u nahrazeného textu. Pokud nový Soniox job selže, starý transcript zůstává jako fallback.

## Browser lifecycle může přerušit realtime přepis

Browser PWA neumí garantovat nepřerušený realtime WebSocket, pokud systém uspí počítač, tab, prohlížeč nebo PWA. Vosio se při live nahrávání pokusí získat Screen Wake Lock, po návratu do popředí vyvolá Soniox reconnect a každých zhruba 15 sekund ukládá partial transcript draft, ale timer události ani mikrofon po uspání OS nejsou garantované. Wake Lock warning a warning pro realtime spojení musí zůstat oddělené: selhání Wake Lock samo o sobě neznamená, že se nahrávání nebo přepis zastavil. Live nahrávání nemá tichý ani časový auto-stop; končí ručně nebo přerušením browser lifecycle.

Recovery panel na `/recordings` není náhrada za background recording. Umí dokončit jen to, co už je v Supabase: partial transcript v `transcripts`, jeden již uploadovaný audio objekt nebo části starší segmentované nahrávky. Aktivní MediaRecorder soubor a tokeny, které ještě neproběhly autosavem, může prohlížeč při zavření nebo uspání ztratit.

## Starší live audio segmenty zůstávají čitelné

Nové live nahrávky se už nedělí; pod limitem ukládají jeden objekt `{user_id}/{recording_id}/live/recording.<ext>`. Databáze a serverové přepisovací cesty dál podporují existující záznamy, jejichž `recordings.storage_path` končí `/live/` a označuje složku starších segmentů. Znovupřepis takového legacy záznamu stále založí jeden Soniox async job pro každý objekt a výsledky spojí chronologicky.

## Speaker diarization závisí na tokenech

Vosio žádá Soniox o speaker diarization přes `enable_speaker_diarization: true`. Samotný `raw_text` ale mluvčí neobsahuje; mluvčí jsou v token-level datech v `transcripts.segments` jako pole `speaker`. UI proto musí pro diarizovaný pohled číst `segments`, ne `raw_text`. Pokud Soniox speaker id nevrátí, nejde v UI spolehlivě poznat, kdo mluvil. Horší audio, silná komprese, překrývající se řeč nebo jeden mikrofon daleko od účastníků může diarizaci zhoršit, ale absence speaker bloků může být i čistě zobrazovací problém.

`transcripts.speakers` ukládá souhrn speaker ID, počet tokenů, volitelné ručně zadané jméno a obchodní roli. Soniox neumí říct, jestli je mluvčí klient nebo dodavatel; obchodní role musí vzniknout ručním přiřazením nebo AI inference nad kontextem a musí být označená jako taková. AI processing dostává `speaker_context` z tohoto JSONu, takže ručně potvrzená jména a role se mají promítnout do úkolů, meeting notes a dalších výstupů.

Aktivní tab detailu nahrávky se ukládá do `localStorage` i do cookie `vosio-active-recording-tab` ve tvaru `{recording_id}:{tab}`. Cookie je server-readable a brání viditelnému přeskoku z výchozího tabu `Přepis` po refreshi. Pokud cookie chybí, aplikace může ještě použít starší `localStorage` hodnotu po hydraci; po dalším kliknutí na tab se cookie doplní.

## Nepřenášet transcripty přes shell stránky

`transcripts.raw_text`, `transcripts.segments` a `ai_outputs.output_json` mohou být velké. Pokud je route nepotřebuje přímo zobrazit, nesmí je načítat jen proto, že používá společný workspace shell. Jinak přepínání stránek působí pomalu kvůli Supabase dotazům a RSC serializaci, i když samotné SQL indexy jsou v pořádku. Detail nahrávky má používat cílené dotazy pro jednu nahrávku a list/utility stránky mají předávat prázdné kolekce nebo lehké rows.

## Soniox region musí odpovídat projektu

Soniox API key je vázaný na region projektu. Pokud dashboard ukazuje `Region: United States`, nech ve Vercelu `SONIOX_REGION` prázdné nebo proměnnou odstraň, protože výchozí Soniox endpoint je US. `SONIOX_REGION=eu` používej jen s API klíčem z EU Soniox projektu. Kombinace US klíč + EU REST/realtime endpoint vede k chybě při vytváření temporary realtime key.

## Soniox temporary key expirace není délka nahrávání

`SONIOX_TEMP_KEY_EXPIRES_SECONDS` nastavuje jen dobu, po kterou se browser muze pripojit s cerstve vydanym temporary key. Jakmile je WebSocket pripojeny, nahravka muze bezet dal. Vosio do temporary key requestu neposila zadny limit delky realtime session, protoze realtime nahravani nema mit aplikacni session cap vynuceny provider payloadem.

## Soniox usage je odhad z délky audia

Soniox API účtuje tokenově, ale veřejný pricing uvádí orientační hodinový ekvivalent pro STT. Vosio proto v nastavení počítá Soniox cenu jen z dokončených `transcription_jobs` a známé `recordings.duration_seconds`. Neodvozuj délku z velikosti souboru, počtu slov, transcript tokenů ani rozdílu `started_at`/`completed_at`; to nejsou fakturační metriky a u dlouhých nebo frontovaných jobů by dělaly falešný odhad. Pokud délka chybí, UI musí ukázat neúplné pokrytí a jako zdroj pravdy ponechat Soniox dashboard.

## Live MediaRecorder WebM duration

Browser `MediaRecorder.start(timeslice)` umí vrátit průběžné WebM bloky, které po slepení nemusí mít providerem čitelnou duration. Vosio proto pro nové live audio používá jeden MediaRecorder bez `timeslice` a soubor finalizuje přes `stop()`. Velikost během nahrávání odhaduje z bitrate; ještě před live limitem `min(effective upload limit, 128 MiB)` audio zastaví s rezervou 5 %, maximálně 2 MiB, a pokračuje pouze realtime přepisem. Skutečná velikost finálního Blobu se před uploadem kontroluje znovu. Tento mechanismus nebrání MediaRecorderu držet Blob v paměti, takže ho nepopisuj jako RAM ochranu.

## Live timer musí skončit s nahrávkou

Interval pro timer, autosave a kontrolu velikosti musí být zastaven při úspěšném stopu, chybě startu, text-only finalizaci i unmountu komponenty. Pokud starý interval přežije do další session, sdílí nové refs a může spustit duplicitní autosave nebo jinou akci nad novou nahrávkou. Live nahrávání se samo nezastavuje podle ticha ani podle absence Soniox tokenů.

Live titulky nejsou finální transcript. Soniox realtime může posílat partial tokeny po písmenech nebo s mezivýsledky, takže caption plocha zobrazuje tokeny s krátkým zpožděním a text skládá bez vkládání umělých mezer mezi tokeny. Finální uložený transcript zůstává založený na kompletní sadě přijatých tokenů.

## Import hotoveho prepisu nema audio fallback

Rucne vlozeny hotovy prepis vytvari text-only zaznam bez Storage objektu a bez Soniox `transcription_jobs` radku. Je okamzite pripraveny pro AI zpracovani, ale nejde u nej spustit `Prepsat znovu`, dokud k nemu neni samostatne ulozene audio. UI proto musi text-only zaznamy popisovat jako `Jen text` a neslibovat obnovu prepisu z audia.

Souborovy import hotoveho prepisu prijima `.txt`, `.md` a `.docx`. Legacy `.doc` je binarni format mimo jednoduchy XML/ZIP DOCX tok; nepodporuj ho tichym fallbackem, protoze by to vedlo k poskozenemu textu. Uzivatel ma dokument ulozit jako `.docx`, `.txt` nebo `.md`.

## DevTools CSP šum z rozšíření

Vosio nastavuje v `next.config.ts` základní bezpečnostní hlavičky (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` s mikrofonem jen pro vlastní origin), ale plnou `Content-Security-Policy` zatím ne — vyžadovala by whitelisting Soniox WebSocket a Supabase Storage originů v `connect-src`/`media-src`. Pokud DevTools hlásí blokované `eval` společně se zdroji jako MetaMask, DeepL, překladače nebo `lockdown-install.js`, jde typicky o injektovaný kód rozšíření prohlížeče. Ověřuj to proti response headers a v čistém profilu bez rozšíření; skutečná CSP chyba Vosio by se měla projevit i bez rozšíření.

## Rate limiting je in-memory, per instance

`/api/soniox/realtime-key` a `/api/transcripts/[id]/process` mají per-user fixed-window rate limit přes `src/lib/rate-limit.ts`. Limiter drží okna v paměti procesu — na serverless platformě má každá instance vlastní počítadlo, takže limit je best-effort brzda nákladů, ne přesná garance. Pro přesný limit napříč instancemi by bylo potřeba sdílené úložiště (např. Upstash Redis). Nezvyšuj limity bez rozmyslu: realtime-key limit musí snést reconnecty SonioxClientu během jedné live session.

## Balíček server-only vyhazuje ve Vitest

`src/lib/env.server.ts` a `src/lib/supabase/admin.ts` importují `server-only`, aby omylný import do client komponenty selhal už při buildu. Balíček `server-only` ale vyhazuje i v plain Node prostředí bez `react-server` condition — tedy i ve Vitest. Proto `vitest.config.ts` aliasuje `server-only` na prázdný stub `tests/stubs/server-only.ts`. Když přidáš `import "server-only"` do dalšího modulu testovaného unit testy, nic dalšího nastavovat nemusíš; alias platí globálně.

## Kopie systémového promptu nesmí věřit formuláři

Read-only input ve formuláři není bezpečnostní hranice. Uživatel může `FormData` změnit ručně. Akce pro kopii systémového promptu proto přijímá pouze UUID, znovu načte řádek přes authenticated RLS klienta s `id` a `is_system = true` a kopíruje výhradně načtené hodnoty. Název, prompt, processing type ani output schema z formuláře se při této akci nepoužijí.

Form action vytvoří odesílaný `FormData` snapshot ještě před serverovým settlementem. Během pending stavu proto musí zůstat fieldset i prompt navigace zamknuté; jinak může uživatel vidět novější draft, i když server uložil starší snapshot. Failure editor odemkne a ponechá přesně rozepsaná data.

## AI archiv nesmí načítat celý transcript

Globální archiv potřebuje preview uloženého outputu a odkaz na nahrávku, nikoli `transcripts.raw_text`, Soniox segmenty, speakers, storage metadata nebo provider konfiguraci. Používej samostatný explicitní join kontrakt. Detail nahrávky si dál načítá transcript vlastním úzkým dotazem; archiv ho nesmí začít tahat jen kvůli filtru nebo odkazu.

Query parametr `error` z delete redirectu je nedůvěryhodný vstup. UI smí vykreslit pouze pevnou allowlist zprávu z `canonicalizeAiArchiveSearchParams`; duplicitní nebo neznámé hodnoty se odstraní, aniž by se zahodily platné filtry `type` a `recording`.

## Git tag není deploy ani databázový postflight

Verze v `package.json`, private commit na `dev` a private tag `vX.Y.Z` potvrzují pouze source-only stav private repozitáře. Neprokazují Vercel deploy, aplikaci Supabase migrací ani shodu remote migration ledgeru. Public repozitář má samostatnou historii a sanitizovaný povrch; private commity ani tagy se do něj nikdy nepushují. Public release potřebuje oddělený public checkout a vlastní ověření. Tyto stavy vždy ověř a reportuj samostatně pro konkrétní target.
## Settings runtime kontrakt

Aktivní Settings ovládá jen preference, které aktuální runtime opravdu čte: výchozí AI model pro ruční AI zpracování, Soniox realtime model a jazyk pro nový live záznam a konzervativní per-user strop velikosti uploadu. Volba storage tarifu nikdy nemění Supabase projekt ani bucket.

`outputLanguage`, `audioRetentionPolicy`, `autoProcessAfterTranscription`, `autoProcessingTypes` a `aiTemperature` zůstávají kvůli zpětné kompatibilitě uložené v Auth metadata, ale současný runtime je nepoužívá. UI je proto nesmí prezentovat jako funkční ovládání, dokud neexistuje skutečná server/worker cesta.

`/settings` je jeden dokument: na desktopu scrolluje pouze `.content-area` s `content-area-document`; na mobilu do 900 px je `.content-area` `overflow: visible` a scrolluje dokument nad fixed spodní navigací. Do Settings nepřidávat druhý scroll container ani sticky section navigation.
