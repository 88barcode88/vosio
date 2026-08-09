# Vosio Notion Warm redesign

Datum schválení: 9. 8. 2026

Stav: schváleno uživatelem

## Cíl

Předělat celé Vosio do jednotného pracovního rozhraní ve směru Notion Warm. Redesign zahrnuje shell, navigaci, Nahrávky, Novou nahrávku, detail, AI výstupy, Prompty, Nastavení, Koš, Dokumentaci a 404.

Nejdřív vznikne lokální ukázková obrazovka se všemi podstatnými prvky. Po jejím vizuálním schválení se design přenese do skutečných stránek. Známé funkční problémy se znovu ověří a opraví až nad dokončeným novým UI.

## Zvolený přístup

Redesign zůstane na současném Next.js, React a plain-CSS základu. Verze 0.1.31 nebude zavádět Tailwind, shadcn ani ReUI. ReUI může sloužit jako inspirace pro kompozici, ale přímé použití by vyžadovalo samostatnou technologickou migraci.

Datové dotazy, server actions, Supabase schéma a zpracování nahrávek se během vizuální fáze nemění, pokud to není nezbytné pro nové zobrazení. Tím se oddělí velká designová změna od funkčních oprav.

## Vizuální směr

Vosio má působit jako klidný pracovní zápisník pro každodenní používání, ne jako kopie Notionu, marketingová stránka ani generický barevný AI dashboard.

Principy:

- teplé neutrální plochy,
- jemné vrstvení pomocí 1px hranic,
- minimum stínů,
- kompaktní seznamy a vzdušnější formuláře,
- teal jako střídmý produktový akcent,
- serifové písmo pouze pro hlavní orientační nadpisy,
- malé funkční ikony bez dekorativních ilustrací,
- plnohodnotný světlý i tmavý režim.

## Typografie

- Hlavní nadpisy: `Newsreader`, fallback `Georgia`, `serif`.
- Pracovní UI a obsah: `Inter`, fallback `Aptos`, `Segoe UI`, `system-ui`, `sans-serif`.
- Časy, velikosti a číselné hodnoty používají `font-variant-numeric: tabular-nums`.

Rozsahy:

- název stránky: 24-28 px,
- hlavní sekce: 18-20 px,
- nadpis panelu: 14-16 px,
- pracovní text: 13-15 px,
- label a doplňková metadata: 12-13 px.

Serifové písmo se nepoužije v tlačítkách, tabulkách, formulářích, navigaci, stavech ani dlouhém přepisu.

## Barevný systém

Barvy se používají výhradně přes sémantické CSS tokeny.

### Světlý režim

- pozadí aplikace: teplá slonová kost `#f7f5f2`,
- hlavní plocha: `#fffefa`,
- ztlumená plocha: `#f0ede8`,
- zvýšená plocha: `#ffffff`,
- hranice: `#ded9d1`,
- silná hranice: `#c8c1b7`,
- hlavní text: `#252421`,
- sekundární text: `#625f59`,
- ztlumený text: `#817c74`,
- teal akcent: `#0f766e`,
- hover akcent: `#0b5f59`.

### Tmavý režim

- pozadí aplikace: `#191918`,
- hlavní plocha: `#222220`,
- ztlumená plocha: `#2a2927`,
- zvýšená plocha: `#302f2c`,
- hranice: `#3d3a36`,
- silná hranice: `#56514a`,
- hlavní text: `#f3f0ea`,
- sekundární text: `#c1bbb1`,
- ztlumený text: `#989188`,
- teal akcent: `#5cc8bc`,
- hover akcent: `#79d6cc`.

Stavy success, warning, danger, info a recording musí být rozlišitelné textem nebo ikonou, ne jen barvou. Kontrast běžného textu musí splnit WCAG AA.

## Spacing, plochy a hustota

- Základní jednotka: 4 px.
- Běžné mezery: 8, 12, 16, 20, 24 a 32 px.
- Ovládací prvky: minimálně 40 px na desktopu a 44 px klikací plocha pro dotykové nebo ikonové akce.
- Radius ovládacích prvků: 8-10 px.
- Radius panelů: 10-12 px.
- Stíny se používají jen pro modal, drawer nebo plovoucí popover.
- Řádek nahrávky zůstane kompaktní; formuláře a Nastavení dostanou větší vertikální rozestupy.

## Shell a navigace

### Desktop

- Levý sidebar má přibližně 232 px.
- Logo je nahoře, pod ním hlavní navigace.
- Účet, Dokumentace a přepínač motivu jsou dole.
- Hlavní obsah má jeden vertikální scrollbar.
- Běžné stránky nesmí vytvářet další celostránkový scroll root.

### Mobil

- Sidebar zmizí.
- Dole zůstane maximálně pět hlavních cílů.
- Sekundární cíle jsou v menu.
- Rozložení nesmí vytvářet horizontální scroll.
- Primární akce a destruktivní ikony musí být dosažitelné jednou rukou.

## Obrazovky

### Nahrávky

- Kompaktní hlavička s názvem, krátkým popisem a primární akcí `Nová nahrávka`.
- `Spravovat` rozbalí klienty, projekty, složky a štítky; výchozí stav je zavřený.
- Filtry jsou v jednom klidném panelu.
- Souhrnné počty jsou stavový řádek, ne čtyři dominantní karty.
- Desktop používá pracovní řádky, mobil skládané karty.
- Skupiny klientů a existující query/filter chování zůstanou zachované.

### Nová nahrávka

- Dvě rovnocenné pracovní plochy: `Nahrávat live` a `Nahrát soubor`.
- Stránka nemá hero blok.
- Po spuštění se aktivní metoda zvýrazní a druhá vizuálně ustoupí.
- Upload zobrazuje přípravu, nahrávání, dokončování, úspěch a chybu bez změny výšky celé stránky.

### Detail nahrávky

- Kompaktní hlavička obsahuje název, stav, datum, délku, velikost a akce.
- Vlastní Vosio přehrávač leží přímo pod hlavičkou.
- Hlavní pracovní plocha používá jeden sloupec bez dominantního pravého AI panelu.
- Záložky jsou `Přepis`, `AI zpracování`, `Časová osa` a `Soubory`.
- Dlouhý přepis je hlavní obsah a přehrávač zůstává snadno dostupný.

### AI výstupy

- Detail ukazuje AI akce a výstupy konkrétní nahrávky.
- `/ai` zůstane archivem napříč nahrávkami.
- Archiv lze filtrovat podle typu a nahrávky.
- Mail, shrnutí, zápis a další netaskový artefakt se mažou jako celá generace.
- Jednotlivý úkol má vlastní ikonovou akci koše.
- UI nenabízí `Smazat checklist` ani mazání jednotlivých částí mailu nebo shrnutí.

### Prompty

- Desktop používá seznam šablon a vedle něj editor.
- Mobil otevře editor jako samostatnou plochu.
- Pokročilé parametry jsou výchozí zavřené.

### Nastavení

- Nastavení je jeden normálně rolovatelný dokument.
- Sekce: AI, jazyk a přepis, nahrávání, úložiště, vzhled a diagnostika.
- Desktop může mít sticky navigaci sekcí.
- Technické vysvětlivky jsou pod `Více informací`.

### Koš, Dokumentace a 404

- Koš je jednoduchý seznam s obnovením a trvalým smazáním.
- Dokumentace má čitelnou šířku textu a obsah sekcí.
- Česká 404 nabízí návrat na Nahrávky a vytvoření nové nahrávky.

## Komponenty a interakce

Sdílené komponenty vzniknou jen tam, kde se skutečně opakují chování nebo přístupnost:

- panel,
- status badge,
- modal,
- drawer,
- disclosure,
- empty state.

Button systém má varianty primary, secondary, quiet a destructive. Ikony zůstanou z Lucide v jednom outline stylu.

Pravidla:

- kliknutí mimo zavře picker, editor, popover nebo drawer bez neuložených změn,
- Escape zavře stejný prvek a vrátí focus na spouštěcí tlačítko,
- barevný picker se po kliknutí mimo vždy zavře,
- neuložené změny vyžadují potvrzení odchodu,
- pokročilá nastavení používají disclosure přímo ve stránce,
- krátká destruktivní potvrzení používají modal,
- rozsáhlá editace používá drawer na desktopu a téměř celou obrazovku na mobilu.

## Načítání, chyby a prázdné stavy

- Async stav se ukazuje u prvku, který akci spustil.
- Upload má stabilní progress řádek a text fáze.
- Dlouhá AI akce má lokální stav zpracování.
- Chyba je u konkrétní akce; globální upozornění je jen pro problém celé stránky.
- Toast je pouze doplňkové potvrzení úspěchu, ne jediný nosič důležité chyby.
- Prázdný stav vysvětlí důvod a nabídne jednu smysluplnou další akci.
- Po neúspěšném smazání se položka vrátí na původní místo.

## Pohyb a přístupnost

- Přechody trvají 120-180 ms.
- Neanimují se vlastnosti způsobující přeskládání celé stránky.
- `prefers-reduced-motion` vypne nepodstatný pohyb.
- Keyboard focus je viditelný ve světlém i tmavém režimu.
- Ikonové akce mají přístupný název.
- Formulářová pole mají trvalý label.
- Modal a drawer správně spravují focus.

## Implementační fáze

### A. Designový základ

Aktualizovat `DESIGN.md`, sémantické tokeny a sdílené komponentní kontrakty.

### B. Lokální ukázková obrazovka

Vytvořit vývojovou ukázku Nahrávek s fixture daty. Musí ukázat sidebar, hlavičku, filtry, skupiny, řádky, formulář, modal, barevný picker, prázdný stav, světlý/tmavý režim a desktop/mobil. Nepoužije produkční databázi a nebude nasazena jako veřejná produktová stránka.

Po vizuálním schválení uživatelem pokračovat na skutečné stránky.

### C. Redesign celé aplikace

Pořadí:

1. shell a navigace,
2. Nahrávky,
3. Nová nahrávka,
4. Detail a přehrávač,
5. AI výstupy a Prompty,
6. Nastavení,
7. Koš, Dokumentace a 404,
8. mobilní a tmavý režim.

### D. Funkční diagnostika nad novým UI

Po dokončení redesignu znovu ověřit:

- dvojité rolování a dostupnost celého Nastavení,
- opakované posouvání přehrávače,
- 33MB M4A upload,
- hydration mismatch #418,
- mazání AI generací a jednotlivých úkolů,
- zavírání pickerů a editorů kliknutím mimo,
- filtry a přiřazené štítky.

Každý reprodukovaný problém dostane samostatný regresní test a úzce zaměřenou opravu.

## Ověření

- Vitest pro komponentní kontrakty, helpery a přístupné názvy.
- Playwright pro hlavní routy a šířky 375, 768, 1024 a 1440 px.
- Kontrola jednoho hlavního scrollbaru a nulového horizontálního scrollu.
- Světlý i tmavý režim.
- Keyboard navigace, Escape, obnovení focusu a 44px klikací plochy.
- `npm.cmd run check`.
- `npm.cmd run build`.

## Kritéria dokončení redesignu

- Všechny produktové routy používají stejný vizuální jazyk.
- Žádná stránka nezůstane ve starém designu.
- Ukázková obrazovka byla uživatelem schválena před plošným přenosem.
- Běžné stránky mají jeden hlavní scrollbar.
- Aplikace nemá horizontální scroll na 375 px.
- Světlý i tmavý režim mají čitelný kontrast.
- Stávající datový a autorizační kontrakt zůstane během vizuální fáze zachován.
- Známé funkční problémy jsou po redesignu znovu otestované a jejich stav je odděleně reportovaný.
