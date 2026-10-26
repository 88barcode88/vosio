# Design System — Vosio

## Kompaktní ovládání detailu a inboxu

Viditelné drobné akce mají přibližně 30px rámeček uvnitř nejméně 44px nepřekrývajícího se cíle. Souhrn identity mluvčího je svisle vystředěný; saving/error feedback zůstává v příslušném sloupci. AI/Timeline akce používají existující command vzor. V chatu lze modelové nastavení sbalit; vybraný model a uvažování zůstávají v souhrnu a cenová nápověda je dostupná po rozbalení. Escape vrátí focus na souhrn.

Inbox odděluje Klient a Projekt v desktopových sloupcích i mobilních popiscích. Ellipsis otevírá přímo pojmenovaný popup `Název a zařazení` s oddělenými sekcemi `Uložit název` a `Uložit zařazení`. Výsledek jedné sekce nevydává za společný úspěch. Jednotlivé uložené změny popup automaticky nezavírají; pending blokuje zavření a chyby zachovávají koncepty.

Pro sekci Tým uživatel schválil nový kompaktní návrh 2: úzký neobalený seznam osob vlevo a detail přístupů vpravo. Nahrazuje původní rámované rozložení A. Aktivní přístupy mají krátké řádky typ/název/hranice, role a Odebrat, bez opakovaných vysvětlivek. Přidělit přístup rozbaluje inline procházení klient → projekt → dostupná složka → nahrávka s drobečkovou navigací, hromadným výběrem, společnou rolí a jedním uložením. Desktopové řádky a viditelné akce mají přibližně 30–32 px, avatary 24 px; na mobilu a pro dotykové ovládání mají cíle nejméně 44 px. Tato výslovná kompaktní volba platí pro Tým. Nevkládat rámované panely do dalších panelů.

Mobil přechází ze seznamu do detailu a nabízí návrat. Odkaz patří na desktopu do navigace a na mobilu pod Více; pět pevných mobilních cílů zůstává. Aktivní přístupy a čekající pozvánky jsou oddělené. Grant klienta/složky popisuje současné i budoucí nesoukromé nahrávky; projekt zahrnuje nahrávky sdílené s projektem. Soukromou nahrávku lze výslovně zvolit samostatně: viditelný štítek Soukromá a souhrn Nově sdílené soukromé s konkrétním příjemcem před uložením. Samotné zařazení nic nesdílí. Odebrání vyžaduje konkrétní potvrzení a ponechává ostatní platné cesty. Uživatelská akceptace implementovaného UI zůstává samostatná.

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

Uživatel 5. 10. 2026 schválil kompaktní variantu A: zachovat současný inbox a jeho tokeny, zmenšit vizuální ovládání a přesunout vedlejší formuláře do malých popupů. Reference [Linear](https://getdesign.md/design-md/linear.app/preview), [Cal](https://getdesign.md/design-md/cal/preview) a [Notion](https://getdesign.md/design-md/notion/preview) slouží pouze pro hustotu, hierarchii a klidné kontextové ovládání; nekopíruje se jejich značka ani typografie.

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

- `--bg`: `#111318`
- `--surface`: `#1a1d24`
- `--surface-muted`: `#252830`
- `--surface-raised`: `#1a1d24`
- `--border`: `#2d313b`
- `--border-strong`: `#414754`
- `--text`: `#f2f3f6`
- `--text-secondary`: `#a2a9b7`
- `--text-muted`: `#808898`
- `--accent`: `#edf0f6`
- `--accent-hover`: `#ffffff`
- `--accent-text`: `#171b23`
- `--focus-ring`: `#abc2f8`
- `--success`: `#8ed5b0`
- `--recording`: `#f79d9f`
- `--danger`: `#f79d9f`
- `--warning`: `#ecc18c`
- `--info`: `#abc2f8`

### Light Mode Palette

Light mode je neutrální světle šedé plátno s bílými pracovními panely, ne marketingová stránka.

- `--bg`: `#f7f8fa`
- `--surface`: `#ffffff`
- `--surface-muted`: `#f2f3f5`
- `--surface-raised`: `#ffffff`
- `--border`: `#e9ebef`
- `--border-strong`: `#d8dce3`
- `--text`: `#171c27`
- `--text-secondary`: `#697180`
- `--text-muted`: `#9096a2`
- `--accent`: `#191f2c`
- `--accent-hover`: `#252c3b`
- `--accent-text`: `#ffffff`
- `--focus-ring`: `#4d6dba`
- `--success`: `#25845b`
- `--recording`: `#c94f53`
- `--danger`: `#c94f53`
- `--warning`: `#a46a18`
- `--info`: `#4d6dba`

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

- Nad obsahem je jeden kompaktní toolbar: pružné hledání s vlastní ikonou, `Filtry`, hned za nimi `Spravovat` a případně `Nedokončené · N`. Akce mají stejně jako detail 30px viditelnou plochu uvnitř nejméně 44px cíle a 15px ikony.
- Nedokončené nahrávky patří do kontextového popupu, ne do dominantního banneru nad seznamem. Zavření popupu nikdy nemaže místní bezpečnostní kopii ani serverový záznam. Odstranění musí být samostatně potvrzené, odlišovat místní kopii od serverové nahrávky a respektovat aktivního zapisovatele.
- Hromadné sdílení začíná checkboxem přímo u autorizované soukromé nahrávky. Teprve neprázdný výběr zobrazí malý action toolbar `Vybráno N`, `Sdílet`, `Zrušit výběr`; sdílení nepatří mezi filtry. Výběr nejvýše 100 položek a stejný request při nejistém retry zůstávají zachované.
- Stavové facety tvoří měkký segmentovaný řádek; seznam je jeden bílý 16px panel s jemnými skupinovými oddělovači a neobaluje jednotlivé desktopové řádky dalšími kartami.
- Název je pružný sloupec. Řádek končí úzkou ellipsis akcí a editace názvu s Košem jsou dostupné až v jejím přístupném menu.
- Inbox používá studené `#f7f8fa` pozadí a bílý `--surface-raised`, bez původního teplého béžového tónu; dark mode zůstává plnohodnotný.
- Existující filtry `q`, `status`, `client`, `project`, `folder` a opakovatelný `tag` zůstávají URL-backed. Pokročilá organizační část používá keep-mounted ukotvený popup do 360 px, ne plnošířkový panel. Zachovává draft, focus trap, Escape, návrat focusu a blokování zavření během aktualizace filtrů.
- Zdroj a datum nejsou nové filtry tohoto UI-only řezu.
- Při viewportu 900 px a méně se hledání přesune na vlastní řádek; `Filtry` a `Spravovat` zůstávají kompaktní sousední akce. Stavové počty mají 30px viditelný segment uvnitř 44px cíle. Samotný seznam přechází na karty podle skutečné šířky content containeru 680 px a méně, ne pouze podle viewportu.
- Správa zařazení používá Drawer do 640 px. Název má vlastní čitelný sloupec, akce pružný vedlejší sloupec a správa přístupu celý řádek pod nimi. Do 480 px se název, akce a formulář skládají pod sebe; krátká jména se nelámou po jednotlivých písmenech.

### Recording Detail

Detail nahrávky je pracovní objekt, ne hero.

- Header drž kompaktní: název, stav, metadata a destruktivní akce.
- `Upravit název`, `Export` a `Sdílet` mají stabilní umístění v jedné action liště. `Upravit zařazení` používá stejný keep-mounted kontextový popup u organizačních chipů. Popupy neodsouvají přehrávač ani ostatní akce.
- Viditelná geometrie drobných akcí má výšku přibližně 30 px, ikony 15 px a titul detailu 21 px; skutečný hit target zůstává nejméně 44 × 44 px. Popup má šířku nejvýše 360 px, 16px okraje viewportu a vlastní scroll na krátké obrazovce.
- Stejný malý action surface používají uložení/zrušení, prompt editor, nastavení, Koš a upload akce. Velikost přehrávače, capture a datových ikon se tím nemění. Přepis má stabilní společnou geometrii textu i ikony během pending a rezervovaný scrollovatelný status slot; request ani provider guard se vzhledem nemění.
- Popupy mají přístupný název, focus trap, Escape a návrat focusu na trigger. Pending mutaci nelze zavřít; chyba ponechá draft a nejisté sdílení zachovává stejný payload. Obsah po prvním otevření zůstává připojený.
- Přehrávač začíná jako sbalený řádek s play/pause, časem a rozbalením posuvníku. Rozbalení ani změna záložky nesmí zastavit nebo znovu načíst audio; sbalení se resetuje až při změně nahrávky.
- Připojený stavový řádek audia rezervuje kompaktní místo i pro prázdný stav. Načítání, úspěch a chyba neposouvají záložky ani chatový formulář; text se zalomí a není oříznutý ani vložený do druhého scrolleru.
- Na mobilu je přehrávač součástí horní sticky plochy se záložkami, aby nepřekrýval obsah ani spodní navigaci.
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

Výchozí osobní nahrávání je soukromé; běžná cesta je pořídit obsah, uložit a sdílet až v detailu. Volitelný keep-mounted disclosure `Projekt a pokročilé sdílení` zachovává autorizované projektové a editor scope bez dominantního formuláře. Externí capture slot nesmí zobrazovat tvrzení odvozené z jiného lokálního scope. Zobrazují se skutečné použitelné limity audia a souboru a důležité chyby, ne raw bucket/globální/preference diagnostika. Desktopová navigace začíná `Nová nahrávka`; pět mobilních navigačních cílů se nemění.

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
- model a samostatná podporovaná úroveň uvažování jako pokročilé nastavení,
- uložené výstupy,
- detail vybraného výstupu.

### Shared AI Model Picker

Uživatel 3. 10. 2026 vybral variantu A: model nad diskrétním posuvníkem
uvažování. AI detail, Nastavení a Chat používají tutéž komponentu v existujících
neutrálních plochách a tokenech; mění se pouze ovládání modelu.

- Nativní model select nad nativním range se samostatným viditelným popiskem.
- Pět kroků: Nízké (low), Střední (medium), Vysoké (high), Velmi vysoké (xhigh),
  Maximum (max). Aktuální úroveň je textová i přes `aria-valuetext`, bez procent.
- Klávesnice i dotyk, nejméně 44px cíle, desktop/mobile a light/dark.
- Podporu určuje katalog modelů; nepodporované modely místo posuvníku zobrazí
  „U tohoto modelu nelze uvažování nastavit.“ Uložená OpenAI preference zůstává.
- Scope nápověda odlišuje nový ruční výstup, ukládaný default a následující otázku.
- Žádný posuvník teploty: podporované nové požadavky mají pevnou hodnotu 0,3,
  Sol/Astra parametr vynechávají.

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
