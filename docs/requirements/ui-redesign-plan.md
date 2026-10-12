# UI Redesign Plan

## Cíl redesignu

Redesign má z Vosio udělat skandinávsky střídmý pracovní audio workspace. Funkce už existují ve více částech aplikace, ale UI musí být přehlednější, méně hero/dekorativní a více orientované na práci s konkrétní nahrávkou.

Hlavní cíle:

1. rychle spustit live nahrávání,
2. rychle vložit existující audio nebo MP4,
3. rychle najít nahrávku,
4. po otevření nahrávky pracovat s přepisem, AI výstupy, obsahovou časovou osou a soubory.

## Aktuální zjištění v kódu

Hlavní pracovní shell je v `src/components/vosio-workspace.tsx`.

Aktuální stav:

- `VosioWorkspace` míchá shell, navigaci, seznam nahrávek, detail nahrávky, utility stránky a AI panel v jednom souboru.
- `NewRecordingWorkspace` má stále hero blok `Live přepis nebo soubor`, který je moc velký pro pracovní aplikaci.
- `RecordingCard` v detailu nahrávky používá velký timer/title layout a dekorativní waveform, což zabírá moc místa.
- `AiPanel` je stále pravý panel v detailu a zároveň existuje globální stránka `/ai`.
- `TranscriptTabs` má taby `Přepis`, `Časová osa`, `Poznámky`, `Soubory`; cílově má být `Poznámky` nahrazené nebo rozšířené na `AI zpracování`.
- `TimelineContent` dnes ukazuje technické segmenty z provider JSON, ne obsahové kapitoly hovoru.
- `app/globals.css` už obsahuje dark/light CSS proměnné, ale potřebuje zpřesnit design tokeny, hustotu, card sizing a responsive pravidla.

## Cílová informační architektura

Vybraný UI hybrid:

- `/recordings`: inbox nahrávek,
- `/recordings/new`: capture console,
- `/recordings/[recordingId]`: transcript studio.

Společný vizuální jazyk:

- malé ikony,
- menší běžné texty,
- neutrální černo-šedý dark mode,
- bílý/světle šedý light mode,
- near-black primary actions a sémantické status barvy pouze pro jejich význam,
- žádné velké dekorativní plochy.

Primární navigace:

- `Nová nahrávka`
- `Nahrávky`
- `AI prompty`
- `Koš`
- `Nastavení`

`AI zpracování` nemá být primární položka v sidebaru, dokud jde o práci nad konkrétní nahrávkou. AI patří do detailu nahrávky.

Route model:

- `/recordings` je inbox/seznam nahrávek.
- `/recordings/new` je capture plocha pro live nahrávání a upload.
- `/recordings/[recordingId]` je hlavní pracovní detail nahrávky.
- `/templates` spravuje prompty.
- `/settings` spravuje netajné uživatelské preference.
- `/trash` zobrazuje soft-smazané nahrávky.

## Cílové obrazovky

### `/recordings`

Seznam nahrávek má být kompaktní inbox.

Požadavky:

- řádek se otevírá kliknutím,
- žádné tlačítko `Otevřít`,
- editace názvu přes samostatnou akci,
- viditelný stav přepisu,
- datum, velikost a zdroj kompaktně,
- připravené místo pro budoucí filtr.

### `/recordings/new`

Obrazovka nové nahrávky má mít dvě hlavní akční karty.

Desktop:

- karta `Nahrávat live`,
- karta `Nahrát soubor`,
- bez velkého hero nadpisu.

Mobile:

- nejdřív `Nahrávat live`,
- potom `Nahrát soubor`.

Live karta po spuštění ukazuje:

- timer,
- stav mikrofonu,
- stav Soniox realtime spojení,
- režim `Audio do {aktuální limit bucketu} + přepis` / `Jen live přepis`,
- live titulky,
- speaker bloky, pokud Soniox vrátí mluvčí,
- srozumitelnou chybu, když realtime přepis selže.

Upload karta ukazuje:

- výběr audio/MP4,
- alternativní systémový file picker,
- aktuální limit načtený z bucketu `recordings`,
- stav uploadu.

### `/recordings/[recordingId]`

Detail nahrávky má být hlavní pracovní plocha.

Horní header má být kompaktní:

- editovatelný název,
- stav,
- datum,
- délka,
- velikost,
- zdroj,
- akce `Zkontrolovat přepis`, `Export`, `Smazat`.

Velká dekorativní waveform karta se má odstranit nebo výrazně zmenšit.

Taby:

- `Přepis`
- `AI zpracování`
- `Časová osa`
- `Soubory`

## AI zpracování v detailu

AI zpracování má být tab v detailu nahrávky.

Obsah:

- rychlé akce: `Shrnutí`, `Úkoly`, `Zápis ze schůzky`, `CRM poznámka`, `E-mail po hovoru`,
- model a temperature jako pokročilé nastavení,
- seznam uložených výstupů,
- detail vybraného výstupu,
- stav zpracování.

Globální `/ai` může později sloužit jako archiv všech AI výstupů napříč nahrávkami, ale nemá být hlavní cesta pro běžný workflow.

## Obsahová časová osa

Současná technická časová osa po segmentech není cílový UX.

Cíl:

- časová osa je AI rozdělení hovoru na kapitoly/témata,
- kapitoly mají časový rozsah,
- každá kapitola má název, shrnutí, související mluvčí a případné úkoly/rozhodnutí.

Příklad:

- `00:00-04:20 Úvod a kontext`
- `04:20-12:10 Úkol 1`
- `12:10-18:45 Feedback k minulé práci`
- `18:45-29:30 Úkol 2`

Technický dopad:

- přidat nový AI processing typ, pracovně `timeline_chapters`,
- přidat systémovou prompt šablonu pro časovou osu,
- zobrazovat výstup v tabu `Časová osa`,
- fallback: pokud AI časová osa neexistuje, nabídnout její vytvoření.

`public.ai_processing_type` obsahuje `timeline_chapters`; systémová šablona pro tento typ je součástí migrací a musí být aplikovaná v cílové Supabase DB.

## Design systém

Styl:

- skandinávský pracovní workspace,
- moderní CRM / Linear / Notion,
- kompaktní pracovní hustota,
- žádné hero bloky uvnitř aplikace,
- žádné dekorativní benefit stripy,
- méně velkých prázdných karet,
- žádné velké dekorativní ikony.

Theme:

- dark mode jako primární,
- light mode jako plnohodnotný,
- společné tokeny pro oba režimy.

Token skupiny:

- `background`,
- `surface`,
- `surface-muted`,
- `surface-raised`,
- `border-subtle`,
- `border-strong`,
- `text-primary`,
- `text-secondary`,
- `text-muted`,
- `accent`,
- `accent-hover`,
- `recording`,
- `success`,
- `warning`,
- `danger`,
- `speaker-*`.

UI pravidla:

- fonty uvnitř appky menší a kompaktní,
- běžný text držet přibližně kolem 13 px,
- velké nadpisy používat jen pro jasnou orientaci, ne pro běžný obsah,
- ikony držet převážně na 15-18 px,
- tabulky a seznamy mají mít stabilní řádky,
- tlačítka minimálně 44 px hit area,
- dynamické časy a počítadla používají tabular numbers,
- panely mají střídmý radius 8-10 px, žádné zbytečně obří roundness,
- hover/focus stavy musí být viditelné v dark i light režimu.

## Implementační fáze

### Fáze 1: Design tokens a základní vizuální jazyk

Soubory:

- `app/globals.css`
- `DESIGN.md`
- dotčené komponenty podle použitých class names

Změny:

- zpřesnit dark/light tokeny do černo-šedé a bílo-šedé palety,
- snížit běžné font-size a ikonografii,
- odstranit z UI dojem velkých AI karet,
- sjednotit radius, border a surface vrstvy.

### Fáze 2: Shell a navigace

Soubory:

- `src/lib/workspace-data.ts`
- `src/components/vosio-workspace.tsx`
- `app/globals.css`

Změny:

- odstranit `AI zpracování` z primární navigace,
- zjednodušit typ `WorkspaceView`,
- udržet `/ai` jen jako sekundární route nebo archiv, pokud zůstane dostupná,
- připravit shell pro detail bez pravého AI panelu.

### Fáze 3: Nová nahrávka

Soubory:

- `src/components/new-recording-workspace.tsx`
- `src/components/browser-recorder.tsx`
- `src/components/recording-upload-form.tsx`
- `app/globals.css`

Změny:

- odstranit hero blok,
- udělat dvě akční karty,
- zlepšit live caption plochu,
- jasněji zobrazit režim ukládání,
- zachovat redirect na detail po uložení.

### Fáze 4: Kompaktní detail nahrávky

Soubory:

- `src/components/vosio-workspace.tsx`
- případně nové menší komponenty v `src/components/recording-detail/`
- `app/globals.css`

Změny:

- nahradit velkou `RecordingCard` kompaktním headerem,
- přesunout akce do headeru nebo command row,
- odstranit velkou waveform dekoraci z detailu,
- zachovat jasný stav přepisu a nahrávky.

### Fáze 5: AI jako tab detailu

Soubory:

- `src/components/transcript-tabs.tsx`
- `src/components/ai-processing-controls.tsx`
- `src/components/vosio-workspace.tsx`

Změny:

- přidat tab `AI zpracování`,
- přesunout `AiProcessingControls` do tabu,
- zobrazit uložené AI výstupy v kontextu nahrávky,
- `Poznámky` buď sloučit s AI výstupy, nebo odstranit jako samostatný tab.

### Fáze 6: AI časová osa

Soubory:

- `app/api/transcripts/[transcriptId]/process/route.ts`
- `src/lib/workspace-data.ts`
- `src/components/transcript-tabs.tsx`
- `supabase/migrations/*`

Změny:

- přidat `timeline_chapters` do DB enumu,
- přidat systémový prompt template,
- povolit nový processing type v API,
- přidat UI pro vytvoření a zobrazení časové osy.

### Fáze 7: Design polish

Soubory:

- `app/globals.css`
- upravené komponenty z předchozích fází

Změny:

- sjednotit spacing,
- zkontrolovat text wrapping,
- zlepšit focus/hover/active stavy,
- doladit speaker barvy,
- ověřit mobile layout,
- ověřit light mode.

## Ověření po implementaci

Před dokončením redesignu ověřit:

- `npm.cmd run typecheck`
- `npm.cmd run build`
- desktop `/recordings`,
- desktop `/recordings/new`,
- desktop `/recordings/[id]`,
- mobile `/recordings/new`,
- mobile detail nahrávky,
- dark mode,
- light mode,
- prázdné stavy,
- nahrávka bez speaker diarization,
- nahrávka se speaker diarization,
- nahrávka čekající na přepis,
- hotová nahrávka s AI výstupy.
