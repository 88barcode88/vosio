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
- `Prompty`
- `Koš`
- `Nastavení`
- sekundární `Dokumentace` nad účtem uživatele na desktopu
- malá ikona přepnutí světlý/tmavý režim vedle názvu Vosio

Sidebar nemá obsahovat duplicitní seznam nahrávek ani storage kartu. Nahrávky patří na stránku `/recordings`. Na mobilu může `Dokumentace` zůstat ve spodní navigaci, protože mobilní layout nemá spodní účetový blok.

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
- režim ukládání `Audio do {aktuální limit bucketu} + přepis` / `Jen live přepis`,
- live titulky,
- mluvčí, pokud je Soniox realtime vrací,
- srozumitelnou chybu, pokud realtime přepis selže, ale lokální nahrávání pokračuje.

Upload karta musí ukazovat:

- jasnou akci pro výběr souboru,
- dropzone pro desktop,
- podporované typy audio/MP4,
- aktuální limit načtený z bucketu `recordings`,
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

## Přepis

Tab `Přepis` má být čitelný i u dlouhých hovorů.

Požadavky:

- dlouhý přepis se roluje uvnitř panelu,
- mluvčí mají stabilní barevné odlišení,
- pokud jsou dostupné Soniox speaker tokeny, zobrazit bloky podle mluvčích,
- pokud speaker data nejsou dostupná, zobrazit souvislý text bez falešného rozdělení,
- bloky přepisu mají být rozbalovací nebo kompaktně členěné, aby hodinový hovor nezničil stránku.

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
  - `Zápis ze schůzky`,
  - `CRM poznámka`,
  - `E-mail po hovoru`,
- nastavení aktuálního modelu a jeho pevné reasoning/thinking úrovně,
- viditelné stručné upozornění, že silnější modely obvykle zachytí více souvislostí, ale žádný model nezaručuje úplnost; menší model může vynechat detaily, úkoly nebo důkazy,
- seznam již vytvořených AI výstupů jako kompaktní rozbalovací řádky,
- detail vybraného výstupu otevřený až po kliknutí.

AI výstupy mají být uložené a znovu otevřitelné. Nemají být jen dočasná odpověď v panelu.

Pro složité nebo důležité cally má UI doporučit Sol nebo Terra a připomenout kontrolu úkolů a evidence proti přepisu. Toto doporučení je praktická pomůcka, ne příslib deterministicky lepšího výsledku; ceny v pickeru jsou orientační odhady podle lokálního katalogu a skutečná fakturace patří providerovi.

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

## Nahrávky

Route: `/recordings`

Stránka nahrávek má působit jako kompaktní inbox nahrávek. Priorita je rychle najít správnou nahrávku, poznat její stav a kliknutím ji otevřít.

Požadavky:

- seznam nahrávek bez tlačítka `Otevřít`,
- kliknutí na řádek otevře detail,
- editace názvu přes samostatný ovládací prvek,
- editor názvu se po úspěšném uložení automaticky zavře; při chybě zůstane otevřený s rozepsanou hodnotou,
- stav nahrávky jasně viditelný,
- velikost, datum a zdroj zobrazit kompaktně,
- připravit prostor pro budoucí filtry.

Klienti, projekty, ploché složky a štítky jsou budoucí organizační funkce, nikoli aktuálně hotová část seznamu. Jejich create, rename a assignment editory mají po implementaci použít stejný success-only collapse kontrakt jako název nahrávky; delete zůstává samostatná potvrzovaná destruktivní akce.

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
