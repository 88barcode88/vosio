# Proposal

## Why

Uživatel chce nahrávat online schůzky do Vosia jedním kliknutím přímo z prohlížeče, bez otevřené karty Vosia, bez výběrového okna pro sdílení karty a s nastavením, jak se má rozšíření při schůzce chovat. Vosio je self-hostované: každá instalace má vlastní web a vlastní Supabase, takže rozšíření se musí bezpečně spárovat s konkrétní instalací uživatele a dostat jen úzké oprávnění.

## What Changes

- Nové rozšíření prohlížeče **Vosio pro Chrome a Edge** (Manifest V3), zdrojově v tomto repozitáři, veřejně distribuované přes Chrome Web Store a Edge Add-ons. Funguje s privátní i veřejnou (source-available) verzí Vosia; self-hoster si ho může sestavit sám.
- Párování: uživatel zadá adresu svého Vosia, přihlásí se na **svém** Vosiu (heslo rozšíření nikdy nevidí), potvrdí souhlas a rozšíření dostane úzký klíč se scopem `vosio:capture`.
- Nový OAuth scope `vosio:capture` v existujícím OAuth bridge (`vosio-mcp`): smí pouze založit vlastní nahrávku, nahrát do ní audio a spustit přepis. Nesmí číst ani měnit jiné nahrávky, sdílení, tým ani MCP nástroje.
- Nové capture endpointy v Edge Function `vosio-mcp` a úzký serverový dispatch přepisu ve webu, aby se přepis spustil bez otevřeného Vosia.
- Nastavení Vosia: nová sekce se spárovanými rozšířeními a připojenými aplikacemi a tlačítkem Odpojit.
- Rozšíření: hlídání schůzek (Google Meet, Microsoft Teams web, Zoom web, vlastní weby), režimy Automaticky / Zeptat se / Vypnuto, nahrání mikrofonu i zvuku schůzky, automatický stop na konci schůzky, odeslání do Vosia a spuštění přepisu, obnova po pádu prohlížeče.
- Uživatelská dokumentace v aplikaci, Novinky, `docs/` a podklady pro store (popis, zásady ochrany soukromí, odůvodnění oprávnění).

### Dohoda, rozsah a původ akceptace

Rozhodnutí uživatele z chatu 06.11.2026 (poslední vyjasnění má přednost):

- **A1 Forma:** skutečné rozšíření prohlížeče („jako plugin rozšíření“ – Toggl, 1Password), které nahrává samo, **bez** karty Vosia. Uživatel výslovně zvolil variantu „plně v rozšíření“ po vysvětlení, že znamená vlastní přihlášení a nový vstup na server.
- **A2 Prohlížeče:** Chrome a Edge. Firefox mimo rozsah.
- **A3 Hlídané weby:** Google Meet, Microsoft Teams (web), Zoom (web) a vlastní seznam webů, který si uživatel v nastavení rozšíří.
- **A4 Režimy:** v nastavení rozšíření Automaticky / Zeptat se / Vypnuto. Chrome nedovolí nahrát zvuk schůzky bez aktivace rozšíření uživatelem; uživatel proto schválil: **Automaticky = jedno kliknutí na ikonu nebo klávesová zkratka okamžitě spustí nahrávání mikrofonu i schůzky, bez dalšího dialogu.** Zeptat se = po kliknutí se nejdřív zobrazí potvrzení.
- **A5 Párování:** každý zákazník má vlastní Vosio (web, Supabase). Uživatel se v rozšíření přihlásí ke svému Vosiu a párování potvrdí; v Nastavení Vosia vidí spárovaná rozšíření a může je odpojit. Uživatel se ptal na bezpečnost a přijal vysvětlení: přihlášení jen na stránce Vosia, omezený klíč, odpojení v Nastavení, 30denní platnost, minimální oprávnění rozšíření.
- **A6 Konec schůzky:** rozšíření samo zastaví nahrávání, uloží audio do Vosia a spustí přepis. Ruční stop zůstává.
- **A7 Režim a jazyk:** podle nastavení Vosia. Přepis běží po skončení schůzky (žádný živý přepis v rozšíření).
- **A8 Distribuce:** veřejně dostupné tak, aby ho mohl použít vlastník privátního Vosia i uživatel veřejného Vosia; uživatel potvrdil výklad: jedno veřejné rozšíření ve store, párovatelné s libovolnou instalací, zdroj v repu, vydání v privátním i veřejném repu běžným tokem dev → main.
- **A9 Proces:** plán přes OpenSpec; „ověř všechno, než se začne“ – implementaci předchází ověřovací prototyp a go/no-go bod (úkol 0).

Výklad agenta ke schválení (není rozhodnutí uživatele): A7 se vykládá tak, že rozšíření použije kvalitu nahrávání `liveAudioQuality` a region `sonioxRegion` z `vosio_settings`; jazyk přepisu je stejný jako u ostatních asynchronních přepisů Vosia (nápověda `cs` + automatická identifikace jazyka), protože Vosio dnes nemá nastavení jazyka ani režimu pro asynchronní přepis. Nová nastavení nevznikají.

Profil **Guarded** pro OAuth/scope, databázovou migraci, nový serverový vstup a nahrávání osobní komunikace. Zbytek (UI rozšíření, dokumentace) je Standard uvnitř téže změny.

Mimo rozsah: Firefox, Safari, desktopové aplikace Teams/Zoom (mimo prohlížeč), živý přepis v rozšíření, čtení nebo přehrávání nahrávek v rozšíření, přidělení nahrávky do projektu/klienta při nahrávání, kvóty a fakturace, nové role, změna 11 MCP nástrojů, automatické nahrávání bez jakékoli akce uživatele (Chrome to neumožňuje).

Tento požadavek je pouze na plán. Nevydává oprávnění k migraci, nasazení Function nebo webu, vložení secrets, publikaci ve store ani push. Každý z těchto kroků má samostatnou výslovnou autorizaci.

## Capabilities

### New Capabilities

- `browser-extension-pairing`: Párování rozšíření s konkrétní instalací Vosia, scope `vosio:capture`, souhlas, platnost, obnova a odpojení včetně sekce v Nastavení.
- `browser-extension-capture-api`: Serverové capture rozhraní pro rozšíření – založení nahrávky, upload audia po částech, dokončení a spuštění přepisu bez otevřeného Vosia.
- `browser-extension-meeting-recording`: Chování rozšíření – hlídané weby, režimy, start/stop, nahrávání mikrofonu a schůzky, odeslání, obnova, informování uživatele.

### Modified Capabilities

Žádné. Projekt nemá základní OpenSpec specifikace; existující MCP chování (`team-mcp-connection` v běžící změně) se nemění kromě toho, že bridge nově přijímá třetí scope – to je popsáno jako nový požadavek v `browser-extension-pairing`.

## Impact

- **DB:** jedna dopředná migrace – check omezení scopes v `vosio_mcp_private.pending` a `vosio_mcp_private.grants` (živě ověřeno 06.11.2026: `pending_scopes_check`, `grants_scopes_check` vyžadují `vosio:read`).
- **Edge Function `vosio-mcp`:** scope plumbing, capture endpointy, dispatch přepisu; nový Function secret pro worker token a nasazení.
- **Web (Next.js):** souhlas pro capture scope, sekce v Nastavení, úzká worker route pro dispatch jedné operace, dokumentace a Novinky.
- **Nový adresář `extension/`** se zdrojem rozšíření, build skript a testy; žádná nová npm závislost není plánovaná.
- **Provoz:** vývojářské účty Chrome Web Store a Edge Partner Center (vlastník), zásady ochrany soukromí, review ve store (dny až týdny).
- Konkrétní soubory, kontrakty a pořadí jsou v `design.md` a `tasks.md`.
