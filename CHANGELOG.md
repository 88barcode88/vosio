# Changelog

Všechny významné změny Vosia jsou vedené v tomto souboru. Projekt používá Semantic Versioning.

## [Unreleased]

## [0.1.5] - 2026-08-12

### Added

- Volba globálního nebo evropského regionu Soniox přímo v Nastavení, včetně upozornění na požadavky EU projektu a regionálního klíče.
- Bezpečná diagnostika instalace, která zobrazuje pouze prostředí a názvy chybějících proměnných, nikdy jejich hodnoty.
- Samostatná konfigurační stránka pro chybějící veřejné Supabase proměnné bez načtení Supabase klienta.

### Changed

- Nové async i live přepisy používají region uložený u uživatele a async job si svůj region zachová po celou dobu zpracování.
- Instalace používá jeden popsaný postup pro vlastní Supabase, Soniox a AI klíče v Production i Preview prostředí.

### Fixed

- Starší async joby bez uloženého regionu pokračují bezpečně přes globální Soniox endpoint.
- Nastavení regionu zachová rozepsanou EU nebo globální volbu při neúspěšném uložení bez vytváření chybového záznamu v historii prohlížeče.

## [0.1.4] - 2026-08-10

### Added

- Nový konzistentní Notion Warm workspace pro nahrávky, detail, prompty, AI archiv, nastavení, Koš a dokumentaci.
- Samostatný plný detail nahrávky s přepisem, AI zpracováním, časovou osou a soubory.
- Obnovení nahrávek z Koše, bezpečné permanentní mazání a česká stránka 404.
- URL řízený editor promptů a sekundární AI archiv s filtrováním podle typu a nahrávky.

### Changed

- Nahrávky se otevírají přes název a dlouhý obsah používá responzivní pracovní plochu místo postranního detailu.
- Správa nahrávek, filtry, capture workspace a nastavení jsou kompaktnější a použitelné na mobilu i menším desktopu.
- Koš uchovává přesný původní stav a neměnný čas smazání; permanentní purge čeká 24 hodin kvůli TUS uploadům.

### Fixed

- Opakovaný posun přehrávače funguje bez nutnosti pohnout myší a klávesové ovládání drží aktuální ARIA hodnoty.
- Nastavení a dlouhý detail mají dosažitelný obsah bez horizontálního přetékání.
- Upload přijímá platný 33 MiB M4A i při obecném browser MIME a zachovává stabilní průběh.
- Filtry klientů, projektů, složek a štítků používají kanonický URL stav a více štítků má ALL sémantiku.
- Celé AI generace lze smazat a jednotlivé úkoly mají samostatnou kompaktní akci koše.
- Route chyby a destruktivní akce nezobrazují interní provider nebo databázové detaily.

## [0.1.3] - 2026-08-07

### Added

- Per-user Supabase Storage preference `Auto`, `Free` nebo `Paid` v Nastavení.
- Transparentní zobrazení bucketu, nezjištěného globálního limitu a efektivních limitů manuálního uploadu a live audia.
- Veřejné README s tlačítkem pro Vercel nasazení a postupem pro vlastní Supabase a Soniox EU projekt.

### Changed

- Upload limit používá nejpřísnější známé omezení a plan preference ho může pouze snížit.

### Fixed

- Placený plan hint už nemůže působit dojmem, že automaticky zvýšil skutečný Supabase bucket limit.
- Uložení Nastavení zachová skrytou hodnotu AI temperature i nesouvisející top-level Supabase Auth metadata.

## [0.1.2] - 2026-08-06

### Added

- Next.js PWA workspace s interním Supabase Auth, private Storage a přímým resumable TUS uploadem.
- Soniox async a realtime přepis včetně diarizace, opakování přepisu, segmentovaných live nahrávek a obnovy draftů.
- AI zpracování přepisů přes OpenAI nebo Gemini pro shrnutí, úkoly, meeting minutes, CRM poznámky, timeline a follow-up e-maily.
- Editace systémových promptů přes uživatelské kopie, správa mluvčích, exporty, koš a permanentní mazání.
- Organizace nahrávek podle klientů, projektů, složek a štítků včetně filtrů a barevných badge.
- Live značky důležitých momentů, bezpečné audio playback odkazy a navigace z AI důkazů do přepisu.
- Indexované fulltextové hledání v nahrávkách a přepisech s deep-link navigací.
- PWA instalace, mobilní workspace, světlé a tmavé téma a dokumentace přímo v aplikaci.

### Changed

- Soniox async a realtime modely byly sjednocené na v5 a live nahrávání dostalo volbu jazyka.
- AI modelový katalog byl aktualizovaný na GPT-5.6 Sol, Terra, Luna a Gemini 3.6 Flash s orientačními cenami.
- Aktivní live nahrávání zůstává zachované při interní navigaci a audio používá oddělenou ochrannou limitní politiku.

### Fixed

- Stabilita dlouhého live nahrávání, reconnectu, stop lifecycle, ukládání finálních tokenů a segmented retry.
- Zachování původního přepisu během neúspěšného opakovaného přepisu.
- Synchronizace filtrů s historií prohlížeče, layout detailu, scroll hranice a mobilní popovery.
- Ukládání editorů až po potvrzeném úspěchu a zachování rozepsaných hodnot při chybě.
