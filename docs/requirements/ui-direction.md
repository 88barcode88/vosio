# UI Direction

## Finální směr

Vosio je skandinávsky střídmý pracovní audio workspace ve stylu moderního CRM, Linear a Notion. Nejde o landing page ani marketingovou prezentaci. Hlavní objekt aplikace je vždy nahrávka.

Vybraný produktový hybrid:

- `Vosio Inbox` pro seznam nahrávek,
- `Transcript Studio` pro detail nahrávky,
- `Capture Console` pro novou nahrávku.

Cíl UI:

1. rychle zapnout live nahrávání,
2. rychle nahrát existující audio nebo MP4 soubor,
3. rychle najít starou nahrávku,
4. pracovat nad konkrétní nahrávkou s přepisem, AI výstupy, časovou osou a soubory.

Design má být klidný, pracovní, kompaktní a přehledný. Nepoužívat obří hero bloky, dekorativní marketingové sekce, přehnané "AI app" efekty, velké ikony ani velké běžné písmo. Vizuální pocit má být blíž skandinávskému interiéru: čisté plochy, neutrální vrstvy, přesné rozmístění, málo dekorací.

## Theme

Vosio musí mít plnohodnotný tmavý i světlý režim.

- Tmavý režim je hlavní výchozí pracovní vzhled.
- Světlý režim je plnohodnotný režim, ne dodatečný kompromis.
- Oba režimy musí sdílet stejné komponenty a design tokeny.

Design systém musí od začátku počítat s tokeny pro:

- background,
- surface,
- elevated surface,
- border,
- muted text,
- primary text,
- teal/cyan brand accent,
- red recording/error,
- green saved/success,
- yellow/orange warning,
- speaker colors,
- AI output colors.

## Závazná rozhodnutí

- Produkt v UI se jmenuje Vosio.
- Nepoužívat `Notewise AI`.
- V samotné aplikaci nepoužívat spodní marketingový pás benefitů.
- Teal/cyan je brand accent, ne jediná barva celé aplikace.
- Recording/stop stavy používají červenou.
- Saved/safe stavy používají tlumenou sage zelenou, ne ostrou produktovou zelenou.
- Neutrální šedá a tmavé/světlé surface vrstvy nesou většinu UI.
- Fonty mají být menší a pracovní, bez hero-scale nadpisů uvnitř aplikace.
- Běžné ikony mají být malé; velké dekorativní ikony se nepoužívají.
- H1/H2/H3 jsou povolené, ale běžný obsah má zůstat menší a kompaktní.
- Karty mají být kompaktní a obsahové; nepoužívat velké prázdné dekorativní plochy.
- AI zpracování patří primárně do kontextu konkrétní nahrávky.
- Globální AI stránka nemá být hlavní navigační bod, dokud nemá jasný workflow význam.

## Informační architektura

Sidebar má zůstat čistý a kompaktní:

- `Nová nahrávka`
- `Nahrávky`
- `AI prompty` (`/templates`)
- `Koš`
- `Nastavení`
- spodní utility skupina `Koš`, `Nastavení`, `Dokumentace` nad supportem a účtem uživatele na desktopu
- malá ikona přepnutí světlý/tmavý režim vedle názvu Vosio

Sidebar nemá obsahovat duplicitní seznam nahrávek ani storage kartu. Nahrávky patří na stránku `/recordings` a route `/templates` zůstává stabilní pro `AI prompty`. Na mobilu do 900 px má fixed spodní navigace přesně pět cílů `Nahrávky`, `Nová`, `AI prompty`, `Nastavení`, `Více`; Drawer `Více` zpřístupní `Koš`, `Dokumentaci`, motiv, support a účet s odhlášením.

Desktopový sidebar má 248 px rozbalený a 64 px sbalený. Sbalení je pouze lokální vizuální preference; všechny ikony zůstávají dostupné jako nejméně 44px cíle s popisem.

`AI zpracování` se nemá zobrazovat jako samostatná primární položka v sidebaru, pokud pouze pracuje s výstupy konkrétní nahrávky. AI patří do detailu nahrávky jako tab.

V detailu nahrávky má AI tab fungovat jako jeden vertikální pracovní tok. Nastavení modelu a quick actions jsou nahoře v jedné ploše, uložené AI výstupy jsou pod nimi jako rozbalovací karty s krátkým preview. Model picker nesmí být useknutý rodičovským overflow.

## Obrazovka nové nahrávky

Route: `/recordings/new`

Tato obrazovka má být akční a jednoduchá. Nesmí působit jako hero stránka.

Layout:

1. malý header `Nová nahrávka`,
2. dvě hlavní karty vedle sebe na desktopu:
   - `Nahrávat live`,
   - `Nahrát soubor`,
3. na mobilu karty pod sebou v pořadí live nahrávání, upload souboru.

Stránka má působit jako capture console, ne jako hero stránka. Uživatel musí hned vidět dvě možnosti: `Nahrávat live` a `Nahrát soubor`.

Live karta musí po spuštění ukazovat:

- timer,
- stav mikrofonu,
- stav Soniox realtime spojení,
- režim ukládání s vyřešeným viditelným limitem, například `Audio do 128 MB + přepis` / `Jen live přepis`,
- live titulky,
- mluvčí, pokud je Soniox realtime vrací,
- srozumitelnou chybu, pokud realtime přepis selže, ale lokální nahrávání pokračuje.

Upload karta musí ukazovat:

- jasnou akci pro výběr souboru,
- dropzone pro desktop,
- podporované typy audio/MP4,
- výsledný limit aplikace podle Storage bucketu a volby tarifu Supabase `Auto`, `Free` nebo `Paid` v Nastavení,
- globální projektový limit jako nezjištěný, protože ho aplikace neumí bezpečně detekovat,
- stav uploadu a chybu před pokusem o upload, pokud je soubor moc velký.

Po ukončení live nahrávání nebo dokončení uploadu má uživatel pokračovat na detail nahrávky.

## Detail nahrávky

Route: `/recordings/[recordingId]`

Detail nahrávky je hlavní pracovní plocha. Horní část nesmí být obří karta s dekorací. Má být kompaktní pracovní header podobný detailu záznamu v CRM nebo dokumentu v Notion.

Header má obsahovat:

- editovatelný název nahrávky,
- stav nahrávky a přepisu,
- datum,
- délku,
- velikost,
- typ zdroje,
- relevantní akce jako `Zkontrolovat přepis`, `Export`, `Smazat`.

Kompaktní editor názvu zůstává otevřený po dobu ukládání. Zavře se až po potvrzeném serverovém úspěchu a vrátí focus na ovládací prvek, který ho otevřel. Chyba ponechá rozepsaný název i editor na místě, zobrazí inline alert a opakovaný pokus nesmí způsobit skok výšky. Cancel, Escape, kliknutí mimo a trigger mohou editor zavřít jen mimo pending stav.

Nepoužívat velkou waveform dekoraci přes podstatnou část obrazovky. Vizuální prvky mají podporovat orientaci, ne zabírat pracovní prostor.

Detail má používat taby:

- `Přepis`
- `AI zpracování`
- `Časová osa`
- `Soubory`
- `Chat`

## Přepis

Tab `Přepis` má být čitelný i u dlouhých hovorů.

Požadavky:

- dlouhý přepis používá jediný dokumentový scroll celé detailové stránky; player a taby zůstávají sticky a nevzniká druhý vertikální scroll,
- mluvčí mají stabilní barevné odlišení,
- pokud jsou dostupné Soniox speaker tokeny, zobrazit bloky podle mluvčích,
- pokud speaker data nejsou dostupná, zobrazit souvislý text bez falešného rozdělení,
- bloky přepisu jsou kompaktní řádky jedné tabulky, ne samostatné rozbalovací mini-tabulky,
- změněné jméno mluvčího se automaticky uloží po opuštění pole a role okamžitě po výběru bez ztráty focusu,
- starší settlement nesmí přepsat novější draft; chyba ponechá rozepsané hodnoty a nabídne retry posledního snapshotu.

Cílové režimy zobrazení:

- `Po mluvčích`,
- `Souvislý text`,
- později `Po kapitolách`.

## AI zpracování

Tab `AI zpracování` patří do detailu konkrétní nahrávky.

Má obsahovat:

- výběr typu výstupu,
- dostupné prompty:
  - `Shrnutí`,
  - `Úkoly`,
  - `Časová osa`,
  - `Zápis ze schůzky`,
  - `CRM poznámka`,
  - `E-mail po hovoru`,
- nastavení aktuálního modelu a jeho pevné reasoning/thinking úrovně,
- viditelné stručné upozornění, že silnější modely obvykle zachytí více souvislostí, ale žádný model nezaručuje úplnost; menší model může vynechat detaily, úkoly nebo důkazy,
- seznam již vytvořených AI výstupů jako kompaktní rozbalovací řádky,
- detail vybraného výstupu otevřený až po kliknutí.

AI výstupy mají být uložené a znovu otevřitelné. Nemají být jen dočasná odpověď v panelu.

Ruční AI zpracování musí být odolné vůči navigaci a nejistému transportu. Po odeslání se nejprve zobrazí durable stav `queued` nebo `running`; stejný request UUID při transportním retry nesmí založit nový provider call. Explicitní uživatelský retry po terminálním selhání vždy vytvoří nové UUID a původní job zůstane v historii. UI nabízí bezpečné `Obnovit` nebo `Přerušit`: stale `running` s uloženým výstupem se uzavře jako hotový, stale `running` bez výstupu jako přerušený a čerstvý `running` se nesmí vydávat za zrušený. Provider chyby se zobrazují pouze přes pevné české kódy/zprávy, bez raw diagnostiky, transcriptu nebo outputu.

Stavové metadata se načítají jen na aktivní viditelné online ploše `AI zpracování` nebo `Časová osa`. Tempo je 5 sekund prvních 30 sekund, 10 sekund mezi 30 a 120 sekundami a poté 30 sekund; při hidden, offline nebo přepnutí na jiný tab je polling zastaven. Focus, návrat viditelnosti a online změna dělají jeden deduplikovaný catch-up, při chybě nejdříve po 30 sekundách. Běží nejvýše jeden request a po změně se aktualizuje lokální state, ne celý App Router přes `router.refresh`.

## Chat nad přepisem

`Chat` je pátý pracovní tab detailu nahrávky. Ukládá jedno vlákno pro aktuální přepis a po otevření načítá jen jeho historii. Výběr modelu ovlivní následující otázku; každý uložený tah ukazuje model, který odpověď skutečně vytvořil. Ověřená evidence z odpovědi vede přes současnou navigaci na přepis a dostupné audio. Browser do chat API neposílá audio, storage data ani vlastní transcript context.

## Časová osa

Tab `Časová osa` nemá být technický seznam segmentů po sekundách.

Cílově má jít o AI rozdělení hovoru na témata a kapitoly. Příklad:

- `00:00-04:20 Úvod a kontext`
- `04:20-12:10 Úkol 1`
- `12:10-18:45 Feedback k minulé práci`
- `18:45-29:30 Úkol 2`

Každá kapitola má obsahovat:

- název,
- krátké shrnutí,
- časový rozsah,
- relevantní mluvčí,
- navázané úkoly nebo rozhodnutí, pokud existují.

Technické segmenty a tokeny mohou zůstat interní data, ale výchozí UI má ukazovat obsahový význam hovoru.

Pokud kapitoly chybí, tab spustí `timeline_chapters` přímo s aktuálním výchozím AI modelem. Nepřepíná uživatele do `AI zpracování`, používá existující processing endpoint a během pending nebo error stavu ponechá uložené markery dostupné. Úspěch načte uložené kapitoly, chyba zachová retryable empty state.

## Nahrávky

Route: `/recordings`

Stránka nahrávek je kompaktní Notion Warm inbox. Priorita je rychle najít správnou nahrávku, poznat její stav a otevřít ji přes název.

Požadavky:

- nad obsahem je jeden kompaktní toolbar s pružným hledáním, tlačítkem pokročilých filtrů a `Spravovat`; při viewportu 900 px a méně se složí a `Spravovat` zabere celou šířku,
- toolbar, stavové facety a informace o výsledku nejsou samostatné vnořené tabulky nebo karty,
- běžný seznam je jednoúrovňový flat list s jedním vnějším rámečkem, jemnými skupinovými oddělovači a řádky dělenými pouze linkou,
- hlavní pracovní plocha a seznam používají `surface-raised`, takže jsou ve světlém režimu bílé bez změny globální Notion Warm palety,
- seznam nahrávek bez tlačítka `Otevřít`,
- název je hlavní Next odkaz na detail; editace a koš jsou jeho samostatní sourozenci,
- název je pružný sloupec a akce mají pevný 128 px pruh, ve kterém zůstávají celé viditelné `Upravit` i Koš a oba cíle mají nejméně 44 px,
- editace názvu přes samostatný ovládací prvek,
- editor názvu se po úspěšném uložení automaticky zavře; při chybě zůstane otevřený s rozepsanou hodnotou,
- kompaktní stavové URL chips ukazují přesné facety všech aktivních persisted stavů; samostatné `Smazáno` vede na `/trash`,
- velikost, datum a zdroj zobrazit kompaktně,
- existující filtry `q`, `status`, `client`, závislý `project`, `folder` a opakovatelný `tag` zůstávají URL-backed a synchronizované s Back/Forward,
- hledání zůstává viditelné; klient, projekt, složka a štítky jsou v keep-mounted disclosure pokročilých filtrů,
- zdroj nahrávky a datum vytvoření zůstávají pouze zobrazená metadata; nové source/date filtry nejsou součástí tohoto UI-only řezu,
- při skutečné šířce content containeru nad 680 px používá seznam pracovní řádky; při 680 px a méně skládané karty bez horizontálního posunu.

Klienti, projekty, ploché složky a štítky se spravují v keep-mounted pravém Draweru `Spravovat`. Drawer při zavření zůstává připojený, ale je skrytý pro focus i accessibility strom, takže rozepsaný nebo pending editor neztratí stav. Create, rename a assignment editory používají success-only collapse kontrakt; delete zůstává samostatná potvrzovaná destruktivní akce.

Nová nahrávka zobrazuje bucket, globální limit a preferenci jako jeden jemný informační řádek, ne tři technické karty. Koš podporuje výběr nejvýše 100 viditelných položek, partial bulk restore a permanentní mazání po jedné server mutation s klientskou souběžností 2. Neúspěšné nebo dosud nespouštěné položky zůstávají vybrané a viditelné.

## Mobil

Mobil je stejně důležitý jako desktop.

Mobilní priorita:

1. rychle spustit live nahrávání,
2. vidět, že se nahrává a přepisuje,
3. po dokončení otevřít detail,
4. číst přepis bez horizontálního posunu,
5. spustit AI zpracování bez hledání v hlubokých menu.

Sidebar na mobilu nesmí zabírat hlavní prostor. Navigace musí být dosažitelná, ale hlavní plocha se má soustředit na aktuální nahrávku.

## Implementační pořadí redesignu

Redesign postupovat po funkčních blocích:

1. design tokeny, menší typografie a skandinávská neutralita,
2. informační architektura a sidebar,
3. `/recordings/new` jako dvě čisté akční karty,
4. `/recordings` jako inbox nahrávek,
5. kompaktní header detailu nahrávky,
6. taby detailu nahrávky v pořadí `Přepis`, `AI zpracování`, `Časová osa`, `Soubory`,
7. přesun AI zpracování do detailu nahrávky,
8. obsahová AI časová osa,
9. polish pass přes spacing, typografii, hit areas, hover/focus stavy a mobile layout.
