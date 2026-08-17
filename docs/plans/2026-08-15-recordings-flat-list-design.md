# Plochý seznam Nahrávek

## Cíl

Stránka `/recordings` má působit jako jeden kompaktní pracovní seznam, ne jako několik tabulek a panelů vložených do sebe. Návrh vychází z hustého řádkového pohledu v `projects_tool`, ale zachovává současné Next.js komponenty, URL kontrakty, RLS a responzivní chování Vosia.

## Zvažované směry

1. **Plochý řádkový seznam**: jeden toolbar, jedna hlavička, jemné skupinové oddělovače a řádky pouze s horizontálními linkami. Toto je schválený směr.
2. **Jemná datová mřížka**: jeden vnější rámeček a viditelné vertikální oddělovače sloupců. Je přijatelná jen jako technické maximum tam, kde pomůže zarovnání.
3. **Karty a vnořené panely**: samostatné rámečky pro filtry, stav, skupiny a položky. Tento směr je zamítnutý, protože vytváří současný nežádoucí dojem několika tabulek uvnitř sebe.

## Schválené rozložení

- Nad seznamem bude jeden kompaktní toolbar.
- Hledání bude hlavní pružný prvek toolbaru a bude mít ikonu nebo skrytý přístupný popisek, ne text překrývající input.
- `Filtry` a `Spravovat` budou běžná kompaktní tlačítka vedle hledání. `Spravovat` už nebude samostatný široký pruh.
- Pokročilé filtry zůstanou keep-mounted a URL-backed. V tomto UI kole se nepřidává nový databázový filtr.
- Aktivní stavové facety zůstanou pod toolbarem jako plochá linka bez samostatné karty.
- Výsledek hledání nebo filtrování se zobrazí jako nenápadný inline text, ne jako další ohraničený panel.
- Seznam bude mít nejvýše jeden vnější rámeček. Klient je jemný skupinový řádek uvnitř stejného seznamu.
- Jednotlivé nahrávky nemají vlastní radius ani samostatný obvodový rámeček. Odděluje je jedna horizontální linka a hover plocha.

## Sloupce a akce

Desktop zachová sloupce `Název`, `Stav`, `Velikost` a `Akce`.

- Název je jediný pružný sloupec a smí se zmenšit s ellipsis nebo zalomením doplňkového textu.
- Stav a velikost jsou kompaktní pevné sloupce.
- Akce mají vyhrazených nejméně 116 px, aby se současně vešlo `Upravit` a koš včetně 44px hit areas, mezery a paddingu.
- Hlavička a datový řádek musí používat stejnou definici sloupců.
- Tabulka nesmí oříznout koš ani vytvořit horizontální scroll při podporovaných desktopových šířkách.

## Filtry

Aktuální funkční sada zůstává:

- fulltext `q` přes název, nejnovější přepis a organizační metadata,
- stavové facety,
- klient,
- závislý projekt,
- plochá složka,
- opakovatelné štítky s ALL sémantikou.

Tlačítko filtrů jasně ukáže počet aktivních pokročilých filtrů. Aktivní stav je vidět přímo ve stavové lince a hledání přímo v inputu, proto se jejich počet nebude dvojitě vydávat za pokročilý filtr. Zdroj nahrávky a datum vytvoření jsou možné budoucí filtry, ale vyžadují samostatné produktové a databázové rozhodnutí a nejsou součástí tohoto UI řezu.

## Barvy

Globální light-mode paleta se nemění. Pouze stránka Nahrávky přestane vrstvit krémový `surface-muted` do několika panelů:

- hlavní pracovní plocha, toolbar a seznam použijí existující bílý `surface-raised`,
- skupiny a hover použijí velmi jemné existující surface tokeny,
- oddělení bude stát na jedné 1px hraně, ne na hnědých vyplněných kartách,
- dark mode zachová současné sémantické tokeny a kontrast.

## Mobil a úzký desktop

Container breakpoint zůstane založený na skutečné šířce inboxu. Pod podporovanou šířkou se hlavička skryje a řádek se složí do čitelného mobilního uspořádání. Mobil může použít jeden jemný obvod položky, ale nesmí znovu vytvořit několik vnořených karet ani horizontální scroll.

## Převzetí z projects_tool

Přebírá se informační hierarchie, ne zdrojový kód ani Tailwind/Radix závislosti:

- jeden řádkový toolbar,
- jedna společná hlavička,
- ploché řádky s `border-bottom`,
- jemný hover,
- kompaktní skupinové oddělovače.

## Ověření

- unit kontrakt pro toolbar, existující URL filtry a jednotnou strukturu seznamu,
- CSS kontrakt pro stejnou definici sloupců a minimální action track,
- Playwright geometrie na desktopu s rozbaleným i sbaleným sidebarem,
- koš i editace musí být plně uvnitř seznamu a mít nejméně 44px hit area,
- search label a input se nesmí překrývat,
- stránka nesmí mít horizontální overflow,
- mobilní karty a keep-mounted filtry musí zůstat ovladatelné klávesnicí i dotykem.
