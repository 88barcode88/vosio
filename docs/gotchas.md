# Gotchas

## Region serveru a načítání workspace

Při nasazení na Vercel zvol region serverových funkcí blízko vlastní Supabase databáze. CDN u uživatele sama neznamená, že i funkce běží v témže regionu; zkontroluj konfiguraci nasazení a hlavičku `x-vercel-id`. [Vercel konfigurace regionu](https://vercel.com/docs/functions/configuring-functions/region) podporuje `regions` v kořenovém `vercel.json`. Veřejná aplikace region konkrétní instalace nepředepisuje.

Nezrychluj stránku odvozením oprávnění z vlastníka řádku nebo trvalou cache: seznam i detail dál používají čerstvou autoritu. Souběh čtení a pořadí autorizace ověřuje `tests/unit/recording-page-loading.test.tsx`; souběh projektových oprávnění `tests/unit/recording-organization-queries.test.ts`.

Menu jednotlivé nahrávky nabízí `Upravit zařazení` pouze pro soukromý záznam
s oprávněním `manageAccess`, stejně jako detail. Sdílené a projektové nahrávky
se tímto editorem nepřesouvají. Výsledky hledání před prvním otevřením editoru
načítají aktuální zařazení samostatnou autorizovanou akcí, protože search výsledek
neobsahuje štítky; změna klienta/projektu tak zachová složku a štítky.

## Fronta přepisu a potvrzení uloženého textu

`manual_required` je zablokovaný stav, ne běžící provider job. UI zastaví automatické kontroly a nabídne dohledání původní úlohy, bezpečné zastavení nebo výslovný nový pokus po uzavření starého. Soniox processing nelze zrušit; hotový výsledek se má převzít. 401/neúplný seznam/nejisté DELETE nikdy nepotvrdí nepřítomnost. Recovery musí používat původní provider účet, zvláště po rotaci klíče. Přesný kontrakt a native DB proof: [capture API](api/capture-operation-contracts.md).

Interní capture tabulky mají odebraný přímý SELECT i pro `service_role`. BYPASSRLS nenahrazuje SQL grant. Obnova a diagnostika selhání proto čtou přes service-only `get_recording_transcription_recovery_v1` z migrace `20261006140000`; chyba čtení znamená `recovery_unavailable` (503), nikoli změnu stavu (409). V UI jsou kroky pod „Vyřešit přepis“ a konkrétní chyba se další kontrolou stavu nesmaže.

`recordings.status=transcribing` ještě nepotvrzuje odeslání do Sonioxu. Operace `started` s work `ready` a NULL provider ID čeká na worker; GET stav pouze čte. Start používá bounded `after`, HTTPS `NEXT_PUBLIC_APP_URL` umožňuje autentizovaný per-job callback a session reconcile probudí stávající operaci. Callback nikdy nedůvěřuje dodanému výsledku, ověřuje DB custody a provider GET. Rotace Soniox klíče zneplatní staré HMAC callbacks. Bez dostupného callbacku nebo externího scheduleru může úloha přesahující bounded dispatch čekat na další reconcile; přijatý provider POST se neopakuje.

„Dokončit s uloženým přepisem“ je výslovné potvrzení existujícího serverového textu přes session receipt a revision CAS. Nepotvrzuje kompletní audio, neváže chybějící části, nevytváří provider job a nemaže serverové ani místní kopie. Receipt obsahuje `completionMode=saved_transcript` a `audioConfirmed=false`. Aktivní/nejistý přepis nebo purge tuto cestu blokují. Místní dokončený manifest se při reloadu skryje až po serverovém potvrzení stavu; v IDB zůstává zachovaný.

## MCP Function vyžaduje vlastní balení a ověření

Před nasazením `vosio-mcp` spusť `npm run build:mcp`; adresář `generated/` není
verzovaný a generuje se z jediné zdrojové implementace. Next typecheck nenahrazuje
`npm run check:mcp`. Web nepoužívá MCP secrets. Veřejný Supabase issuer není při
self-hostingu nutně interní `SUPABASE_URL`. Vypnutá nebo chybějící konfigurace
zablokuje Function. Nová resource vyžaduje nové připojení, starý `/api/mcp` vrací 404.
Setup po nejistém zápisu vyžaduje ověřenou obnovu receiptu; nesmí vytvořit dalšího
klienta ani přepsat klíč. Viz [runbook](api/mcp-plugin.md).

OAuth web brána předává pouze vlastní Supabase auth cookies a MCP binding cookies.
Ostatní cookies z upstream odpovědi, například Cloudflare `__cf_bm`, ignoruje;
nesmějí změnit platný redirect ani OAuth chybu na `503 temporarily_unavailable`.
Povolené cookies zůstávají host-only: atribut `Domain` se odmítá a jednotlivé
hlavičky `Set-Cookie` se neslučují.

MCP stránky se souhlasem a odebráním připojení používají referrer policy
`same-origin`. Politika `no-referrer` u běžného POST formuláře způsobí
`Origin: null`, který OAuth handler správně odmítá. `same-origin` zachovává
původ vlastních formulářů a zároveň neposílá URL stránky cizím originům.
Prohlížečovou regresi spustíš přes
`npm run test -- --config tests/browser/vitest.config.ts` s nainstalovaným Chromium.

## MCP používá samostatnou upstream OAuth relaci

Codex při obnově tokenu posílá také `scope`. Token endpoint musí přijmout jeho
volitelnou podobu a porovnat normalizovaná oprávnění s uloženým grantem; jinak
nové přihlášení funguje jen do expirace krátkodobého access tokenu. Změna
oprávnění vyžaduje nový souhlas. Scope Vosia se do upstream obnovy neposílá.

Veřejná registrace běží pouze ve Vosio bridge, nikoli v upstream Supabase Auth.
Aktivní konfigurace oznamuje přesnou Function registrační URL. DB limit a úklid
vyžadují forward `20261007100000`; nasazení samotného kódu ho neaplikuje.
Claude Code používá přesný `localhost`, Codex může použít numerický loopback;
port může změnit pouze stejný host a cestu bez query. Nepřepisuj jeden host na druhý.
Klient může cacheovat nepoužité client ID déle než 24hodinovou retenci. V obou
klientech ověř odpojení/znovupřipojení po úklidu; neobcházej `invalid_client`
a nepovažuj ruční vložení OAuth údajů za splněný self-service onboarding.
Všichni klienti s grantem, včetně odvolaného, zůstávají zachováni. Plná kapacita
platných či statických klientů vyžaduje provozní rozhodnutí, ne automatickou revokaci.

Supabase OAuth built-in scopes samy neimplementují `vosio:read`/`vosio:write`.
Bridge proto drží dedikovanou upstream OAuth relaci, encrypted custody a své
hashované opaque tokeny. Nekopíruje ani neobnovuje browser refresh token.
Podepsaný JWT může přežít logout; nový MCP request proto kontroluje i živý
`auth.sessions` řádek a current recording authority. Nejistá rotace refresh
tokenu zablokuje rodinu, vyžaduje nové připojení a neopakuje upstream request.
Odinstalování pluginu samo nezruší backend grant. Viz [runbook](api/mcp-plugin.md).

## P1 source forwardy a historické AI zdroje

Smazání checklistu ponechává původní raw AI text jako historický artefakt.
Aktivní checklist a jeho export používají uložené projekce a přesné tombstones;
raw text není náhradním zdrojem právě smazaných úkolů. HTTP timeout po DELETE
neprokazuje rollback: další ověření je read, další delete vyžaduje nový rozsah
a potvrzení. Odstranění modelu z nabídky nesmí vynulovat cenu historického usage
ani změnit přijatý provider snapshot. Pro model/reasoning picker P1 uživatel
zvolil variantu A; AI detail, Nastavení a Chat používají společné ovládání.

Potlačené úkoly se filtrují před deduplikací příchozích props i lazy bodies.
Jinak starý `done` řádek vytlačí nový `new` úkol a následný filtr odstraní oba.
Potvrzené smazání ruší pouze status overrides daných task/source ID.
Úspěšný DELETE receipt vlastní transcript provider i po přepnutí záložky;
lokální unmount tlačítka nesmí ztratit potvrzení. Změna identity přepisu naopak
starému callbacku zabrání změnit nový checklist.

## Usage není sdílený content scope; Koš nevrací storage_path

Source-only forward `20260922230000_add_owned_usage_and_trash_audio.sql` přidává
owner-only usage summary/duration RPC podle technického `recordings.user_id`.
Širší recordings RLS by příjemci započítalo cizí nahrávky a revoked autorovi naopak
skrylo duration jeho vlastních jobů. Trash v2 přidává pouze bezpečný stav
`none|segmented|single` podle ověřeného canonical locatoru; nepotvrzuje fyzickou
existenci Storage objektu. Reviewed v1 zůstává beze změny. Adopce T3 a neprovedené
DB/runtime gate jsou v [usage/audio kontraktu](api/owned-usage-and-trash-audio.md).

## Sdílený Koš vyžaduje atomický RPC a accepted purge receipt

Source-only forward `20260922220000_add_shared_recording_trash.sql` odděluje session
prepare/start od service Storage cleanup. Po start už revoke nesmí zastavit přesně
přijatou cleanup operaci; started claim nelze release ani obnovit. Staré automatic
RPC nesmějí převzít aktivní manual receipt. T3 nesmí mazat přes admin klienta po
samostatném capability checku. Také granular task/output delete vyžaduje canonical
recording manager, nikoliv technical user_id. Bezpečné Trash termíny vrací bounded
manager-only enrichment; claim tokeny a Storage cesty zůstávají interní. Kontrakt,
kompenzace a dosud neprovedené runtime/race gate jsou v [Trash API](api/shared-recording-trash.md).

## Sdílené seznamy nelze složit z oddělených owner a shared stránek

První sharing migrace backfilluje `recordings.created_by` pod FK `DEFERRABLE INITIALLY DEFERRED`. Před navazujícím `ALTER TABLE` musí `SET CONSTRAINTS public.recordings_created_by_fkey IMMEDIATE` vyhodnotit čekající FK události, jinak PostgreSQL odmítne DDL s `55006`. Po posledním attribution ALTER obnovuje pouze tento constraint do `DEFERRED`; definice FK ani ostatní constraints se nemění. Source test ověřuje pořadí, nikoli skutečný PG apply.

Source-only `20260922200000_add_project_sharing_read_paths.sql` navazuje na T1 sdílení
a připravuje list/search/detail RPC a `count_accessible_recording_statuses_v1`.
Všechny čtou stejný session scope. Staré invoker RPC používají chráněné sloupce a po
T1 revoke nejsou kompatibilní ani pro vlastníka; zákaz se nesmí obcházet širším grantem.
Navazující migrace zakazuje také přímý SELECT projektového ID a autorského UUID.
Projektové ID smí vrátit jen scope-masked RPC; autorské UUID se veřejně nevrací.
T3 musí přepnout volající současně s rolloutem. FTS pořadí, výřezy, přesný počet a facety
patří do DB před stránkováním. Příjemce přesného selected grantu smí vidět název projektu
u své nahrávky a podle něj hledat/filtrovat, aniž má přístup k obecné projektové nabídce.
Soukromá taxonomie autora nesmí ovlivnit sdílenou shodu ani její výřez. Deleted facet je
samostatný úplný počet spravovatelného Koše mimo q/organizační filtry. Kontrakt a
neprovedené DB testy jsou v [read API](api/project-sharing-read-paths.md).

## Pozvánky: Auth není přijetí přístupu

Source-only tok pozvánek vyžaduje Supabase Invite/Magic link šablony s `{{ .Token }}`
a odkazem `{{ .RedirectTo }}`; standardní `ConfirmationURL` není tento OTP kontrakt.
Pouhé ověření Auth nebo otevření odkazu nic nesdílí. Token je pouze v emailovém
fragmentu a následně v paměti stránky; po reloadu se otevírá původní email znovu.
První email-only pozvánka k samostatné private nahrávce nemění viditelnost při odeslání;
pouze ověřené atomické přijetí převede přesné položky na selected a přidá grant.
Projektové private nahrávky tato výjimka nezpřístupňuje. Podrobnosti a neprovedené
Auth/email/race ověření jsou v [kontraktu pozvánek](api/recording-invitations.md).

## Soniox název

V původní úvaze se objevil název SONiVOX. Pro speech-to-text provider v tomto projektu jde o Soniox. SONiVOX je jiný název a nemá se používat jako název provider integrace.

## Vercel a audio

Audio soubory mohou být velké a dlouhé zpracování nepatří do jednoho Vercel requestu. Hlavní upload cesta je frontend -> Supabase Storage TUS endpoint přes authenticated browser session, ne frontend -> Vercel API route -> storage/provider. TUS adaptér posílá 6 MiB chunky a před každým requestem znovu čte access token, protože dlouhému uploadu může mezitím expirivat session. Authorization nastavuj pouze v `onBeforeRequest`; kombinace statického `headers.authorization` a následného `setHeader` v browserovém `tus-js-client` hodnoty přes XHR spojí čárkou a Supabase odmítne neplatnou dvojitou bearer hlavičku.

Manuální vícesouborový upload běží sekvenčně. Průběh celé fronty se počítá z odeslaných bytů, ne z průměru procent jednotlivých souborů; nesmí klesnout při přechodu na další soubor. Zrušení ukončí aktivní TUS upload, ale capture zůstává `uploading`, aby šlo obnovit stejný request a pevně navázaný objekt. Neprovádí přímý zápis `failed`; ani neúspěšná finalizace nesmí předstírat dokončení nebo vytvořit nový objekt. Kontrola stavu musí přiznat vlastní selhání a zrušení zachovat původní identitu. Revokace (`42501`) zakáže další týmové pokračování; soukromá obnova vyžaduje výslovný nový scope, nikoli tichou kopii.

## Playback signed URL není veřejný ani trvalý odkaz

Source T3 `GET /api/recordings/{recordingId}/audio` nejdřív ověří session a aktuální canonical `read` capability pro přesné ID. Až potom smí interní admin lookup načíst úzký technický locator téhož záznamu; canonical prefix a relativní cesta se validují proti technickému vlastníkovi a ID, nikoli proti owner-only podmínce aktuální session. Jeden validovaný objekt podepisuje pouze session Storage klient pod Storage RLS na 300 sekund, ne admin signer. Revoke blokuje nové signed URL; již vydaná URL může fungovat do expirace. Raw `storage_path` a technická metadata se neposílají jako samostatná pole, signed URL ale encoded cestu obsahuje. Přístup, private bucket, signed token a expirace jsou bezpečnostní hranice, ne path secrecy; opaque cesta vyžaduje media proxy. Do klienta nesmí uniknout service role ani interní error detail. Chybějící/nekánonický locator znamená `none`, přesný kanonický `live/` prefix `segmented`; player je eligible jen pro `single`. Capture integrace je součástí současného source; testy tohoto kontraktu nepotvrzují DB/Storage/runtime konkrétní instalace.

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

Source implementace trvalého mazání z Koše používá session prepare/start s trvale uchovaným request UUID. Teprve accepted receipt dovolí service Storage cleanup a exact token-bound finalize RPC. Žádný admin-after-capability DB write není povolen. Current manager je founder sdíleného projektu nebo private/standalone owner, ne nutně technický autor. Jde o checkout kontrakt; live DB apply, Storage běh a scheduler nejsou ověřené ani tímto krokem nasazené.

Supabase TUS upload URL může zůstat platná až 24 hodin. `deleted_at` je proto po dobu pobytu v Koši neměnné a permanentní purge smí začít až při `deleted_at <= now() - 24 hodin`. Storage INSERT/UPDATE policy současně vyžaduje aktivní vlastněný řádek bez purge claimu. Ruční purge po session startu používá service claim s přesným fencing tokenem, znovu projde celý receipt-bound `{user_id}/{recording_id}/` prefix a pozdě dokončené objekty odstraní v omezeném počtu kol; při chybě nebo trvale neprázdném prefixu DB řádek nesmaže. Started operaci už nereleaseuje ani při chybě před prvním Storage delete: zůstává pro bounded recovery nebo dead-letter. Níže popsaný legacy automatický worker má vlastní oddělené release pravidlo.

Automatická Trash retence nemění ruční 24hodinový safety fence. Preference `trashRetentionHours` ovlivní pouze příští přechod aktivního řádku do `deleted`; trigger pak `deleted_at`, retenci a `purge_after` drží jako neměnný snapshot až do restore. Restore snapshot i claim metadata vyčistí, takže další delete přepočítá deadline podle aktuální preference. Legacy deleted řádky musí zachovat historické `deleted_at` a dostanou jen backfill 720 hodin a deadline o 30 dní později.

Cleanup worker je Supabase Edge Function bez schedule. Smí claimnout nejvýše 20 due řádků, držet přesně dva Storage requesty in flight a dokončit pouze vlastní neztracený lease token. Cesta musí kanonicky začínat `{user_id}/{recording_id}/`; mazání `storage.objects` přes SQL je zakázané, používá se pouze Storage API. Chyba před prvním delete pokusem claim releaseuje, ale od okamžiku prvního Storage delete pokusu je výsledek nejistý: remove chyba, následná list chyba i neprázdný prefix musí claim ponechat, aby restore nemohl obnovit částečně smazanou položku. Automatický i ruční purge používají stejnou 15minutovou stale hranici; teprve potom nový token bezpečně převezme retry. Při claim loss se cizí lease nefinalizuje ani nereleaseuje. Scheduler token, service role key, storage cesty ani PII nesmí být v summary nebo logu. Chybějící/špatný custom token a jiná enable hodnota než přesné `true` fail-closed neprovedou žádnou práci. Každý target vyžaduje vlastní schema/grants/RLS postflight a runtime akceptaci; source publikace jeho stav nepotvrzuje.

## Browser MIME typy obsahují codec parametry

MediaRecorder může vracet MIME typ ve tvaru `audio/webm;codecs=opus`. Supabase Storage bucket ale porovnává povolené MIME typy proti čistému typu jako `audio/webm`. Před validací, uložením metadat a uploadem do Storage je proto nutné MIME typ normalizovat odstraněním parametrů za středníkem.

Mobilní nebo Windows picker může pro platné `.m4a` vrátit generický `application/octet-stream`. Takový typ nesmí automaticky znamenat odmítnutí ani univerzální povolení: fallback se smí použít jen pro příponu z nahrávacího allowlistu a musí ji převést na její známý Storage MIME (`.m4a` -> `audio/mp4`). Neznámá přípona s generickým MIME zůstává nepodporovaná. Hranice velikosti je inkluzivní (`size <= effective limit`); 33 MiB soubor proto při 50 MiB limitu projde lokální kontrolou.

Upload chyby se do UI nesmí propouštět podle prefixu. Zobrazit se smí jen přesně povolené, délkově omezené lokální validační zprávy; provider detail, request id nebo tajný suffix za jinak známým začátkem se převádí na obecnou bezpečnou chybu. Výběr nového souboru musí před jeho validací vyčistit progress předchozího pokusu, jinak odmítnutý soubor zdědí zavádějící procenta.

Vývojová route `new-recording-e2e` používá skutečný `VosioWorkspace`, ale live a importní capture sloty musí být inertní lokální prezentace. Fixture nesmí mountovat `PersistentRecorderSlot`, `BrowserRecorder` ani `TranscriptImportForm`; testovací kliknutí nesmí spustit Supabase, Soniox ani aplikační API mutaci. Produkční defaulty injekce nemění.

## Soniox region je uživatelská preference, ne URL

Region se vybírá v Nastavení pro každého uživatele. Global je výchozí. Temporary API key musí vzniknout ve stejné regionální REST API doméně, do které se pak připojuje realtime WebSocket, a async polling musí používat region uložený při vytvoření jobu. Aplikace proto mapuje volbu na pevné podporované endpointy a nepřijímá vlastní URL.

EU volba funguje pouze s EU-enabled Soniox projektem a odpovídajícím regionálním klíčem. Kombinace globálního klíče a EU endpointů vede k access/auth chybě; v takovém případě ověř region projektu a kontaktuj `support@soniox.com`.

## Auth metadata jen pro preference

Vosio používá `user_metadata.vosio_settings` pro netajné uživatelské preference, například výchozí AI model, Soniox realtime model, výchozí jazyk live přepisu a `trashRetentionHours`. Tato metadata jsou uživatelsky editovatelná a nesmí se používat pro autorizaci, RLS rozhodnutí, role ani bezpečnostní limity. Trash retence musí být na serveru sanitizovaná přes allowlist `24`, `168`, `720`; chybějící nebo neplatná hodnota znamená `720`.

## Soniox live jazyk a diarizace

Live jazykový katalog používá kódy `auto`, `cs`, `en`, `de`, `es`, `it`, `sk`, `sl`, `hu` a `pl`. Automatický režim posílá `enable_language_identification = true` bez `language_hints`; pevná volba posílá právě jeden hint a `language_hints_strict = true`. Sonioxu tím dáváme preferenci nebo omezení, ale výsledek není absolutní garance pro každý zvukový úsek. `enable_speaker_diarization` zůstává zapnuté v obou režimech, protože jazyk a rozpoznání mluvčích jsou nezávislé volby.

Výchozí jazyk je uložený v uživatelských Auth metadata a lze ho před konkrétním startem přepsat v idle rekordéru. Po zahájení se hodnota pro danou relaci nemění. Tato volba se týká jen live capture; ruční soubory se přepisují stávající async konfigurací. Nastavení upozornění na dlouhou nahrávku není aktivní lifecycle kontrola a nemá zastavovat ani prodlužovat záznam. Live nahrávání nemá tichý ani časový auto-stop.

Režim `Videohovor: mikrofon + karta` je povolený jen v podporovaném desktopovém Chrome nebo Edge s `getDisplayMedia` a Web Audio; ostatní prostředí zůstávají na `Jen mikrofon`. Picker vždy vyžaduje nový uživatelský výběr sdílené plochy. Je nutné vybrat přímo browserovou kartu Google Meet a ponechat zapnuté `Sdílet také zvuk karty`; Vosio po výběru kontroluje `displaySurface = browser` i přítomnost živé audio stopy. Display video track drží pouze proto, aby browser zachoval sdílení, ale do archivního, Soniox ani safety recorderu jde jen smíchané audio. AudioContext musí před vytvořením recorderů potvrdit stav `running`. Zrušení pickeru, jiná plocha, zdroj bez audia, předčasně ukončený vstup nebo neaktivní mixer nesmí vytvořit draft ani tiše pokračovat jen s mikrofonem. Dočasný `mute` mikrofonu a tab audia se sleduje nezávisle; jeden živý vstup nesmí zakrýt warning druhého. Ukončení sdílení karty nebo mikrofonní stopy během aktivního capture automaticky zastaví a finalizuje dosavadní generation. Browserová PWA neumí zachytit zvuk jiné nativní aplikace bez zdroje, který jí browser skutečně poskytne.

## Theme se musí znát už na serveru

Světlý/tmavý režim nestačí držet jen v `localStorage`, protože první serverový render by vždy poslal tmavý `:root` fallback a světlý režim by po refreshi krátce probliknul. Vosio proto při změně ukládá motiv současně do `localStorage` i cookie `vosio-theme`. `app/layout.tsx` cookie čte před vyrenderováním `<html data-theme="...">`, takže první HTML už obsahuje správný motiv a nepotřebuje hydratační ani veřejný bootstrap skript.

Starší instalace mohly mít motiv pouze v `localStorage`. Když cookie chybí, server označí výchozí HTML jako `data-theme-source="default"` a malá klientská komponenta po hydrataci jednou převede platnou starší hodnotu do cookie. U této jednorázové historické migrace může po prvním načtení nastat jeden přechod motivu; další načtení už používá cookie bez probliknutí. Existující platná cookie má vždy přednost před zastaralým `localStorage`.

## Systémový základ zůstává neměnný

`prompt_templates` obsahuje systémové prompty s `is_system = true` a `user_id = null`. Jejich název, `processing_type`, `prompt_text` originál a `output_schema` se při uživatelské úpravě nepřepisují. `prompt_template_overrides` drží nejvýše jeden vlastní revisioned `prompt_text`; schema sloupec záměrně nemá. Resolver vždy připojí systémové schema, takže read-only pole v UI není bezpečnostní hranice.

Save a reset smějí proběhnout jen přes owner-scoped `SECURITY INVOKER` RPC s `auth.uid()`, forced RLS a expected revision. PostgreSQL `40001` znamená stale edit a musí se zobrazit jako konflikt, ne tiše přepsat novější změnu. Reset pouze nastaví override na inactive a zvýší revizi; staré job snapshots a AI výstupy se nepřepisují.

Nový systémový prompt nestačí vložit jen do databáze, pokud používá nové placeholdery. Server-side renderer v `POST /api/transcripts/{transcriptId}/process` musí umět každý placeholder nahradit, jinak do AI providera odejde doslovný text jako `{{speakers}}` nebo `{{raw_text}}`. Aktuální podporované placeholdery jsou `{{raw_text}}`, `{{segments}}`, `{{speakers}}`, `{{metadata}}`, `{{custom_prompt}}` a starší aliasy `{{transcript_text}}`, `{{transcript}}`, `{{transcript_segments}}`.

## Gemini modely potřebují samostatný server key

Gemini modely jsou v UI běžné AI modely vedle OpenAI, ale backend je směruje na Google Gemini API podle `ai_processing_jobs.provider`. Pokud uživatel vybere Gemini model a běžící server nemá `GEMINI_API_KEY`, AI processing selže na server-side konfiguraci. Gemini Free tier podle Google pricing tabulky používá obsah ke zlepšování produktů; pro produkční call obsah používej placený Gemini API režim nebo OpenAI.

## Reasoning modely, ceny a úplnost výstupu

Modelový katalog v `src/lib/model-options.ts` rozlišuje stabilní UI profil a přesný `providerModel`. Astra Low/Medium oba volají `gpt-6-astra` s různým reasoning; Gemini 3.6/3.8 používají thinking medium. Mistral má samostatný serverový adapter a podporuje temperature; OpenAI/Gemini profily ji nenabízejí. Snapshot nového jobu obsahuje `provider_config.provider_model`; explicitní rozpory provider/model/config selžou jako `invalid_model`. Pouze přesně vyjmenované historické aliasy se normalizují, neznámá preference nevybere placený OpenAI fallback a vypne automatický souhlas. Ceny jsou orientační a platí provider billing; žádný model nezaručuje úplnost. Raw provider chyby se nikdy nevracejí.

## AI prompt nesmí obsahovat plné Soniox tokeny

`transcripts.segments` může obsahovat token-level Soniox JSON s časem a speaker id pro každé slovo. U delších callů to může vytvořit stovky tisíc až milion tokenů, pokud se JSON pošle přímo do AI promptu. AI endpoint proto před renderem promptu používá kompaktní speaker utterances a do metadat přidává, jestli byly segmenty zkrácené. Plný token-level JSON zůstává v DB pro UI přepis, ale providerům se neposílá celý.

Nový Supabase projekt začíná baseline `20260617000000_initial_schema.sql` a pokračuje přes evidence `20260804100000`, organization `20260804110000`, markers `20260804120000`, transcript search `20260804130000`, Trash restore/purge `20260810005550_restore_recordings_from_trash.sql`, status filters `20260813000000`, prompt overrides/job snapshots `20260813090000`, privilege hardening `20260815073029_harden_prompt_override_privileges.sql`, automatic timeline idempotency `20260827094435_add_automatic_timeline_idempotency.sql` a Trash retention `20260827100000_add_trash_retention_deadlines.sql`. Samotná baseline není celý aktuální bootstrap ani kompletní source of truth; tím je pouze celý timestampově seřazený řetězec. Každý target vyžaduje vlastní schema/grants/RLS postflight a runtime akceptaci; source publikace jeho stav nepotvrzuje.

## Strukturované AI tabulky jsou odvozené projekce

`ai_outputs` je raw výstup AI providera a zůstává zdroj pro audit, export i fallback zobrazení. `transcript_tasks`, `transcript_chapters`, `transcript_decisions` a `transcript_risks` jsou odvozené pracovní projekce pro UI. Pokud parser strukturovaných položek selže, aplikace nesmí ztratit raw AI výstup. Pokud se smaže `ai_outputs`, odvozené řádky se smažou kaskádou; pokud se uživatel v checklistu označí úkol jako hotový, mění se jen `transcript_tasks.status`, ne původní JSON output.

Běžný authenticated uživatel nemá mít široký update/insert/delete grant nad odvozenými projekcemi. Checklist potřebuje pouze `update (status)` na `transcript_tasks`; ostatní změny obsahu mají vznikat z AI processing endpointu přes service role. Jinak by klient mohl přepsat auditovatelnou projekci bez nového AI jobu.

Source T3 smazání úkolu vyžaduje session a aktuální destructive manager capability `delete` pro nahrávku: founder u project/selected obsahu, private/standalone owner; editor/reader ani samotný technický autor sdílené nahrávky mazat nesmějí. Endpoint načte úzké task projekce přes session RLS, pomocí `getTaskDedupeKey` určí existující logickou skupinu v téže nahrávce a předá cílové ID, očekávanou verzi a nejvýše 1000 odpovídajících ID do jediného atomického `delete_managed_transcript_task_group_v1`. RPC znovu ověří aktuální autoritu, verzi i skupinu; úspěch vyžaduje odpovídající `deletedCount`. Žádný admin+owner `user_id` delete se nepoužívá. Skupinové smazání brání resurfacing starší kopie; raw `ai_outputs` zůstává uložený a další AI generování může úkol vytvořit znovu. Trvalé potlačení budoucích generací by vyžadovalo samostatný tombstone kontrakt. Jde o source implementaci, ne runtime DB důkaz.

Checklist v AI zpracování může být hluboko ve scrollovatelném detailu. Pokud změna stavu úkolu používá server action s `redirect(nextPath)`, browser po revalidaci skočí nahoru a akce působí pomalu. Interaktivní checklist proto používá optimistický client update a JSON endpoint bez redirectu; SQL grant `update(status)` jen povoluje zápis a sám o sobě scroll problém neřeší.

Opakované AI generování zůstává auditovatelné přes více `ai_outputs`, ale pracovní checklist v UI nesmí slepě zobrazit každou opakovanou projekci. Aplikace deduplikuje strukturované řádky pro zobrazení podle normalizovaného obsahu a u checklistu preferuje uživatelsky změněný stav (`done`, `in_progress`, `waiting`) před čerstvým duplicitním `new` řádkem.

## Evidence quote není důvěryhodný čas

AI provider může poslat quote i milisekundy, ale autoritativní čas vzniká jen unique exact contiguous whole-token matchem quote proti plným uloženým `transcripts.segments`. Normalizace používá NFC, český locale case, whitespace a Unicode punctuation. Nesmí používat NFKC, odstraňovat Unicode symboly ani odstraňovat diakritiku: `C++` nesmí odpovídat `C`, `①` nesmí odpovídat `1` a `pátek` nesmí odpovídat `patek`. Repeated/ambiguous quote musí skončit `null`, ne prvním náhodným výskytem.

Legacy task/decision/risk časy se při renderu jen odvozují do nové kopie; nic se nepersistuje a risk bez quote žádný fallback nedostane. Pro cross-speaker rozsah se preferuje block obsahující celý range, potom block vlastnící start v intervalu `[start, end)`. Díky tomu předchozí block s `endMs === evidence.startMs` nevyhraje nad novým blockem. Když žádný renderovatelný block neexistuje, exact seek single audia může proběhnout bez anchoru, ale UI nesmí předstírat scroll/highlight.

## Marker UUID představuje neměnný pokus

`client_marker_id` není jen náhodné ID řádku. Browser ho vytvoří jednou spolu s přesným offsetem, typem a poznámkou. Když marker request selže, retry musí poslat stejný payload; nesmí přepočítat `performance.now()` ani vytvořit nové UUID, jinak může nejistý první request vytvořit duplicitní moment. Server vrátí existující řádek jen při přesné shodě všech polí. Stejné UUID s jiným recordingem, offsetem, typem nebo poznámkou je konflikt `409`, ne idempotentní úspěch.

Marker clock může začít až po současné připravenosti aktuálního capture a uloženého draftu. Používá monotónní `performance.now()`, ne `Date.now()`, text timeru nebo Soniox timestamp. Offset se ukládá jako integer včetně hranic `0..86400000` ms. Chyba markeru je izolovaná od recorder lifecycle: nesmí volat stop, čistit stream, měnit session generation ani zastavit přepis.

## Organizace nahrávek není strom

Settings usage nesmí sumarizovat přístupné `recordings` přes content RLS: ta zahrnuje i cizí sdílení a po revoke skrývá vlastní obsah. Source volající používají owner-only summary RPC a duration RPC v dávkách nejvýše 1000 raw ID po stabilní deduplikaci. Agregát musí mít právě jeden řádek; čísla z PostgREST přijímáme jen jako nezáporné bezpečné celé číslo nebo jeho desetinný řetězec. NULL součet není nula; hodnoty mimo bezpečný rozsah JS odmítneme místo zaokrouhlení. Chybějící duration řádek znamená neznámou délku, bez accessible/admin fallbacku.

Koš získává audio štítek z `get_managed_recording_trash_v2` po nejvýše 100 ID. `none|segmented|single` označuje validovaný tvar locatoru, ne existenci Storage objektu. Chybějící, cizí, duplicitní nebo neplatná metadata zneplatní načtení celé stránky místo filtrování nebo nepravdivého „bez audia“. Kontrakt je source-only; DB/runtime/Storage ověření zůstává podmínkou rollout podle [owner usage a Trash audio API](api/owned-usage-and-trash-audio.md).

Připravený kontrakt projektového sdílení v `docs/api/recording-sharing.md` je source-only a vyžaduje společnou
adopci serverových RPC, capture, versioned speaker/reindex a custody kontrol. Samotná nová migrace nezabezpečí
stávající service-role endpointy, které filtrují `user_id`; ty obcházejí RLS. Starý neversionovaný reindex po
apply ztrácí service-role EXECUTE. Aplikaci ani migraci proto nepovažuj za samostatně nasaditelnou.

`recording_clients` představuje klienta/firmu; source sharing kontrakt dovoluje `recording_projects` i bez klienta. `recording_folders` jsou záměrně ploché a globální pro daného uživatele. Nepřidávej parent folder ani odvozenou vazbu složky na klienta/projekt bez nového produktového a migračního rozhodnutí. Nahrávka má nejvýše jednoho klienta, projekt a složku, zatímco štítky jsou many-to-many. Tento kontrakt není dokladem live apply; capture integrace zůstává T4.

Osobní klientské, složkové a štítkové FK nadále nesou `user_id`. Sharing forward ale nahrazuje starou projektovou `(project_id, client_id, user_id)` samostatnou FK `project_id`; projektovou autoritu a custody hlídají sharing helpery, triggery a zamykající RPC. Technický autor proto není automaticky manager sdílené nahrávky. Case-insensitive unikátnost používá funkční indexy nad `lower(btrim(name))`, včetně zvláštního částečného indexu pro projekty bez klienta; prostý `unique(name)` by dovolil vizuální duplicity.

Klientské FK mají deferred `NO ACTION`, ne cascade. To záměrně blokuje běžné smazání používaného klienta, ale odklad má umožnit úplné smazání `auth.users`, při kterém se potomci odstraní v téže transakci. Samostatná projektová FK používá `ON DELETE SET NULL`, takže vynuluje pouze `project_id` a ponechá osobní `client_id`; složka vynuluje jen `folder_id` a tag links se při smazání nahrávky nebo štítku mažou kaskádou. FK, sharing custody triggery i kaskády musí před live apply projít skutečným DB runtime testem, nelze je potvrdit regex testem SQL source.

`assign_recording_organization_v1` zamyká vlastní aktivní private nahrávku a nahrazuje klienta, projekt, složku i kompletní tag set v jedné transakci po kontrole capture oprávnění v cílovém projektu a osobních vazeb. U vlastního projektu vyžaduje shodu klienta, spolupracovníkova taxonomie zůstává osobní. Nerozděluj assignment do více browser zápisů, protože chyba u cizího štítku nebo neodpovídajícího projektu by mohla zanechat částečný stav. Forced RLS, sharing policies a přesné grants musí být ověřené i dvěma reálnými uživateli; textový security test není runtime důkaz.

Filtr více štítků znamená ALL, nikoli ANY. Legacy owner-only RPC zůstávají pouze pro kompatibilitu; současné source UI používá `list_accessible_recordings_v1` bez `q` a `search_accessible_recordings_v1` s neprázdným `q`. List řadí `created_at desc, id desc` a další stránku omezuje tuple cursorem `(created_at, id)`, protože offset při souběžném insert/delete může řádky přeskočit nebo zopakovat. Všechny keyset stránky musí používat stejné organizační filtry a opakovaný cursor je chyba. Search používá vlastní `limit/offset` stránkování a stejné organizační filtry. Kanonizace `client/project/folder/tag/status` nesmí zahodit `q` ani nesouvisející URL parametry; same-URL navigace nesmí vytvořit trvalý loading lock.

Breakpoint viewportu sám nestačí pro geometrii inboxu uvnitř desktopového workspace. Například viewport 901 px nechá po 224px sidebaru a shell gutters užší obsah, takže desktopové metadata mohou kolidovat s akcemi. Řádky proto používají container query nad skutečnou šířkou `.recordings-inbox`: do 680 px obsahové šířky přecházejí na karty, zatímco 1024px a 1440px shell zůstává v desktopovém režimu. Nad touto hranicí musí pružný název uvolnit místo klientovi, stavu, délce a úzké ellipsis akci; editor názvu a Koš se zobrazují až v jejím menu. Samostatně při viewportu 900 px a méně skládá toolbar hledání/filtry a full-width `Spravovat`; tento viewport breakpoint neurčuje režim řádků. Rozbalený panel pokročilých filtrů musí tvořit samostatný druhý řádek přes celou šířku formuláře a zachovat stejné vizuální i DOM pořadí hledání, triggeru a polí. Browser regresi měř ve skutečném shellu a ověř zvlášť toolbar, hlavní obsah, ellipsis menu i pending/failure stav, ne pouze celkový `scrollWidth`.

Inbox má jen existující URL-backed filtry `q`, `status`, `client`, `project`, `folder` a opakovatelný `tag`; pokročilé organizační filtry zůstávají keep-mounted. Zdroj a datum jsou zobrazená metadata, ale nejsou součástí tohoto UI-only řezu jako nové filtry. Jejich přidání vyžaduje samostatné produktové a datové rozhodnutí, ne pouze nový control v toolbaru. Recordings-scoped bílá plocha ve světlém režimu vzniká přes existující `surface-raised`; neměň kvůli ní globální teplou paletu.

## Forward migrace jsou release blocker

Neověřené zůstává skutečné two-user runtime RLS, úplná auth-user cascade, authenticated GIN `EXPLAIN` a current-vs-old/manual/raw/deleted search behavior. `npm test`, `check` ani `build` tyto DB runtime mezery nepotvrzují.

## License marker není tracking

Vosio obsahuje pasivní `vosio-license-marker` v HTML metadatech pro rozpoznání nezměněných nasazení. Marker se nikam neposílá, neidentifikuje uživatele a nesmí se měnit na skrytý phone-home beacon bez výslovného produktového a právního rozhodnutí.

## Search přes transcript je odvozený index

`20260804130000_add_transcript_fulltext_search.sql` přidává stored `tsvector` a GIN indexy; nepřidávej vedle nich neindexované `ilike` nad `transcripts.raw_text` ani netahej celé transcripty do list shellu. `search_own_recordings_v1` používá `websearch_to_tsquery('simple', ...)`, hledá pouze v nejnovějším transcriptu podle `created_at desc, id desc`, vylučuje deleted rows a před rankingem aplikuje owner i organizační filtry. UI posílá jen normalizovaný text do 120 znaků, ne ručně sestavenou SQL/tsquery syntaxi.

`transcript_search_chunks` musí být synchronizované se stejnými renderovatelnými speaker bloky jako UI. Bez speaker bloků patří do indexu jeden raw/manual fallback bez času; trigger ho zapíše v transcript transakci a service-only replace ho při úspěchu atomicky nahradí přesnými chunks. Když přesné indexování selže, uložený transcript se nesmí rollbacknout ani smazat. Zůstane raw fallback a uživatel dostane one-shot warning. Warning se z URL odstraňuje pouze přes `history.replaceState`; nesmí zahodit jiné query parametry ani vytvořit novou history položku.

Vyhledávání s `q` stránkuje po 25 výsledcích pomocí bounded page + RPC offsetu. Běžný seznam bez `q` dál používá keyset `(created_at, id)`. Backfill script používá třetí, vzestupný keyset podle transcript UUID. Samostatný `npm run search:backfill` vyžaduje vlastní provozní rozhodnutí. Inline raw fallback backfill je součástí migrace `13000`; každý target musí ověřit svůj výsledek.

Deep link z výsledku má tvar `tab=transcript&at&highlight`. Čas vybírá obsahující blok, potom následující a až nakonec předchozí; raw transcript může použít vlastní anchor. Highlight-only odkaz je bezpečný jen při jediném výskytu v celém renderovatelném transcriptu. Nejednoznačnost nebo chybějící text musí skončit bez highlightu, ne prvním náhodným výskytem. URL deep link nikdy nevytváří autoplay: `single` audio smí dostat nejvýše jeden seek bez play, `none` a `segmented` pouze scroll/highlight. Po spotřebování se mažou jen `at` a `highlight`, `tab`, ostatní query a browser history state zůstávají.

## Development E2E patří do izolovaného runneru

Playwright nespouštěj přímo. `npm run test:e2e` vytvoří jeden hlídaný temp workspace pod repo `.tmp`, kopíruje jen explicitní allowlist a spustí vlastní Next server s `reuseExistingServer: false`. Config bez runner guardu záměrně selže. Cleanup smí odstranit pouze přesně ověřený přímý temp child; runner nesmí hledat, přebírat ani ukončovat cizí PID nebo listener na portu.

## Submit není potvrzené uložení

Client `onSubmit` proběhne dřív, než server action potvrdí validaci, auth a databázový zápis. Zavření popoveru nebo disclosure přímo v `onSubmit` proto schová chybu a může působit jako falešný úspěch. Kompaktní editory názvu i organizace, včetně create/rename klienta, projektu, složky, štítku a assignmentu nahrávky, se zavírají jen po nové success revision pro vlastní scope; transport rejection se převádí na error state. Při přepnutí záznamu musí settlement starého scope zůstat ignorovaný. Po ručním zavření erroru si editor pamatuje dismissed scope/revision, aby stejný alert po reopen neožil, ale nový vyšší error se zobrazil.

## Mazání je potvrzené a optimistické

Destruktivní akce v UI musí mít potvrzovací dialog. Po potvrzení se položka ve frontendu schová okamžitě a server action doběhne na pozadí přes běžné revalidace/redirecty. Neočekávaný client-action reject musí obnovit přesně označený řádek nebo kartu a ukázat sanitizovanou chybu v plnošířkovém druhém řádku běžného toku layoutu; rozšíření desktop action sloupce nebo absolutní feedback uvnitř tabulky může obsah přetéct, oříznout nebo překrýt s dalším řádkem. Next redirect se propouští beze změny a cílová stránka ukáže stav podle databáze. Optimistické schování nesmí nahrazovat server-side autorizaci ani RLS.

Trvalé smazání Storage objektu nesmí důvěřovat samotnému `recordings.storage_path`. Přístup ke sdílení neautorizuje libovolný technický locator, proto purge musí před prvním Storage nebo DB delete krokem fail-closed ověřit prefix konkrétního uživatele i konkrétního `recording_id` a odmítnout zpětná lomítka, traversal a cestu jiné nahrávky.

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

Mobilní file picker používá jeden explicitní seznam MIME typů a přípon odvozený z runtime `recordings.allowed_mime_types` bucketu a běžného produktového katalogu M4A, MP3, WAV, WebM, OGG, FLAC a MP4. Přípony jsou pouze nápověda pro picker, nikoli autorizační fallback. Prázdný MIME a `application/octet-stream` se odmítají i u souboru se známou příponou; běžné browserové aliasy se mohou převést pouze z explicitně dodaného MIME na kanonický typ povolený bucketem.

## Supabase plan preference není konfigurace projektu

Každý uživatel může mít v `user_metadata.vosio_settings.supabaseStoragePlan` jinou volbu `auto`, `free` nebo `paid`. Nemění billing, globální limit projektu ani `recordings.file_size_limit` bucketu. Server čte explicitní bucket limit a aplikace použije pouze efektivní minimum `min(bucket, optional plan cap)`; volba jej může jen snížit, nikdy zvýšit nebo autorizovat Storage. Globální limit projektu se bezpečně nedetekuje, proto zůstává `unknown`, ne unlimited. Pokud bucket nebo kladný explicitní limit nelze načíst, aplikace fail-closed vypne audio upload a audio-backed live režim, zatímco text-only přepis zůstane dostupný. Vlastník týmu musí preference jednotlivých uživatelů s reálnou konfigurací projektu sladit ručně.

Live audio má navíc samostatný produktový limit `min(effective upload limit, 128 MiB)`. Není to limit paměti prohlížeče: kontinuální MediaRecorder drží jeden Blob až do `stop()`. Podle uzamčené volby žádá 32, 64 nebo 96 kbit/s, tedy přibližně 14,4, 28,8 nebo 43,2 desetinných MB/h; browser může skutečný bitrate upravit. Dosažení odhadované hranice ukončí celou aktuální generation důvodem `audio_limit`, finalizuje safety i archiv a teprve potom ukládá metadata. Nesmí zahodit audio a nechat live přepis pokračovat. Transcript-only tímto limitem není omezen.

## Text-only live přepis nemá audio zálohu

Režim `Jen live přepis` průběžně ukládá realtime transcript draft do `transcripts`, ale nevytváří Storage audio objekt. Storage file-size limit se ho proto netýká, ale výsledek závisí na funkčním Soniox realtime spojení. Oba audio režimy drží kontinuální archiv i 15sekundové safety části. Combined výpadek Sonioxu nesmí zastavit audio; po potvrzeném uploadu se použije restart-safe async fallback.

Tlačítko `Přepsat znovu` funguje jen tam, kde má nahrávka uložené audio a aktuální oprávnění k novému capture startu. U text-only live přepisu není uložený audio objekt, takže aplikace nemá z čeho Soniox async přepis znovu spustit. Restart ani úspěšná nová finalizace nesmějí smazat staré transcript/AI artefakty: nová generace má vlastní completion key a latest čtení, historie zůstává zachovaná. Pokud nový Soniox job selže, starý transcript zůstává jako fallback. Legacy destructive completion helper není capture entry point tohoto kandidátu.

## Browser lifecycle může přerušit realtime přepis

Browser PWA neumí garantovat nepřerušený realtime WebSocket, pokud systém uspí počítač, tab, prohlížeč nebo PWA. Vosio se při live nahrávání pokusí získat Screen Wake Lock a každých zhruba 15 sekund ukládá partial transcript draft, ale timer události ani audio vstupy po uspání OS nejsou garantované. Návrat do popředí pouze znovu požádá o Wake Lock; nesmí sám restartovat zdravou Soniox session. Skutečný výpadek řeší SDK přes `auto_reconnect`. Wake Lock warning a warning pro realtime spojení musí zůstat oddělené: selhání Wake Lock samo o sobě neznamená, že se nahrávání nebo přepis zastavil. Live nahrávání nemá časový auto-stop; končí ručně, dosažením audio limitu, zánikem aktivního audio vstupu nebo přerušením browser lifecycle.

Recovery panel na `/recordings` není náhrada za background recording. Umí dokončit jen uzavřené části, které už byly atomicky uloženy do IndexedDB nebo potvrzeny ve Storage, a uložený transcript draft. Aktivní právě otevřený interval a tokeny před autosavem může browser při zavření, crashi, uspání OS nebo ztrátě zařízení stále ztratit.

U audio režimu uložený realtime přepis neprokazuje dokončený audio archiv. Řádek může mít celý text a stále zůstat `uploading`, pokud nebylo potvrzené dokončení audia. Recovery proto kontroluje také skutečné serverové části, očekávaný rozsah a shodu registrované velikosti/MIME. Kompletní části umožňují obnovu, ale samy stav nahrávky nezmění; chybějící část vyžaduje odpovídající místní kopii z původního prohlížeče. Při diagnostice zachovej přepis i audio a nepotvrzuj `completed` jen podle délky textu.

IndexedDB je lokální recovery vrstva, ne serverová fronta. Resume smí číst pouze exact current-owner rows a cleanup pouze exact owner/recording/generation. Storage část se považuje za idempotentně uloženou jen při shodě deterministické cesty, velikosti a MIME; jiná data na stejné cestě jsou konflikt. Po single-archive úspěchu se local data mažou až po přesně potvrzeném remote cleanupu. Zero-row metadata, remote mismatch, segmented fallback nebo local-only stav cleanup zakazují.

## Starší live audio segmenty zůstávají čitelné

Normální live dokončení ukládá jeden objekt `{user_id}/{recording_id}/live/recording.<ext>` a po přesném potvrzení metadat uklidí safety části. Pokud tento archiv selže, ale všechny safety části jsou potvrzené ve Storage, recording se záměrně přepne na segmentovaný prefix `{user_id}/{recording_id}/live/` a async přepis založí jeden Soniox job pro každý objekt. Local-only části zůstanou obnovitelné a nesmějí se prezentovat jako potvrzené serverové audio.

Server přijímá v `/live/` jako audio části výhradně `part-000000.webm` nebo `part-000000.m4a` se souvislými indexy od nuly. Unrelated objekty se ignorují; starší či ručně vytvořené názvy, duplicitní index, smíšené přípony nebo mezera v řadě znamenají bezpečný `409`, protože jejich pořadí ani obsah nelze spolehlivě odvodit. Soniox create failure nebo explicitní terminal provider status nesmí shodit samotný recording do `failed`; pouze aktuální job/batch je failed a recording zůstane `uploaded` se stejnými audio metadaty pro nový retry. Transportní chyba pollu nebo chyba zápisu průběžného statusu není důkaz terminal failure: existující job/batch zůstává v dosavadním stavu pro další poll.

## Speaker diarization závisí na tokenech

Vosio žádá Soniox o speaker diarization přes `enable_speaker_diarization: true`. Samotný `raw_text` ale mluvčí neobsahuje; mluvčí jsou v token-level datech v `transcripts.segments` jako pole `speaker`. UI proto musí pro diarizovaný pohled číst `segments`, ne `raw_text`. UI nemá limit čtyř mluvčích a zobrazí všechny vrácené speaker ID; Soniox session podporuje nejvýše 15 mluvčích. Pokud Soniox speaker id nevrátí, nejde v UI spolehlivě poznat, kdo mluvil. Horší audio, silná komprese, překrývající se řeč nebo jeden mikrofon daleko od účastníků může diarizaci zhoršit. Realtime speaker ID je průběžný odhad a může se do finalizace změnit; klient proto partial okno vždy nahrazuje a nikdy ho nepřidává natrvalo. Skutečný reconnect dostane vlastní session index a globální časový offset, aby se tokeny z relací nesrazily. Identitu stejného člověka napříč dvěma provider sessions nelze bezpečně hádat; pro její zpřesnění slouží `Přepsat znovu` nad uloženým audiem přes přesnější async diarizaci.

`transcripts.speakers` ukládá souhrn speaker ID, počet tokenů, volitelné ručně zadané jméno a obchodní roli. Soniox neumí říct, jestli je mluvčí klient nebo dodavatel; obchodní role musí vzniknout ručním přiřazením nebo AI inference nad kontextem a musí být označená jako taková. AI processing dostává `speaker_context` z tohoto JSONu, takže ručně potvrzená jména a role se mají promítnout do úkolů, meeting notes a dalších výstupů.

Jména mluvčích se ukládají po changed blur a role okamžitě po změně. Jeden mounted detail používá jedinou promise queue pro všechny mluvčí, protože každý request čte a přepisuje celé `transcripts.speakers`. Per-speaker revisions ignorují stale settlement; failed save zachová draft a retry odešle nejnovější snapshot. Durable save dál volá `replaceTranscriptSearchChunks`, takže chyba indexu je nefatální warning po uloženém speaker JSONu.

The browser queue prevents lost speaker updates originating from one mounted recording detail. It is not a database lock and cannot serialize another tab, device, or external writer. Cross-client atomic speaker patching requires a future row-locking PostgreSQL RPC; until then, avoid editing the same transcript speakers concurrently in multiple clients.

Aktivní tab detailu nahrávky se ukládá do `localStorage` i do cookie `vosio-active-recording-tab` ve tvaru `{recording_id}:{tab}`. Cookie je server-readable a brání viditelnému přeskoku z výchozího tabu `Přepis` po refreshi. Pokud cookie chybí, aplikace může ještě použít starší `localStorage` hodnotu po hydraci; po dalším kliknutí na tab se cookie doplní.

## Nepřenášet transcripty přes shell stránky

`transcripts.raw_text`, `transcripts.segments` a `ai_outputs.output_json` mohou být velké. Pokud je route nepotřebuje přímo zobrazit, nesmí je načítat jen proto, že používá společný workspace shell. Jinak přepínání stránek působí pomalu kvůli Supabase dotazům a RSC serializaci, i když samotné SQL indexy jsou v pořádku. Detail nahrávky má používat cílené dotazy pro jednu nahrávku a list/utility stránky mají předávat prázdné kolekce nebo lehké rows.

## Soniox region musí odpovídat projektu

Soniox API key je vázaný na region projektu. Global je bezpečný výchozí režim pro běžný projekt. EU vybírej v Nastavení jen s EU-enabled Soniox projektem a odpovídajícím regionálním klíčem. Nový async job uloží region do `transcription_jobs.provider_config`; pozdější změna uživatelské preference nesmí přesměrovat už existující job.

## Soniox temporary key expirace není délka nahrávání

Temporary key má v aplikaci pevnou interní životnost 60 sekund a není konfigurovatelný. Jde jen o dobu, po kterou se browser může připojit s čerstvě vydaným klíčem. Jakmile je WebSocket připojený, nahrávka může běžet dál. Vosio do temporary key requestu neposílá žádný limit délky realtime session, protože realtime nahrávání nemá mít aplikační session cap vynucený provider payloadem.

## Soniox usage je odhad z délky audia

Soniox API účtuje tokenově, ale veřejný pricing uvádí orientační hodinový ekvivalent pro STT. Vosio proto v nastavení počítá Soniox cenu jen z dokončených `transcription_jobs` a známé `recordings.duration_seconds`. Neodvozuj délku z velikosti souboru, počtu slov, transcript tokenů ani rozdílu `started_at`/`completed_at`; to nejsou fakturační metriky a u dlouhých nebo frontovaných jobů by dělaly falešný odhad. Pokud délka chybí, UI musí ukázat neúplné pokrytí a jako zdroj pravdy ponechat Soniox dashboard.

## Live MediaRecorder WebM duration

Browser `MediaRecorder.start(timeslice)` umí vrátit průběžné WebM bloky, které po slepení nemusí mít providerem čitelnou duration. Vosio proto pro nové live audio používá jeden MediaRecorder bez `timeslice` a soubor finalizuje přes `stop()`. Velikost během nahrávání odhaduje z bitrate; ještě před live limitem `min(effective upload limit, 128 MiB)` zastaví a finalizuje celou capture generation s rezervou 5 %, maximálně 2 MiB. Skutečná velikost finálního Blobu se před uploadem kontroluje znovu. Tento mechanismus nebrání MediaRecorderu držet Blob v paměti, takže ho nepopisuj jako RAM ochranu.

## Live timer musí skončit s nahrávkou

Interval pro timer, autosave a kontrolu velikosti musí být zastaven při úspěšném stopu, chybě startu, text-only finalizaci i unmountu komponenty. Pokud starý interval přežije do další session, sdílí nové refs a může spustit duplicitní autosave nebo jinou akci nad novou nahrávkou. Live nahrávání se samo nezastavuje podle ticha ani podle absence Soniox tokenů.

Live titulky nejsou finální transcript. Soniox realtime může posílat partial tokeny po písmenech nebo s mezivýsledky, takže caption plocha zobrazuje tokeny s krátkým zpožděním a text skládá bez vkládání umělých mezer mezi tokeny. Finalizované tokeny se akumulují, ale celé nefinální okno se při každém výsledku nahradí. Při reconnectu se poslední nefinální okno jednou zachová jako fallback a nová relace pokračuje s globálním časovým offsetem.

## Import hotoveho prepisu nema audio fallback

Rucne vlozeny hotovy prepis vytvari text-only zaznam bez Storage objektu a bez Soniox `transcription_jobs` radku. Je okamzite pripraveny pro AI zpracovani, ale nejde u nej spustit `Prepsat znovu`, dokud k nemu neni samostatne ulozene audio. UI proto musi text-only zaznamy popisovat jako `Jen text` a neslibovat obnovu prepisu z audia.

Souborovy import hotoveho prepisu prijima `.txt`, `.md` a `.docx`. Legacy `.doc` je binarni format mimo jednoduchy XML/ZIP DOCX tok; nepodporuj ho tichym fallbackem, protoze by to vedlo k poskozenemu textu. Uzivatel ma dokument ulozit jako `.docx`, `.txt` nebo `.md`.

## DevTools CSP šum z rozšíření

Vosio nastavuje v `next.config.ts` základní bezpečnostní hlavičky (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` s mikrofonem jen pro vlastní origin), ale plnou `Content-Security-Policy` zatím ne — vyžadovala by whitelisting Soniox WebSocket a Supabase Storage originů v `connect-src`/`media-src`. Pokud DevTools hlásí blokované `eval` společně se zdroji jako MetaMask, DeepL, překladače nebo `lockdown-install.js`, jde typicky o injektovaný kód rozšíření prohlížeče. Ověřuj to proti response headers a v čistém profilu bez rozšíření; skutečná CSP chyba Vosio by se měla projevit i bez rozšíření.

## Rate limiting je in-memory, per instance

`/api/soniox/realtime-key` a `/api/transcripts/[id]/process` mají per-user fixed-window rate limit přes `src/lib/rate-limit.ts`. Limiter drží okna v paměti procesu — na serverless platformě má každá instance vlastní počítadlo, takže limit je best-effort brzda nákladů, ne přesná garance. Pro přesný limit napříč instancemi by bylo potřeba sdílené úložiště (např. Upstash Redis). Nezvyšuj limity bez rozmyslu: realtime-key limit musí snést reconnecty SonioxClientu během jedné live session.

Recording chat používá stejný per-instance princip s limitem 10 nových claimů za minutu na uživatele; opakování stejného `client_turn_id` se vrací před limiterem a znovu nevolá providera. `running` tah je čerstvý přesně 10 minut. Teprve autorizovaný GET/POST po této hranici ho compare-and-set podmínkou `status = running` a starším `started_at` označí jako `failed`. Aktivní provider kontext je deterministicky omezený počtem znaků, ne přesným provider tokenizerem: kompaktní segmenty 100 000, raw fallback 60 000 a nejnovější dokončená historie 24 000 znaků. Oříznutí je součástí untrusted user-role metadata pro model; starší tahy přitom zůstávají uložené a viditelné v historii. Chat je dostupný jen nad uloženým vlastněným přepisem; samotný tab ani GET nevolají providera. Browser nesmí vytvořit chat řádek přímo přes Supabase, vložit prompt/provider/context ani prohlásit provider timestamp za důkaz. Pouze server přes `service_role` zapisuje tah a čas důkazu odvodí až z jednoznačného exact contiguous matchu proti uloženým tokenům.

## Balíček server-only vyhazuje ve Vitest

`src/lib/env.server.ts` a `src/lib/supabase/admin.ts` importují `server-only`, aby omylný import do client komponenty selhal už při buildu. Balíček `server-only` ale vyhazuje i v plain Node prostředí bez `react-server` condition — tedy i ve Vitest. Proto `vitest.config.ts` aliasuje `server-only` na prázdný stub `tests/stubs/server-only.ts`. Když přidáš `import "server-only"` do dalšího modulu testovaného unit testy, nic dalšího nastavovat nemusíš; alias platí globálně.

## Prompt override nesmí věřit formuláři

Read-only input ve formuláři není bezpečnostní hranice. Uživatel může `FormData` změnit ručně. Save action proto přijímá jen systémové UUID, expected revision a `prompt_text`; reset jen UUID a revizi. Processing type, název, `output_schema` ani `user_id` se z browseru do RPC neposílají. Quick-action processing endpoint navíc přijímá pouze processing type a model a effective prompt řeší server-side.

Prompt snapshot sloupce nelze přidat jako čistý contract krok, pokud ještě běží app `0.1.5`: její insert zná jen `prompt_id`. Migrace `130900` proto obsahuje expand-kompatibilní `BEFORE INSERT` trigger, který starému payloadu doplní autoritativní snapshot ještě před `NOT NULL` a exact-snapshot checkem, ale již úplný payload nového buildu zachová. Migrace `15073029` dále zužuje původní tabulkový ACL, odebírá browser-role `EXECUTE` trigger helperu a přidává reverse-FK index. Každá instalace musí ověřit expand kompatibilitu, přesný ACL, forced RLS, validní index a datové invarianty.

Form action vytvoří odesílaný `FormData` snapshot ještě před serverovým settlementem. Během pending stavu proto musí zůstat fieldset i prompt navigace zamknuté; jinak může uživatel vidět novější draft, i když server uložil starší snapshot. Failure editor odemkne a ponechá přesně rozepsaná data.

## AI archiv nesmí načítat celý transcript

Sdílený příjemce nevidí privátní `ai_processing_jobs`: INNER join na job proto skryje
uložený výstup a LEFT join neposkytne jeho typ. Source-only RPC
`get_accessible_ai_output_types_v1` doplňuje pouze autoritativní typ již přístupných
výstupů podle jejich ID (nejvýše 1000 položek). T3 musí číst output přes RLS a typ
přes tutéž session; chybějící typ nelze odhadovat z JSON ani doplnit přes admin klienta.
RPC znovu ověří aktuální oprávnění; dva oddělené requesty nesdílí atomický snapshot.
Podrobnosti a neprovedený runtime gate: [projekce typů](api/shared-ai-output-types.md).

Globální archiv potřebuje preview uloženého outputu a odkaz na nahrávku, nikoli `transcripts.raw_text`, Soniox segmenty, speakers, storage metadata nebo provider konfiguraci. Používej samostatný explicitní join kontrakt. Detail nahrávky si dál načítá transcript vlastním úzkým dotazem; archiv ho nesmí začít tahat jen kvůli filtru nebo odkazu.

Query parametr `error` z delete redirectu je nedůvěryhodný vstup. UI smí vykreslit pouze pevnou allowlist zprávu z `canonicalizeAiArchiveSearchParams`; duplicitní nebo neznámé hodnoty se odstraní, aniž by se zahodily platné filtry `type` a `recording`.

## Git tag není deploy ani databázový postflight

Verze v `package.json`, private commit na `dev` a private tag `vX.Y.Z` potvrzují pouze source-only stav private repozitáře. Neprokazují Vercel deploy, aplikaci Supabase migrací ani shodu remote migration ledgeru. Public repozitář má samostatnou historii a sanitizovaný povrch; private commity ani tagy se do něj nikdy nepushují. Public release potřebuje oddělený public checkout a vlastní ověření. Tyto stavy vždy ověř a reportuj samostatně pro konkrétní target.
## Settings runtime kontrakt

Aktivní Settings ovládá jen preference, které aktuální runtime opravdu čte: výchozí AI model pro ruční i automatické výstupy, čerstvé volby `automaticOutputTypes` a zachovaný explicitní opt-in `autoTimelineAfterTranscription`, Soniox realtime model a jazyk pro nový live záznam a konzervativní per-user strop velikosti uploadu. Volba storage tarifu nikdy nemění Supabase projekt ani bucket.

`outputLanguage`, `audioRetentionPolicy`, `autoProcessAfterTranscription`, `autoProcessingTypes` a `aiTemperature` zůstávají kvůli zpětné kompatibilitě uložené v Auth metadata, ale současný runtime je nepoužívá. UI je proto nesmí prezentovat jako funkční ovládání, dokud neexistuje skutečná server/worker cesta.

## Manuální AI `after()` je source kontrakt, ne live runtime důkaz

Route deklaruje `maxDuration = 300` a odvozený klientský `stalled` práh používá stejných 300 sekund plus tříminutovou grace; manual claim má lease 480 sekund. Skutečný limit hostingu a to, zda konkrétní nasazení nechá `after()` provider volání doběhnout, musí před release projít izolovaným runtime proofem. Source test potvrzuje 202 před settlementem, idempotentní UUID, claim a persistence pořadí, ale nepotvrzuje live Vercel lifetime. Bez tohoto proofu se stav smí označit jen jako source-only.

Manual job callback nesmí být zaměněný s automatic timeline lease RPC. Nový job filtruje `execution_mode = manual`, `status = queued`, `attempt_count = 0`, `max_attempts = 1` a přesnou trojici job/user/transcript. Browser po přijetí nebo nejistém transportním výsledku request neabortuje a nepoužívá `router.refresh`; stejný UUID pouze načte durable stav. Explicitní retry po terminal `failed` vytváří nové UUID, starý job se nemaže. Reconcile endpoint pracuje jen s přesným jobem a akcí `reconcile` nebo `interrupt`; čerstvý running job neslibuje zrušení provideru.

Stale `running` job se nikdy automaticky neopakuje, protože provider negarantuje idempotenci. Reconcile nejprve zkontroluje owner-consistentní `ai_outputs`: s outputem uzavře job jako `done`, bez outputu jako `failed / execution_interrupted`. Legacy tvar vrátí `operator_required`. Všechna tři manual RPC jsou `SECURITY INVOKER` s prázdným `search_path`, plně kvalifikovanými objekty a `EXECUTE` pouze pro `service_role`.

Manual AI failure metadata jsou bezobsahová. Persistovat, API vracet, do UI zobrazit ani logovat se smějí jen kódy `insufficient_credit_or_quota`, `rate_limited`, `invalid_model`, `provider_unavailable`, `provider_configuration`, `execution_interrupted`, `persistence_failed`, `unknown` a validní `retry_after_at` pro rate-limit. Raw provider message, prompt, transcript, output nebo secret se nesmí objevit v error envelope ani logu.

Polling `ai-state` řídí autoritativní `poll_eligible`, nikoli samotný queued/running status. Běží jen na visible/online AI nebo Timeline: 10 s prvních 30 s, 30 s mezi 30 a 120 s a 60 s poté. Lifecycle catch-up je deduplikovaný a pouze více než 30 s po dokončené kontrole. Po transientní chybě backoff nejméně 30 s, nejvýše jeden request. Neznámý legacy lifecycle se nezkouší donekonečna a nevytváří automatický placený retry.

Same-transcript revalidace detailu může předat prázdné lazy AI props: nesmí vymazat načtenou cache, zvýšit reset revizi ani odmountovat rozbalené výstupy/úkoly. Potvrzené smazání výstupu nebo úkolu se propaguje přes přesná odstraněná ID a lokální tombstones; chybějící položka v bounded metadata stránce není důkaz smazání. Změna transcriptu resetuje generation a ignoruje staré odpovědi. Lokální stav, drafty, focus a scroll se při stavovém pollu zachovávají.

Chyba nového kliknutí na `Zkusit znovu` je samostatný viditelný status z `useAiProcessingRun`, nikoli jen historická chyba původního jobu. `retry_after_at` tlačítka odemyká jediný řetězený lokální timeout podle skutečného času, postupně pro všechny čekající joby. Nevyžaduje metadata polling ani automatický nový provider pokus.

## Automatické AI není backfill ani cron

Pět nově aktivních výstupů vyžaduje čerstvý `automaticOutputTypes` seznam (default `[]`); timeline zachová vlastní explicitní boolean. Dormant `autoProcessAfterTranscription` a `autoProcessingTypes` nejsou souhlas. Nový capture dokončuje history-preserving session/worker RPC. Completion trigger uloží soukromé immutable snapshoty všech předem zvolených typů bez AI intentu/jobu/provider callu. Následné schedule_capture_automatic_intents_v2 vyžaduje current osobní read/manage autoritu a dosud platný opt-in; použije pouze uložené snapshoty. Audio-only obnova čeká na STT; partial draft AI nespouští.

Po commitu může být odpověď ztracená nebo může selhat první enqueue. AI/Timeline obnoví pouze již uložený current-generation intent; nastavení se pro opakované completion ani recovery znovu nepoužije k vytvoření dalších typů. V1 RPC wrappers smějí spouštět pouze timeline a zachovávají její digest. Úspěšný či terminální job nesmí získat nový provider pokus po smazání outputu.

Automatický worker používá povinnou atomic publication strategy. Raw output se nesmí nejdřív vložit běžným insertem a teprve potom kontrolovat lease. V2 publication zamyká transcript -> job, ověřuje generaci/owner/intent/platný lease před zápisy a transakčně spojuje output, projekce a done/usage settlement. SQL chyby projekce se nepolykají. Manuální persistence a cleanup zůstávají oddělené.

`ai-state` přidává odděleně bounded šest current-generation automatických summaries vedle padesáti manuálních; všechny automatické klasifikace mají prázdné manual actions. Viditelné online AI/Timeline načte metadata po enqueue, polluje způsobilou práci a lokálně hydratuje výsledky/projekce úspěšných sourozenců. Terminální sourozenci nebrání pollingu zbývajících. GET nesmí vytvářet intenty ani volat providera. Recovery má vlastní POST. Provider timeout je 240 s, route `maxDuration` 300 s a lease 900 s; skutečný hosting může práci přerušit, žádný cron tuto garanci nenahrazuje.

[Rollout a Management API proof](api/automatic-ai-outputs.md) odděluje rollback rehearsal od skutečných dvou-session závodů. Additive schema musí být aplikované a postflight zelený před publikací nové aplikace; remote migration ledger se neopravuje automaticky.

Zapnutí `autoTimelineAfterTranscription` platí jen pro completion persistovaná po uložení preference. Staré dormant `autoProcessAfterTranscription` ani `autoProcessingTypes` nesmějí souhlas nahradit. Nový capture si při completion zachová privátní immutable consent/model/provider/prompt snapshot bez spuštění AI. Osobní scheduling a reconciliation vyžadují aktuální `runPersonalAi`: původní osobní vlastník musí mít současný recording read i management. Pozdější změna modelu nebo promptu nesmí přepsat completion snapshot. Otevření historického nebo disabled transcriptu bez eligibility/intentu zůstane `not_scheduled`, nikoli retroaktivní backfill. Live/runtime ověření není provedeno.

Paid-call idempotency zůstává v `ai_processing_jobs` a stejný digest drží recovery intent; nikdy se neodvozuje z `ai_outputs`. Smazání outputu proto nesmí úspěšný job znovu spustit. Claim je service-role-only, atomický, s finite attempts a expirovatelným lease; endpoint nejdřív ověří session, vlastní transcript a canonical `runPersonalAi` nad nahrávkou (aktuální read i management osobního AI vlastníka), teprve potom vytvoří admin klienta. Browser neposílá model, prompt, provider ani processing type. Reconciler dělá při mountu nejvýše jeden request pouze při povoleném `runPersonalAi`; editor, reader ani founder nad cizím osobním AI obsahem pouhým otevřením detailu nic nespustí. Server kontrolu opakuje nezávisle na UI. Refresh vyvolá jen tehdy, když v tomto requestu job skutečně doběhl; settled job vrací `already_done`, aby nevznikl render loop. Žádný cron ani provider klíč se tímto tokem nepřidává.

Browser terminal poll je read-only. Exact async finalize replay vrací původní receipt a nevytváří další generaci. Nová generace nikdy nemaže starší transcripty, AI joby, outputs ani intents. Legacy `complete_transcript_generation_v1` nevolat pro nové capture: obsahuje cleanup a může znovu získávat osobní konfiguraci. Durable transcription custody není oprávnění naplánovat osobní AI; ta má samostatnou aktuální autorizační bránu.

`20260827094435_add_automatic_timeline_idempotency.sql` se na existující target nesmí aplikovat naslepo. Povinný read-only preflight je:

```sql
select
  processing_job_id,
  count(*) as output_count,
  array_agg(id order by created_at, id) as ai_output_ids
from public.ai_outputs
group by processing_job_id
having count(*) > 1
order by processing_job_id;
```

Jakýkoli vrácený řádek znamená `live apply blocked pending preflight review` a vyžaduje explicitní lineage review autoritativního outputu; blind dedup, automatická deduplikace ani mazání nejsou povolené. Samotná migrace před unique indexem selže s explicitní výjimkou. Tento source commit nepotvrzuje nulový výsledek, catalog validaci ani apply na žádném targetu.

`/settings` je jeden dokument: na desktopu scrolluje pouze `.content-area` s `content-area-document`; na mobilu do 900 px je `.content-area` `overflow: visible` a scrolluje dokument nad fixed spodní navigací. Do Settings nepřidávat druhý scroll container ani sticky section navigation.

## Stavové facety nejsou počty aktuální stránky

Stavové počty na `/recordings` vznikají přes `count_accessible_recording_statuses_v1`: přesné facety pokrývají celý aktuální `q`, organizační filtry klienta/projektu/složky a ALL sadu štítků. Facety ignorují aktivní `status`, aby šlo jedním kliknutím přepnout na jiný stav; `Smazáno` je samostatný úplný počet Koše. Filtrování jedné 25řádkové search stránky v Reactu by rozbilo `total_count` a stránkování.

Po kanonizaci URL filtrů jsou hlavní list/search dotaz a stavové facety navzájem nezávislé read-only požadavky. Manager počet Koše je sedmá položka stejné facet odpovědi, ne další owner-only dotaz. Musí začít v jednom souběžném kroku; čekání na facety před spuštěním listu přidává do kritické cesty `/recordings` celý zbytečný Supabase round trip. Bez hodnot `client`, `project`, `folder` a `tag` URL okamžitě používá prázdné kanonické organizační filtry a do stejné post-auth fáze spouští i organizační options. Pokud URL organizační hodnotu má, options nejdřív ověří osobní client/folder/tag allowlist; exact project UUID se předá RPC i pro selected-only scope bez obecné project option; teprve potom začnou filtrované dotazy. Selhaná idempotentní read fáze má nejvýše jeden server retry, ale search RPC zůstává samostatná inline chyba a neeskaluje do route erroru. Všechny dotazy dál používají stejnou authenticated session a RLS.

## Hromadný purge není jeden serverový request

Hromadné sdílení má opačný kontrakt než purge: source-only
`bulk_share_recordings_v1` v forwardu `20260923000000` autorizuje všech 1–100 raw
ID před jedinou mutací a celý požadavek atomicky přijme nebo odmítne. App nesmí
volat smyčku single-share. Request UUID musí uložit před prvním voláním; stejný
request vrací historický výsledek i po revoke/purge, nikoli aktuální oprávnění.
Viz [bulk sharing API](api/bulk-recording-sharing.md). pgTAP/isolation ani apply
tohoto kontraktu zatím nebyly provedeny.

Klientský bulk purge spouští pro každý vybraný záznam samostatnou server mutation a drží nejvýše dvě souběžně. Jeden Vercel request proto nikdy nestránkuje ani nemaže Storage pro více nahrávek. Každá položka samostatně zachovává 24hodinový upload fence, DB manager autoritu, receipt-bound recording prefix, claim token, heartbeat a bounded late cleanup. Zastavení fronty neukončuje již běžící jeden nebo dva requesty; zabrání pouze spuštění zbývajících ID. UI průběžně skládá partial result a úspěch jedné položky nesmí skrýt jinou položku, která selhala nebo ještě nebyla spuštěna.

Manual purge nereleaseuje claim při žádné chybě po session startu, ani před prvním Storage remove; to je záměrný rozdíl od staršího automatického workeru. Recovery panel používá vlastní opaque receipt i po revoke. LocalStorage není cross-device záloha prepared operací; started operace obnovuje DB discovery. Viz [aplikační purge API](api/manual-recording-purge-worker.md).

## Async capture receipt není realtime oprávnění ani provider idempotency key

Přepis nemá globální enable přepínač: oprávněný authenticated POST připraví a zahájí operaci přes DB RPC. Uložené audio a přijatý požadavek ale neprokazují běžící worker. Jeho Bearer secret, pravidelné volání a skutečný Soniox běh zůstávají provozními předpoklady podle [runbooku](api/project-sharing-runbook.md). Odstranění přepínače samo žádné existující operace nespouští ani nemaže.

Source-only forward `20260923010000` odděluje browser capture od přijaté async operace. `client_reference_id` je ve zdrojovém Soniox klientu pouze korelace; automatické zopakování POST po timeoutu nebo ztracené submit lease není dovoleno. `uncertain` a vyčerpané service pokusy zůstávají rezervované a blokují Trash/cascade, dokud externě ověřený operator postup nevyřeší přesný receipt. Founder nesmí tuto ochranu obejít novým requestem či browserovým cancel. Již přijatá async práce může přes service pokračovat po revoke, ale další realtime partial/final vyžadují aktuální capture autoritu a musí být odmítnuté.

Request UUID/payload musí caller uchovat před prepare; vlastní operation ID lze obnovit stejným prepare i po revoke. Prepared receipt lze releaseovat bez obnovení členství nebo nechat service expiry po 24 hodinách. Capture revision není `updated_at`. Text-only fallback nesmí odstranit fixní path, pokud kanonický prefix obsahuje jakýkoli Storage objekt; použije audio-preserving recovery nebo retryable chybu. Nová async generace záměrně zachovává staré AI výstupy; samotný transcription receipt neopravňuje osobní AI. Legacy queued/running jobs nejsou automaticky převáděné do nového protokolu. Adopce všech write cest, worker/runbook a runtime gates jsou popsány v [API kontraktu](api/capture-operation-contracts.md); samotné source testy je neprokazují.

## Schválení selected capture není kód ani grant

Editor vybírá founder-approved přesný request přímo v aplikaci. Seznam nezaručuje,
že schválení stále platí při vytvoření: RPC znovu ověří roli, TTL, revokaci i scope.
Jednorázovou rezervaci nelze sdílet mezi více soubory fronty. Soukromá fallback
kopie po ztrátě autority nesmí vzniknout automaticky. U samostatné nahrávky předem
vybíráme potvrzené příjemce; nový email se zve z detailu, pending není přístup.

Přesný receipt hromadného sdílení potvrzuje historickou transakci, ne dnešní grants.
Po úspěchu obnov aktuální čtení. Po nejasné odpovědi drž stejný request a payload;
neoznamuj rollback jen proto, že HTTP request selhal. Provozní akceptace a bezpečný
backout jsou v [sharing runbooku](api/project-sharing-runbook.md).
