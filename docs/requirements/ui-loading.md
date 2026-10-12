# Načítání pracovních ploch

Zdrojový audit P1 pokrývá všechny produkční stránky. Browser důkaz je níže
vymezený podle konkrétních případů; audit sám nepotvrzuje live ani uživatelskou
acceptance.

`WorkspaceLoading` používá skutečný `VosioWorkspace` pro loading a obnovitelné
route chyby. Prázdné vstupní seznamy nejsou prezentované jako hotový inbox:
`pendingContent` nahrazuje pouze obsah uvnitř navigace a topbaru. AI metadata,
timeline a chat odlišují neznámý počáteční stav od potvrzeného prázdného výsledku.
Při chybě kontroly na pozadí zůstávají načtené výstupy a kapitoly připojené.

| Produkční oblast | Zkontrolovaný tok | Důkaz / zbývající acceptance |
| --- | --- | --- |
| `/`, `/auth/callback` | Serverové přesměrování podle session, bez vlastního datového empty UI | Source audit; pomalé přesměrování neověřené v browseru |
| `/login` | Auth card, inline chyba, opakovaný submit | Source audit; auth latence a focus neověřené |
| `/invitations/accept` | Načítání ověření, OTP, preview, potvrzení, inline chyba | Source audit; různé výšky jsou skutečný obsah, browser acceptance neověřená |
| `/configuration` | Synchronní diagnostika konfigurace | Source audit; bez klientského unknown/empty přechodu |
| `/recordings` | Loading shell, serverový inbox, search/filter, route chyba a reset | Reprodukce chybějícího sidebaru před opravou; anchor trace po opravě desktop/mobile light/dark |
| `/recordings/new`, `/recordings/[id]` | Děděný recordings loading/error, vlastní capture/detail | Source audit; samostatný inherited loading → detail/capture trace ještě chybí |
| `/ai`, `/templates`, `/settings`, `/trash`, `/documentation` | Loading shell, potvrzený obsah/prázdno, route chyba a reset | Anchor trace po opravě desktop/mobile light/dark pro všech pět ploch |
| Nastavení bez e-mailu | Authenticated fail-closed informace uvnitř shellu | Runtime render unit test; browser acceptance neověřená |
| AI detail | Metadata před tělem, unknown/empty, body chyba/retry, polling | Unit unknown/empty a stale hydration; existující browser quiet refresh udržuje disclosure, task, focus a scroll |
| Timeline | Markery, metadata, unknown/empty, kapitoly, background chyba/retry | Unit test drží stejný DOM kapitoly při chybě; browser background-error acceptance neověřená |
| Chat | Unknown/empty, počáteční chyba/read retry, historie a transportní reconciliation | Unit test zachování composeru a pouze GET při retry; browser acceptance po změně neověřená |
| Audio, soubory, přepis | Samostatná URL/chyba/retry přehrávače, serverový přepis, statické soubory | Source audit; delayed signed URL a segmented playback neověřené |
| Live, upload, import | Recorder v root provideru, vlastní fáze/progress/chyby | Source audit; nové výsledky mění výšku legitimně; delayed/error/focus acceptance neověřená |
| Recovery inboxu, capture approvals | Async panel nebo možnosti mohou přibýt nad ovládáním | Kandidáti bez naměřené reprodukce; neoznačeny za opravený bug |
| Přístupové a organizační dialogy, purge recovery | Načtení seznamu, controlled draft, busy/error/retry | Source audit; pomalé odpovědi a mutation focus neověřené |
| Root error/global error/404 | Sanitizovaný catch-all nebo náhradní dokument | Záměrné nouzové/invalid-navigation plochy; shell acceptance neověřená |

Automatizovaný fixture `workspace-loading.spec.ts` měří geometrii sidebaru nebo
mobilní navigace přes loading i error → retry → ready. Tolerance je 1 px,
oba motivy a oba viewporty. Fixture je pouze development, vyžaduje náhodný scope,
nečte soukromá data a nevolá placené providery. Jeho ready stav je syntetický;
neprokazuje cílové DB oprávnění ani všechny production navigace.

Reprodukční trace a následné trace musí být uchované odděleně. Proměnlivá výška
skutečného nového obsahu není automaticky regresí. Zbylé browser případy mají
před release doplnit acceptance, nikoli automaticky vyvolat redesign aplikace.
