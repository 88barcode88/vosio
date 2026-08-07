# Changelog

Všechny významné změny Vosia jsou vedené v tomto souboru. Projekt používá Semantic Versioning.

## [Unreleased]

## [0.1.3] - 2026-08-07

### Added

- Per-user Supabase Storage preference `Auto`, `Free` nebo `Paid` v Nastavení.
- Transparentní zobrazení bucketu, nezjištěného globálního limitu a efektivních limitů manuálního uploadu a live audia.

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
