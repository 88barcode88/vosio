# Conventions

## Jazyk a pojmy

- Produkt nazývej Vosio.
- Speech-to-text provider nazývej Soniox.
- Nepoužívej název SONiVOX, pokud nejde o explicitní opravu překlepu.
- "Varianta A" znamená upload hotového audio souboru.
- "Varianta B" znamená nahrávání přímo v aplikaci.
- "B1" znamená standardní nahrávání s přepisem po dokončení.
- "B2" znamená realtime přepis během nahrávání.

## Architektonický styl

- Navrhuj cílově robustní systém, ne zahazovací MVP.
- Funkce může být implementovaná později, ale musí být zohledněná v datovém a stavovém modelu, pokud je cílovou schopností.
- Dlouhé operace patří do job/worker vrstvy, ne do dlouhého UI requestu.
- Upload audio souborů má jít přímo do Supabase Storage přes authenticated resumable TUS upload; velké audio nesmí téct přes Vercel.
- Povolené upload formáty vždy odvozuj z průniku explicitního runtime `recordings.allowed_mime_types` bucketu a produktového katalogu M4A, MP3, WAV, WebM, OGG, FLAC a MP4. Prázdný nebo obecný MIME typ nesmí získat oprávnění podle přípony souboru.
- Server-side API route má řešit metadata, autorizaci a vytvoření jobu, ne přenášet velké audio.

## Data a soukromí

- U providerů vždy rozlišuj API režim od consumer web aplikace.
- AI provider musí defaultně nepoužívat API input/output data k tréninku modelů.
- Před implementací provider integrace ověř aktuální privacy/data policy.
- Raw transcript, celé prompty a citlivé AI výstupy nepatří do logů.
- Audit logy ukládají bezpečná metadata.

## Databáze

- Každá uživatelská tabulka má mít `user_id`, pokud existuje vlastnictví uživatelem.
- RLS policy musí být součástí migrace.
- Stavové hodnoty drž konzistentní s `docs/architecture.md`.
- JSONB používej pro provider segmenty, speakers a raw AI output JSON. Pracovní entity z AI výstupů, jako úkoly nebo kapitoly, ukládej normalizovaně do vlastních tabulek s RLS.
- Odvozené AI projekce jsou čitelné pro vlastníka, ale jejich obsah kromě checklist `status` nemá běžný uživatel upravovat přímo. Přegenerování obsahu patří přes nový AI job a service role zápis.
- Mazání musí řešit referenční data i storage objekty.

## Frontend

- Primární UI je pracovní aplikace, ne landing page.
- Při změnách UI čti `DESIGN.md` a `docs/requirements/ui-direction.md`.
- Login je interní vstup do aplikace, ne veřejná registrační stránka.
- Pracovní plocha nesmí jako výchozí stav prezentovat fake meeting/transcript data; pokud funkce ještě není hotová, ukaž reálný prázdný nebo čekající stav.
- Mobil a desktop jsou stejně důležité.
- UI musí ukazovat stav nahrávání, uploadu, přepisu a AI zpracování.
- Chybové stavy musí být srozumitelné a akční.
- PWA návrh musí počítat s limity mobilních browserů.
- Aktivní live nahrávání vlastní root-level persistentní provider, takže běžná interní navigace včetně Back/Forward nesmí rekordér odmontovat ani zobrazovat potvrzení. Globální mini panel musí zůstat dostupný pro návrat a ruční zastavení. Označené navigační formuláře, odhlášení, zavření/reload a odchod mimo aplikaci zůstávají chráněné. Probíhající souborový upload persistentní není a interní navigaci dál blokuje.
- Stav Wake Locku a realtime spojení komunikuj odděleně; varování Wake Locku nesmí tvrdit, že se nahrávání zastavilo.
- V audio režimech je primární stav vždy stav audia; provider health je samostatný textový řádek. `reconnecting` během capture není důvod zastavit, ale při stopu vyžaduje fallback.
- Live režim, jazyk a kvalitu uzamkni pro celou generation. Kvality 32/64/96 kbit/s zobrazují desetinný odhad 14,4/28,8/43,2 MB za hodinu.
- Používej pojmenovaný `<progress>` a úsporné `role=status` zprávy jen při změně fáze, ne při každém upload chunku. Dlouhé názvy souborů musí na mobilu zůstat čitelné s bezpečným zkrácením.
- Manuální upload respektuje efektivní runtime limit `min(recordings.file_size_limit, optional per-user plan cap)`. Uživatelská volba `auto|free|paid` nikdy neautorizuje Storage ani nezvyšuje bucket; neznámý bucket nebo globální limit není neomezený. Live audio používá `min(effective upload limit, 128 MiB)` a bezpečnostní rezervu před finalizací; nepopisuj tento limit jako ochranu paměti prohlížeče.
- Safety části rotují po 15 sekundách a používají jen `part-000000.webm` nebo `.m4a`. Vždy persist before upload; po potvrzeném single archivu vždy remote cleanup before local cleanup.
- AI detail načítá nejprve bounded metadata, jen výchozí otevřené tělo a další těla až po otevření/exportu. Polling je transcript-scoped, jeden request in flight, 2 s prvních 30 s, potom 5 s, s focus catch-up a stopem po 10 minutách.
- Search v běžných seznamech drž lehký a URL řízený. Pokud má hledat v celém transcriptu, přidej nejdřív index/RPC a netahej `raw_text` do shell listu.
- Kompaktní editor existující hodnoty nesmí zavřít plochu už při raw `submit`. Používá controlled draft, scope-keyed `SaveActionState`, `runSaveActionSafely` a `useCloseOnSuccessfulSave`; během pending blokuje všechny dismiss cesty i další submit, po matching-scope success se zavře a vrátí focus na trigger, po error zůstane otevřený s hodnotami a alertem.
- Success status kompaktního editoru drž v persistentním `aria-live="polite"` mimo zavíranou plochu. Inline feedback má rezervovaný slot, aby error a pending retry neposouvaly layout. Manuálně dismissed error revision se při znovuotevření neukazuje, ale vyšší revision ano.
- Full-page formuláře, login, import, search, read-only disclosures a destruktivní potvrzení automaticky nesbaluj. U úspěšného delete zmizí samotná položka, takže success-only collapse kontrakt nedává smysl.
- Detail nahrávky používá jeden dokumentový scroll owner. Player a záložky drž dostupné sticky/fixed vrstvou, ale transcript, AI, časovou osu ani soubory nezavírej do druhého svislého scrolleru.
- Mazání jednotlivého AI úkolu patří do úzkého authenticated endpointu, který po ověření uživatele používá server-only admin klienta vždy se scope `id` i `user_id`. UI má jen kompaktní ikonu koše u úkolu; celý AI artefakt se maže pouze na output card.

## Kód

- TypeScript jako výchozí jazyk.
- Zod pro validaci vstupů a env; strukturované AI výstupy se zatím parsují z JSONu a mapují do projekčních tabulek, strict `output_schema` validace je samostatný hardening krok.
- Server-only provider klienti nesmí být importovatelní do client komponent.
- Nové nebo upravované funkce/metody musí mít komentář hned nad definicí.
- Preferuj čisté helpery bez mutace vstupů.
- Nehardcoduj secrets, limity a názvy bucketů přímo do business logiky.

## Ověření

- `npm.cmd run typecheck` ověřuje Next route typy a TypeScript.
- `npm.cmd run lint` spouští ESLint přes App Router, React a TypeScript pravidla.
- `npm.cmd run test` spouští Vitest unit testy v `tests/unit/`.
- `npm.cmd run test:e2e` spouští Playwright smoke testy v `tests/e2e/` proti lokálnímu dev serveru na portu `3047`.
- `npm.cmd run check` kombinuje typecheck, lint a unit testy pro rychlou před-push kontrolu.

## Dokumentace

- Dokumentace v `docs/` popisuje aktuální stav.
- Nepřidávej historické sekce typu "v1", "updated" nebo "changed".
- Po behavior change aktualizuj odpovídající dokument.
- `docs/requirements/` drž jako aktuální specifikaci cílových funkcí.

## Verze a release

- `package.json` je jediný zdroj verze; UI ji pouze importuje.
- Používej Semantic Versioning a pro každou vydanou verzi přidej datovaný záznam do `CHANGELOG.md`.
- Release metadata drž v samostatném commitu po feature commitech, které popisují.
- Tag, push, deploy a databázový postflight jsou oddělené stavy a reportují se zvlášť.

Každá nová forward migrace je source-only změna, dokud neproběhne samostatně schválený apply a postflight na konkrétním Supabase targetu. Lokální test ani build její aplikaci na vzdálenou databázi neprokazuje.
