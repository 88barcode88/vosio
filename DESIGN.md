# Design System — Vosio

## Product Context

Vosio je pracovní audio workspace pro nahrávání, přepis a AI vytěžení hovorů. Uživatel má rychle zapnout live nahrávání, vložit existující nahrávku, otevřít přepis a vytvořit z něj konkrétní výstupy.

UI je aplikace pro opakované denní používání, ne marketingová stránka. Hlavní objekt je nahrávka.

Tento schválený dokument Notion Warm má přednost před konfliktními tvrzeními o paletě a typografii ve starším `docs/requirements/ui-redesign-plan.md`, dokud nebude tento dokument migrován během kompletního redesignu.

## Aesthetic Direction

Direction: Notion Warm.

Vosio má působit jako klidný, soustředěný pracovní nástroj s teplými neutrálními plochami. Pracovní hustota zůstává vysoká, ale formuláře dostávají více vzduchu pro bezpečné vyplnění. Rozhraní je čitelné, rychlé a nenápadné: bez hero bloků, přehnaných gradientů, dekorativních benefit sekcí, obřích ikon a velkého display písma uvnitř aplikace.

Designová reference:

- pracovní pořádek a hierarchie jako Notion,
- kompaktní seznamy a konkrétní pracovní kroky jako moderní CRM,
- teplý papírový materiálový pocit: krémové světlé plochy, uhlově teplý dark mode, jemné vrstvy a důraz na obsah.

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

Dark mode je teplý uhlový pracovní režim, ne modrozelené rozhraní. Teal je akcent pro aktivní akce, stav live přepisu a brand, ne dominantní barva celé obrazovky.

- `--bg`: `#191918`
- `--surface`: `#222220`
- `--surface-muted`: `#2a2927`
- `--surface-raised`: `#302f2c`
- `--border`: `#3d3a36`
- `--border-strong`: `#56514a`
- `--text`: `#f3f0ea`
- `--text-secondary`: `#c1bbb1`
- `--text-muted`: `#989188`
- `--accent`: `#5cc8bc`
- `--accent-hover`: `#79d6cc`
- `--accent-text`: `#10211f`
- `--focus-ring`: `var(--accent)`
- `--success`: `#7fc7a4`
- `--recording`: `#ff8f8f`
- `--danger`: `#ff8f8f`
- `--warning`: `#e8b36a`
- `--info`: `#86b7e8`

### Light Mode Palette

Light mode je krémový a pracovní, ne čistě bílá marketingová stránka. Teal akcent používat stejně střídmě jako v dark mode.

- `--bg`: `#f7f5f2`
- `--surface`: `#fffefa`
- `--surface-muted`: `#f0ede8`
- `--surface-raised`: `#ffffff`
- `--border`: `#ded9d1`
- `--border-strong`: `#c8c1b7`
- `--text`: `#252421`
- `--text-secondary`: `#625f59`
- `--text-muted`: `#817c74`
- `--accent`: `#0f766e`
- `--accent-hover`: `#0b5f59`
- `--accent-text`: `#ffffff`
- `--focus-ring`: `var(--accent)`
- `--success`: `#2f7d56`
- `--recording`: `#b83f3f`
- `--danger`: `#b83f3f`
- `--warning`: `#8a5a16`
- `--info`: `#2f67a5`

### Temporary Compatibility Aliases

`--text-muted` zůstává schválený token pro skutečně doplňkový text. Dokud nejsou migrované existující 12px textové prvky, legacy alias `--muted` mapuj na `--text-secondary`, aby jejich kontrast zůstal čitelný. Tento alias je dočasný a při migraci jednotlivých komponent se má nahradit vhodným sémantickým tokenem.

## Speaker Colors

Speaker colors musí být stabilní napříč jedním transcript view. Nepoužívat jen teal.

Recommended speaker set:

- teal,
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

- `Newsreader` přes `next/font/google` a proměnnou `--font-heading`,
- pouze pro nadpisy `h1` až `h3`, nikdy pro běžné UI, formuláře nebo metadata,
- fallback: `Georgia`, `serif`.

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

## Layout

Desktop shell:

- sidebar: 240-260 px,
- content: full viewport width,
- max app width se nepoužívá pro hlavní workspace,
- detail nahrávky používá jeden hlavní pracovní sloupec bez dominantního pravého AI panelu.

Mobile shell:

- sidebar se skrývá,
- spodní navigace zůstává dostupná,
- primární akce live nahrávání musí být rychle dosažitelná,
- žádný horizontální scroll.

## Components

### Sidebar

Sidebar je hlavní navigace, ne dashboard.

Obsah:

- logo Vosio,
- icon-only theme toggle vedle loga,
- `Nová nahrávka`,
- `Nahrávky`,
- `Prompty`,
- `Koš`,
- `Nastavení`,
- sekundární `Dokumentace` nad user/account area na desktopu,
- user/account area.

Na mobilu může `Dokumentace` zůstat ve spodní navigaci, protože user/account area se tam nezobrazuje.

Nepatří sem:

- duplicitní seznam nahrávek,
- storage progress karta,
- AI zpracování jako primární položka bez samostatného workflow.

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

- dlouhý obsah scrolluje uvnitř panelu,
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

- tlačítka a ovládací prvky mají minimálně 40 px hit area,
- icon-only akce mají `aria-label`,
- taby používají `role="tablist"` / `role="tab"` / `role="tabpanel"`,
- formuláře mají label nebo přístupný název,
- chybové stavy mají text, ne jen barvu,
- live transcript používá `aria-live="polite"`.

## Implementation Notes

Před UI implementací číst:

- `docs/requirements/ui-direction.md`,
- tento `DESIGN.md`.

Po změně chování nebo UI rozhodnutí aktualizovat odpovídající dokumentaci.
