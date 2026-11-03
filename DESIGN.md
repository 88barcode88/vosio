# Design System — Vosio

## Kompaktní ovládání detailu a inboxu

Pro sjednocený editor detailu uživatel schválil variantu A: jeden kompaktní dialog do 600 px, otevřený akcí `Upravit a sdílení` před Exportem. Nahrazuje tři samostatné detailové akce. Pořadí je Název, Klient, Projekt, Složka, vždy otevřená sekce Štítky a pak Sdílení nahrávky. Štítky jsou vícenásobný checkbox výběr s textem `#Název`; existující úvodní `#` se neopakuje. Viditelnost Soukromá / Vybraní lidé / Projekt je přímo viditelná, stejně jako bezpečný badge v hlavičce detailu. Na mobilu dialog vyplní viewport, má vlastní scroll a oddělený footer; akce dodržují společnou 32/44px politiku. Typografie, barvy a tokeny se nemění. Referenční návrh A používá stávající klidné rozlišení ploch inspirované Linear/Cal/Notion, bez převzetí jejich identity.

Název, zařazení a sdílení mají vlastní jednoznačné ukládací akce a výsledky, nejde o společnou atomickou mutaci. Náhled dopadu zařazení a potvrzovací fingerprint zůstávají zachované. Rozpracované zařazení blokuje navazující sdílení a pozvánky do potvrzení; závislé akce používají uložený projekt. Známé příjemce lze vybírat checkboxy s počtem a zachováním přesných uložených rolí. Souhrn nesmí vydávat konkrétní příjemce za úplný seznam všech dynamických přístupových cest. Pozvat k nahrávce a Pozvat do projektu jsou samostatné výslovné akce; projektová pozvánka vyžaduje existující founder capability. Pending blokuje zavření; nejasný sharing výsledek zachovává UUID a payload v připojeném editoru a zamyká sourozenecké mutace do potvrzení stejného požadavku. Úspěch dialog nezavírá. Title-only editor nedostává sdílení, reader žádné management UI.

Rychlé AI akce používají stejnou malou jednořádkovou plochu. Jejich doplňující popis zůstává v nápovědě `title` a vizuálně skrytém textu pro asistivní čtení; neroztahuje každý knoflík na dva řádky. Primární posuvník přehrávače zachovává 44px plochu i na fine desktopu.

Jediná reference drobných akcí pro celý web je toolbar Filtry / Spravovat / Nedokončené. Na desktopu od 901 px s jemným ukazatelem bez coarse mají akce i nativní jednořádková pole přibližně 30–32 px a akční ikony 15 px. Na mobilu, coarse i hybridních zařízeních zůstávají nepřekrývající se cíle nejméně 44 px; menší viditelnou plochu od skutečného cíle odděluje společný inset. Pevný 7px inset platí jen pro 44px cíl, na fine desktopu je nulový. Souhrn identity mluvčího je svisle vystředěný; saving/error feedback zůstává v příslušném sloupci. AI/Timeline akce používají existující command vzor. V chatu lze modelové nastavení sbalit; vybraný model a uvažování zůstávají v souhrnu a cenová nápověda je dostupná po rozbalení. Escape vrátí focus na souhrn.

Inbox odděluje Klient a Projekt v desktopových sloupcích i mobilních popiscích. Ellipsis otevírá přímo pojmenovaný popup `Název a zařazení` s oddělenými sekcemi Název (pole a `Uložit` na jednom řádku) a Zařazení (`Uložit zařazení`). Výsledek jedné sekce nevydává za společný úspěch. Jednotlivé uložené změny popup automaticky nezavírají; pending blokuje zavření a chyby zachovávají koncepty.

Pro sekci Tým uživatel schválil nový kompaktní návrh 2: úzký neobalený seznam osob vlevo a detail přístupů vpravo. Nahrazuje původní rámované rozložení A. Aktivní přístupy mají krátké řádky typ/název/hranice, role a Odebrat, bez opakovaných vysvětlivek. Přidělit přístup rozbaluje inline procházení klient → projekt → dostupná složka → nahrávka s drobečkovou navigací, hromadným výběrem, společnou rolí a jedním uložením. Desktopové řádky a viditelné akce mají přibližně 30–32 px, avatary 24 px; na mobilu a pro dotykové ovládání mají cíle nejméně 44 px. Tým používá stejnou globální rozměrovou politiku jako ostatní obrazovky. Nevkládat rámované panely do dalších panelů.

Mobil přechází ze seznamu do detailu a nabízí návrat. Odkaz patří na desktopu do navigace a na mobilu pod Více; pět pevných mobilních cílů zůstává. Aktivní přístupy a čekající pozvánky jsou oddělené. Grant klienta/složky popisuje současné i budoucí nesoukromé nahrávky; projekt zahrnuje nahrávky sdílené s projektem. Soukromou nahrávku lze výslovně zvolit samostatně: viditelný štítek Soukromá a souhrn Nově sdílené soukromé s konkrétním příjemcem před uložením. Samotné zařazení nic nesdílí. Odebrání vyžaduje konkrétní potvrzení a ponechává ostatní platné cesty. Uživatelská akceptace implementovaného UI zůstává samostatná.

Badge bezpečně dostupného zařazení je malý text přímo za aktuálním stavem nahrávky. Jeden editor zařazení patří před Export do horních akcí. Hlavička Úkoly jako checklist obsahuje Kopírovat, MD a potvrzované mazání checklistu; při pending zůstává připojená a po potvrzeném prázdném stavu nezůstává osamocená akce. Pracovní seznamy používají oddělovače a přirozenou výšku podle obsahu, nikoli vnořené rámované karty nebo neodůvodněná řádková minima. Primární nahrávání, přehrávač, waveform a loga mají vlastní účelovou geometrii.

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

### Aliasy a hardcoded barvy

Legacy aliasy (`--muted`, `--teal`, `--panel*`, `--red`, `--green`, `--orange`, `--blue`, `--foreground`) a tyrkysové `rgba(...)` neexistují a nesmí se vracet. Doplňkový text používá `--text-secondary` (běžný) nebo `--text-muted` (skutečně vedlejší), akcent `--accent`, plochy `--surface`, `--surface-muted`, `--surface-raised`, stavy `--danger`, `--success`, `--warning`, `--info`. Průhledné odstíny stavových ploch se skládají přes `color-mix(in srgb, var(--info) 10%, transparent)`. Checkboxy a radia mají globálně `accent-color: var(--accent)`.

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
- fallback: `Segoe UI`, `system-ui`, `sans-serif`,
- stejný font pro nadpisy, formuláře i metadata; samostatný heading font neexistuje.

Data/monospace font:

- fallback: `JetBrains Mono`, `Consolas`, `monospace`.

Škála písma je uzavřená: pět velikostí, tři tloušťky, tři řádkování. Velikosti jsou v `rem` (hodnoty v px platí při výchozím kořenovém písmu 16 px), aby fungovalo zvětšení textu v prohlížeči. Mimo tokeny `font-size`, `font-weight` ani `line-height` nepiš (výjimka: číselný displej časovače nahrávání, označený komentářem).

| Token | Hodnota | Použití |
|---|---|---|
| `--text-xs` | 11 px | metadata, badge, popisky polí, časy |
| `--text-sm` | 12 px | výchozí UI: tlačítka, inputy, selecty, navigace, běžné texty v panelech |
| `--text-md` | 14 px | čtecí text (přepis, AI výstup, chat), nadpis karty nebo sekce v dialogu |
| `--text-lg` | 17 px | nadpis sekce stránky (H2) |
| `--text-xl` | 21 px | titulek stránky (H1), stejný na všech stránkách včetně detailu |

| Token | Hodnota | Použití |
|---|---|---|
| `--weight-regular` | 400 | běžný text |
| `--weight-medium` | 500 | tlačítka, labely, navigace |
| `--weight-semibold` | 600 | nadpisy, důraz |

| Token | Hodnota | Použití |
|---|---|---|
| `--leading-tight` | 1.2 | titulky, jednořádkové prvky |
| `--leading-ui` | 1.35 | ovládání, krátké popisky |
| `--leading-body` | 1.5 | souvislý text |

- Mobilní textová pole používají `--text-lg`, aby iOS při zaostření nepřibližoval stránku (hranice 16 px).
- Čas, velikost souboru a timer používají `font-variant-numeric: tabular-nums`.

Icon rules:

- velikost ikony určuje CSS token, `size` prop v TSX má stejnou hodnotu (15 výchozí), aby kód nelhal,
- `--icon-sm` 13 px: inline v metadatech a drobečkové navigaci,
- `--icon-md` 15 px (= `--control-icon-size`): všechna tlačítka a navigace,
- `--icon-lg` 20 px: prázdné stavy, nahrávání a play,
- jedna ikona = jedna akce: Uložit `Save`, Zavřít/Zrušit `X`, Smazat `Trash2`, Sdílet `Share2`, Upravit `Pencil`, Zkusit znovu `RotateCw`, Obnovit z koše `Undo2`, Obnovit výchozí text `RotateCcw`, Varování `TriangleAlert`, Nahrát `Upload`,
- velké dekorativní ikony se nepoužívají, logo nesmí určovat velikost ostatního UI.

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

- `--radius-sm` 5 px: ovládací prvky (tlačítka, inputy, selecty, chipy),
- `--radius-md` 8 px: menší karty a seznamové plochy,
- `--radius-lg` 12 px: panely a modaly,
- `--radius-pill` 999 px: pilulky.

Nested radius musí být opticky konzistentní: vnitřní radius má být menší než vnější.

Pracovní plochy inboxu, filtrů, řádků, Draweru, capture a Koše používají kompaktní radius 4-6 px. Interaktivní cíle se řídí společnou politikou: fine desktop 30–32 px, mobil/coarse/hybrid nejméně 44 px.

## Layout

Desktop shell:

- sidebar: 224 px rozbalený a 64 px sbalený,
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

### Tlačítka

- Referenční vzhled je toolbar Filtry / Spravovat / Nedokončené: 12 px, `--weight-medium`, ikona 15 px, výška z `--control-hit-size`, plocha vykreslená přes `::before`.
- Nové tlačítko nikdy nezůstává nativní šedé. Používej `.ui-button` (+ `--primary`, `--danger`, `--icon`) a `.ui-segmented` z `app/styles/ui-primitives.css`; globální whitelist v `compact-recordings.css` se dál nerozšiřuje.
- Role se všude jmenují `Úpravy` a `Čtení`. Tři tečky se píší jako `…`.

### Účet v sidebaru

Kompaktní řádek: avatar 28 px, `Vosio účet` v `--text-sm` a `--weight-semibold`, e-mail v `--text-xs` na jeden řádek s ellipsis, odhlášení jako icon-button. Ve sbaleném sidebaru zůstává jen avatar.

### Dokumentace a Novinky

Každá změna viditelná uživateli aktualizuje Dokumentaci v aplikaci (`/documentation`) a Novinky (`/whats-new`, data v `src/lib/whats-new/entries.ts`). Novinky jsou psané pro uživatele: co uvidí, bez technických detailů.

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
- sekundární `Dokumentace` a `Novinky` (s tečkou, dokud je uživatel neotevře) nad user/account area na desktopu,
- user/account area.

Na mobilu může `Dokumentace` zůstat ve spodní navigaci, protože user/account area se tam nezobrazuje.

Nepatří sem:

- duplicitní seznam nahrávek,
- storage progress karta,
- AI zpracování jako primární položka bez samostatného workflow.

### Recordings Inbox

`/recordings` je jeden kompaktní pracovní inbox, ne sestava panelů nebo tabulek vložených do sebe.

- Nad obsahem je jeden kompaktní toolbar: pružné hledání s vlastní ikonou, `Filtry`, hned za nimi `Spravovat` a případně `Nedokončené · N`. Akce mají stejně jako detail 30px viditelnou plochu, 15px ikony a společnou fine/touch geometrii.
- Nedokončené nahrávky patří do kontextového popupu, ne do dominantního banneru nad seznamem. Zavření popupu nikdy nemaže místní bezpečnostní kopii ani serverový záznam. Odstranění musí být samostatně potvrzené, odlišovat místní kopii od serverové nahrávky a respektovat aktivního zapisovatele.
- Hromadné sdílení začíná checkboxem přímo u autorizované soukromé nahrávky. Teprve neprázdný výběr zobrazí malý action toolbar `Vybráno N`, `Sdílet`, `Zrušit výběr`; sdílení nepatří mezi filtry. Výběr nejvýše 100 položek a stejný request při nejistém retry zůstávají zachované.
- Stavové facety tvoří měkký segmentovaný řádek; seznam je jeden bílý 16px panel s jemnými skupinovými oddělovači a neobaluje jednotlivé desktopové řádky dalšími kartami.
- Název je pružný sloupec. Řádek končí úzkou ellipsis akcí a editace názvu s Košem jsou dostupné až v jejím přístupném menu.
- Inbox používá studené `#f7f8fa` pozadí a bílý `--surface-raised`, bez původního teplého béžového tónu; dark mode zůstává plnohodnotný.
- Existující filtry `q`, `status`, `client`, `project`, `folder` a opakovatelný `tag` zůstávají URL-backed. Pokročilá organizační část používá keep-mounted ukotvený popup do 360 px, ne plnošířkový panel. Zachovává draft, focus trap, Escape, návrat focusu a blokování zavření během aktualizace filtrů.
- Zdroj a datum nejsou nové filtry tohoto UI-only řezu.
- Při viewportu 900 px a méně se hledání přesune na vlastní řádek; `Filtry` a `Spravovat` zůstávají kompaktní sousední akce. Stavové počty mají 30px viditelný segment; na fine desktopu má cíl 30–32 px, na mobilu/coarse/hybrid nejméně 44 px. Samotný seznam přechází na karty podle skutečné šířky content containeru 680 px a méně, ne pouze podle viewportu.
- Správa zařazení používá Drawer do 640 px. Název má vlastní čitelný sloupec, akce pružný vedlejší sloupec a správa přístupu celý řádek pod nimi. Do 480 px se název, akce a formulář skládají pod sebe; krátká jména se nelámou po jednotlivých písmenech.

### Recording Detail

Detail nahrávky je pracovní objekt, ne hero.

- Header drž kompaktní: název, stav, metadata a destruktivní akce.
- `Upravit a sdílení` a `Export` mají stabilní umístění v jedné action liště. Sjednocený editor je před Exportem; organizační chipy a viditelnost jsou vedle stavu nahrávky. Editor neodsouvá přehrávač ani ostatní akce.
- Viditelná geometrie drobných akcí má výšku přibližně 30 px, ikony 15 px a titul detailu 21 px; skutečný hit target je na fine desktopu 30–32 px a na mobilu/coarse/hybrid nejméně 44 × 44 px. Sjednocený dialog má šířku nejvýše 600 px a vlastní scroll; ostatní kontextové popupy zůstávají do 360 px s 16px okraji viewportu.
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
- Klávesnice i dotyk, společné fine/touch cíle, desktop/mobile a light/dark.
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

- tlačítka a ovládací prvky používají fine desktop 30–32 px a mobil/coarse/hybrid nejméně 44 px hit area,
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
