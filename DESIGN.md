# Design System — Vosio

## Product Context

Vosio je pracovní audio workspace pro nahrávání, přepis a AI vytěžení hovorů. Uživatel má rychle zapnout live nahrávání, vložit existující nahrávku, otevřít přepis a vytvořit z něj konkrétní výstupy.

UI je aplikace pro opakované denní používání, ne marketingová stránka. Hlavní objekt je nahrávka.

Tento schválený dokument určuje neutrální Appica-inspired směr a má přednost před staršími konfliktními tvrzeními v požadavcích.

## Aesthetic Direction

Direction: neutral Appica-inspired workspace.

Vosio má působit jako klidný, soustředěný pracovní nástroj s neutrálním světle šedým plátnem, bílými panely a grafitovým dark mode. Pracovní hustota zůstává vysoká, ale formuláře dostávají více vzduchu pro bezpečné vyplnění. Rozhraní je čitelné, rychlé a nenápadné: bez hero bloků, přehnaných gradientů, dekorativních benefit sekcí, obřích ikon a velkého display písma uvnitř aplikace.

Designová reference:

- pracovní pořádek a hierarchie moderního CRM,
- kompaktní seznamy a konkrétní pracovní kroky jako Appica-inspired workspace,
- neutrální světlé plátno, bílé panely, jemné rámečky a důraz na obsah.

Memorable detail:

- nahrávka jako pracovní objekt,
- live titulky a mluvčí jako hlavní audio signal,
- AI výstupy jako uložené pracovní artefakty v detailu nahrávky.

## Theme Strategy

Vosio podporuje plnohodnotný dark i light mode.

- Dark mode je primární výchozí pracovní vzhled.
- Light mode je plnohodnotný režim se stejnou informační hustotou.
- Theme se řídí přes CSS custom properties na root elementu.
- Komponenty nesmí mít hardcoded barvy mimo tokeny, kromě výjimečných datových/speaker barev.

## Color Tokens

### Semantic Token Names

Používej významové tokeny, ne barvy podle názvu odstínu.

- `--bg`
- `--surface`
- `--surface-muted`
- `--surface-raised`
- `--border`
- `--border-strong`
- `--text`
- `--text-secondary`
- `--text-muted`
- `--accent`
- `--accent-hover`
- `--accent-text`
- `--focus-ring`
- `--success`
- `--recording`
- `--danger`
- `--warning`
- `--info`

### Dark Mode Palette

Dark mode je grafitový pracovní režim. Primární akce používají vysokokontrastní neutrální barvu; red, green, amber a blue jsou vyhrazené pro sémantické stavy.

- `--bg`: `#171717`
- `--surface`: `#202020`
- `--surface-muted`: `#282828`
- `--surface-raised`: `#242424`
- `--border`: `#3a3a3a`
- `--border-strong`: `#575757`
- `--text`: `#f5f5f3`
- `--text-secondary`: `#c5c5c1`
- `--text-muted`: `#969692`
- `--accent`: `#f5f5f3`
- `--accent-hover`: `#ffffff`
- `--accent-text`: `#171717`
- `--focus-ring`: `#74a7ff`
- `--success`: `#54b67a`
- `--recording`: `#ef6b6b`
- `--danger`: `#ef6b6b`
- `--warning`: `#e2a84d`
- `--info`: `#74a7ff`

### Light Mode Palette

Light mode je neutrální světle šedé plátno s bílými pracovními panely, ne marketingová stránka.

- `--bg`: `#f4f4f2`
- `--surface`: `#ffffff`
- `--surface-muted`: `#ececea`
- `--surface-raised`: `#ffffff`
- `--border`: `#d8d8d4`
- `--border-strong`: `#aaa9a4`
- `--text`: `#171717`
- `--text-secondary`: `#575754`
- `--text-muted`: `#70706c`
- `--accent`: `#171717`
- `--accent-hover`: `#333330`
- `--accent-text`: `#ffffff`
- `--focus-ring`: `#245bd7`
- `--success`: `#1e7a46`
- `--recording`: `#b53535`
- `--danger`: `#b53535`
- `--warning`: `#9a5d0a`
- `--info`: `#245bd7`

### Temporary Compatibility Aliases

`--text-muted` zůstává schválený token pro skutečně doplňkový text. Dokud nejsou migrované existující 12px textové prvky, legacy alias `--muted` mapuj na `--text-secondary`, aby jejich kontrast zůstal čitelný. Tento alias je dočasný a při migraci jednotlivých komponent se má nahradit vhodným sémantickým tokenem.

## Speaker Colors

Speaker colors musí být stabilní napříč jedním transcript view a nesmí nahrazovat stavové barvy.

Recommended speaker set:

- violet,
- orange,
- blue,
- green,
- red.

Dark mode speaker chips mají být jemné tinted surfaces. Light mode speaker chips musí mít dostatečný kontrast a nepůsobit jako error/warning, pokud nejde o stav.

## Typography

Primary UI font:

- `Inter` přes `next/font/google` a proměnnou `--font-ui`,
- fallback: `Segoe UI`, `system-ui`, `sans-serif`.

Heading font:

- `Inter` přes stejnou proměnnou `--font-ui`,
- pro nadpisy `h1` až `h3` i běžné UI, formuláře a metadata,
- fallback: `Segoe UI`, `system-ui`, `sans-serif`.

Data/monospace font:

- fallback: `JetBrains Mono`, `Consolas`, `monospace`.

Typography rules:

- aplikace nepoužívá hero-scale typografii,
- běžný text: 12.5-13.5 px,
- UI label: 11.5-12.5 px,
- page title: 20-24 px,
- section title / H2: 16-18 px,
- card title / H3: 14-15 px,
- transcript body: 13.5-14.5 px podle hustoty,
- čas, velikost souboru a timer používají `font-variant-numeric: tabular-nums`.

Icon rules:

- běžné ikony v navigaci a tlačítkách: 15-16 px,
- primární akční ikony: maximálně 18 px,
- velké dekorativní ikony se nepoužívají,
- logo může být výraznější, ale nesmí určovat velikost ostatního UI.

## Borders and Shadows

- Rozhraní používá 1px border z tokenu `--border`; silnější hranice jen pro focus, vybraný stav nebo funkční oddělení.
- Stíny jsou minimální a slouží jen k oddělení překryvů nebo raised surface. Běžné panely a seznamy se opírají o plochu a border, ne o velký shadow.

## Spacing

Base unit: 4 px.

Scale:

- `2xs`: 2 px
- `xs`: 4 px
- `sm`: 8 px
- `md`: 12 px
- `lg`: 16 px
- `xl`: 20 px
- `2xl`: 24 px
- `3xl`: 32 px

Density:

- pracovní obrazovky a seznamy používají compact density,
- formuláře používají vzdušnější rozestupy mezi poli, jejich popisky a nápovědou,
- prázdné stavy mohou být volnější,
- karty v detailu nahrávky nesmí růst jen kvůli dekoraci,
- stránky nesmí začínat velkým hero blokem, pokud nejde o veřejnou landing page.

## Radius

Radius scale:

- small controls: 8-10 px,
- buttons: 10-12 px,
- cards/panels: 12-14 px,
- modals/popovers: 14-16 px,
- pills: 999 px.

Nested radius musí být opticky konzistentní: vnitřní radius má být menší než vnější.

Pracovní plochy inboxu, filtrů, řádků, Draweru, capture a Koše používají kompaktní radius 4-6 px. Interaktivní hit area zůstává nejméně 44 px i tam, kde je viditelná geometrie menší.

## Layout

Desktop shell:

- sidebar: 248 px rozbalený a 64 px sbalený,
- content: full viewport width,
- max app width se nepoužívá pro hlavní workspace,
- detail nahrávky používá jeden hlavní pracovní sloupec bez dominantního pravého AI panelu.

Mobile shell:

- sidebar se skrývá,
- spodní navigace zůstává dostupná,
- primární akce live nahrávání musí být rychle dosažitelná,
- žádný horizontální scroll.

Breakpoint do 900 px zachovává přesně pět cílů spodní mobilní navigace.

## Components

### Sidebar

Sidebar je hlavní navigace, ne dashboard.

Obsah:

- logo Vosio,
- icon-only theme toggle vedle loga,
- `Nová nahrávka`,
- `Nahrávky`,
- `AI prompty`,
- `Koš`,
- `Nastavení`,
- sekundární `Dokumentace` nad user/account area na desktopu,
- user/account area.

Na mobilu může `Dokumentace` zůstat ve spodní navigaci, protože user/account area se tam nezobrazuje.

Nepatří sem:

- duplicitní seznam nahrávek,
- storage progress karta,
- AI zpracování jako primární položka bez samostatného workflow.

### Recordings Inbox

`/recordings` je jeden kompaktní pracovní inbox, ne sestava panelů nebo tabulek vložených do sebe.

- Nad obsahem je jeden kompaktní toolbar: pružné hledání s vlastní ikonou, ovládání pokročilých filtrů a `Spravovat`.
- Stavové facety a informace o výsledku zůstávají ploché; seznam má jeden vnější rámeček, jemné skupinové oddělovače a neobaluje jednotlivé desktopové řádky dalšími kartami.
- Název je pružný sloupec. Akce mají pevný 128 px pruh, aby zůstaly současně celé viditelné text `Upravit` a 44px tlačítko koše.
- Inbox používá `--surface-raised`; ve světlém režimu je proto pracovní plocha bílá při zachování neutrální palety a dark mode tokenů.
- Existující filtry `q`, `status`, `client`, `project`, `folder` a opakovatelný `tag` zůstávají URL-backed. Pokročilá organizační část zůstává keep-mounted, aby neztrácela draft ani stav při zavření.
- Zdroj a datum nejsou nové filtry tohoto UI-only řezu.
- Při viewportu 900 px a méně se toolbar složí a `Spravovat` zabere celou šířku. Samotný seznam přechází na karty podle skutečné šířky content containeru 680 px a méně, ne pouze podle viewportu.

### Recording Detail

Detail nahrávky je pracovní objekt, ne hero.

- Header drž kompaktní: název, stav, metadata a destruktivní akce.
- Záložky musí fungovat jako rychlé pracovní režimy, ne jako nové stránky.
- AI zpracování má být vertikální workflow: nastavení a quick actions nahoře, uložené výstupy pod tím.
- AI output cards jsou rozbalovací artefakty s preview v zavřeném stavu, aby seznam zůstal skenovatelný.
- Časová osa je obsahová AI timeline podle témat, ne technický dump segmentů po sekundách.
- Na mobilu preferuj horizontálně scrollovatelné taby, menší metadatové chipy a jeden sloupec.

### New Recording Cards

`/recordings/new` má dvě hlavní karty:

- live recording,
- file upload.

Karty mají být akční, ne prezentační. Nadpis stránky má být malý. Live a upload mají být vedle sebe na desktopu, aby uživatel okamžitě viděl dvě hlavní cesty: zapnout live nahrávání nebo vložit soubor.

### Recording Detail Header

Detail nahrávky používá kompaktní header.

Header obsahuje:

- editovatelný název,
- stav,
- datum,
- délku,
- velikost,
- zdroj,
- akce.

Nepoužívat velkou waveform kartu jako hlavní header. Detail má začínat jako pracovní záznam v CRM: kompaktní titul, metadata, stav a akce. Vizuální audio signál může být malý doplněk, ne hlavní objekt stránky.

### Transcript Panel

Přepis musí být čitelný u krátkého i hodinového hovoru.

Rules:

- dlouhý detail používá jediný dokumentový scroll celé stránky; player a taby mohou být sticky, ale panel nesmí vytvářet druhý vertikální scroll,
- speaker blocks jsou rozbalovací,
- prvních několik bloků může být otevřených,
- fallback raw text nepředstírá mluvčí,
- speaker preview nesmí rozbíjet layout.

### AI Processing Tab

AI zpracování je tab v detailu nahrávky.

Obsah:

- quick actions,
- model/temperature jako pokročilé nastavení,
- uložené výstupy,
- detail vybraného výstupu.

### Timeline Tab

Časová osa je obsahová AI struktura hovoru.

Nepoužívat výchozí zobrazení technických segmentů po sekundách jako finální UX. Segmenty mohou sloužit jako fallback nebo debug, ale ne jako hlavní produktový výstup.

## Interaction States

Každý interaktivní prvek musí mít:

- default,
- hover,
- focus-visible,
- active/pressed,
- disabled,
- loading, pokud spouští async akci.

Focus state musí být viditelný v dark i light mode.

## Motion

Motion má být minimální a funkční.

Používat:

- krátké hover/focus transitions,
- jemné active press u tlačítek,
- žádné plošné `transition: all`,
- žádné dlouhé dekorativní animace v pracovní ploše.

Recommended transition:

- duration: 120-180 ms,
- properties: `background-color`, `border-color`, `color`, `transform`, `box-shadow`,
- easing: `ease-out`.

## Accessibility

Requirements:

- tlačítka a ovládací prvky mají minimálně 44 px hit area,
- icon-only akce mají `aria-label`,
- taby používají `role="tablist"` / `role="tab"` / `role="tabpanel"`,
- formuláře mají label nebo přístupný název,
- chybové stavy mají text, ne jen barvu,
- live transcript používá `aria-live="polite"`.

## Implementation Notes

Před UI implementací číst:

- `docs/requirements/ui-direction.md`,
- `docs/requirements/ui-redesign-plan.md`,
- tento `DESIGN.md`.

Po změně chování nebo UI rozhodnutí aktualizovat odpovídající dokumentaci.
