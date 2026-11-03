# Backlog – navazující úkoly (listopad 2026)

Úkoly vědomě odložené při práci na sjednoceném UI, výkonu DB a citacích v chatu (03.11.2026). Každá položka popisuje aktuální stav a co je potřeba udělat. Po dokončení položku smaž.

## Výkon

- [ ] **Detail posílá do prohlížeče celý JSON `segments` přepisu** (průměr ~2 MB, max ~5,2 MB). Cesta: `src/lib/transcripts/queries.ts` → `app/recordings/[recordingId]/page.tsx` → klientská `src/components/transcript-tabs.tsx`. Cíl: speaker bloky a evidence lokace počítat na serveru a klientovi posílat kompaktní bloky. Navazuje na `docs/gotchas.md` (velké segmenty). Architektonická změna detailu – nejdřív krátký návrh.
- [ ] **Hledání stále skenuje všechny nahrávky** – `accessible_recording_search_winners_v1` (`authorized_ids`) nemá kandidátní předfiltr jako `accessible_recording_rows_v1`. Použít stejnou kandidátní nadmnožinu + test ekvivalence oprávnění.
- [ ] **Koš volá capabilities po jedné** – `listDeletedRecordings` v `src/lib/recordings/queries.ts` přepnout na `resolveRecordingCapabilitiesBatch`.
- [ ] **`recording_access_role_v1` je sám pomalý** (~5 ms/volání i na malých datech). Rozebrat plán funkce a `vosio_team_private.scope_role`.
- [ ] **`findExistingPart` v `src/lib/recordings/upload.ts`** dělá `bucket.list()` před každou 15s částí. Po opravě storage policy je levné; zvážit `info()`/`exists` se zachováním kontroly velikosti a MIME (`docs/gotchas.md`).
- [ ] **37 „nepoužitých“ indexů podle advisoru** – nesahat, dokud nebude delší statistika provozu; pak vyhodnotit.

## UI

- [ ] **Záhlaví tabulky nahrávek zalamuje sloupec „DÉLKA“** na druhý řádek a délka je pod názvem (inbox 1440 px). Ověřit proti stavu před 03.11.2026 a opravit grid.
- [ ] **`bulk-recording-sharing.tsx:106`** ukazuje „Uživatel {uuid}“ – zobrazit e-mail jako ve správě přístupů.
- [ ] **Radius** – tokeny `--radius-sm/md/lg/pill` jsou v `DESIGN.md` a `base.css`, ale ~445 deklarací `border-radius` ještě není přemapovaných.
- [ ] **Duplicitní deklarace stejného selektoru** se stejným tokenem (např. `.recordings-inbox-header h1` ve 3 souborech) sloučit.
- [ ] **~80 globálních CSS tříd bez reference v TS** (např. `recording-rail`, `prompt-template-card`, `ai-panel`) – ověřit dynamicky skládané názvy a smazat.
- [ ] **Dva vzhledy segmentů** – filtr v Novinkách (rámečky) vs. viditelnost v dialogu (podtržené záložky). Rozhodnout jeden.
- [ ] **Křehký selektor** `section[aria-label="Správa přístupu"]` v `app/styles/ui-primitives.css` – nahradit třídou v `project-access-manager.tsx`.
- [ ] **`team-manager.module.css`** je minifikovaný na jeden řádek a tlačítka nepoužívají `.ui-button`.
- [ ] **`chat-content.tsx`** má ještě 2 ikony `size={16}` mimo škálu.

## Testy a provoz

- [ ] **~70 e2e testů selhává už na výchozím stavu** (hlavně očekávají 44 px cíle a 6 px radius na desktopu s jemným ukazatelem, což odporuje 30–32 px politice). Sjednotit očekávání s `DESIGN.md`.
- [ ] **Citace v chatu ověřit na živém providerovi** po nasazení – nový dotaz musí ukázat tlačítko s časem a klik skočit v přepisu.
