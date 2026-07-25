# Design System — Vosio

## Product Context

Vosio je pracovní audio workspace pro nahrávání, přepis a AI vytěžení hovorů. Uživatel má rychle zapnout live nahrávání, vložit existující nahrávku, otevřít přepis a vytvořit z něj konkrétní výstupy.

UI je aplikace pro opakované denní používání, ne marketingová stránka. Hlavní objekt je nahrávka.

## Aesthetic Direction

Direction: Scandinavian audio workspace.

Vosio má působit jako moderní pracovní nástroj ve stylu Linear / Notion / CRM, ale vizuálně střídměji: skandinávsky čisté, klidné, přesné a méně "AI aplikace". Rozhraní má být kompaktní, čitelné a rychlé. Design nemá používat hero bloky, přehnané gradienty, dekorativní benefit sekce, velké prázdné karty, obří ikony ani velké display písmo uvnitř aplikace.

Designová reference:

- pracovní hustota jako Linear nebo Notion,
- pořádek a klid jako moderní CRM,
- materiálový pocit jako skandinávský interiér: neutrální plochy, jemné vrstvy, málo efektů, důraz na funkci.

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
- `--success`
- `--recording`
- `--danger`
- `--warning`
- `--info`

### Dark Mode Palette

Dark mode má být černo-šedý a neutrální. Teal je akcent pro aktivní akce, stav live přepisu a brand, ne dominantní barva celé obrazovky.

- `--bg`: `#071014`
- `--surface`: `#0d171d`
- `--surface-muted`: `rgba(255, 255, 255, 0.045)`
- `--surface-raised`: `#121f27`
- `--border`: `rgba(194, 213, 218, 0.14)`
- `--border-strong`: `rgba(32, 176, 168, 0.34)`
- `--text`: `#eef4f3`
- `--text-secondary`: `#b8c5c8`
- `--text-muted`: `#99a9ad`
- `--accent`: `#20c3b8`
- `--accent-hover`: `#35d0c6`
- `--accent-text`: `#042022`
- `--success`: `#88a79a`
- `--recording`: `#f36b6b`
- `--danger`: `#f36b6b`
- `--warning`: `#db9852`
- `--info`: `#4e8ccf`

### Light Mode Palette

Light mode má být bílý, světle šedý a pracovní. Nemá působit jako marketingová stránka. Teal akcent používat stejně střídmě jako v dark mode.

- `--bg`: `#f4f7f7`
- `--surface`: `#ffffff`
- `--surface-muted`: `rgba(9, 34, 41, 0.045)`
- `--surface-raised`: `#edf3f3`
- `--border`: `rgba(20, 48, 56, 0.12)`
- `--border-strong`: `rgba(18, 151, 143, 0.3)`
- `--text`: `#132428`
- `--text-secondary`: `#40575d`
- `--text-muted`: `#63777c`
- `--accent`: `#128f88`
- `--accent-hover`: `#0b6f68`
- `--accent-text`: `#f8ffff`
- `--success`: `#5f7f70`
- `--recording`: `#cc4f4f`
- `--danger`: `#cc4f4f`
- `--warning`: `#b46c2d`
- `--info`: `#346da8`

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

- preferred: `Geist Sans`,
- fallback: `Aptos`, `Segoe UI`, `system-ui`, `sans-serif`.

Data/monospace font:

- preferred: `Geist Mono`,
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

- pracovní obrazovky používají compact density,
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
