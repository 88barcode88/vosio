# Veřejný Vosio plugin

Plugin `vosio@vosio-community` je společný balíček skills pro Codex. Marketplace v `.agents/plugins/marketplace.json` odkazuje na `plugins/vosio`. Verze pluginu je samostatná od verze webové aplikace. Portable manifest i Codex compatibility manifest jsou součástí téhož balíčku.

Balíček neobsahuje MCP URL, přihlašovací údaje, osobní data ani reference na privátní repozitář. Onboarding skill `setup` vyžádá uživatelem zvolený HTTPS webový origin. Pomocný Node skript `plugins/vosio/scripts/discover.mjs` načte bez cookies a bez přesměrování nejvýše 16 kB veřejné OAuth konfigurace; vyžaduje přesný issuer/authorize endpoint zvoleného originu, canonical HTTPS Function token endpoint, automatickou registraci, revoke a S256. Při chybě nemění konfiguraci a nesubstituuje jinou instalaci.

Průvodce používá `codex mcp add --url` a osobní OAuth uložené nativním klientem. Nedělá lokální MCP ani proxy a neukládá tokeny do balíčku. Při podpoře lokálním Node používá `--use-system-ca` pro systémové CA bez vypnutí TLS ověření. Deterministický název `vosio-<SHA-256 prefix endpointu>` drží různé resource URL v samostatných entries. Existující entry lze pouze znovu použít po ověření shodného transportu a URL. Přepsání nebo odebrání musí být samostatný požadavek uživatele. Skills musí určit konkrétní instalaci před každým úkolem a nesmějí zdrojovému textu dovolit přepnout server.

## Serverová hranice

Instalace musí samostatně provozovat kompatibilní vzdálený Vosio MCP. Veřejná aplikace nyní obsahuje server, OAuth bridge, webové consent/discovery stránky a celý migrační řetězec. Správce své instalace je nasadí a nakonfiguruje podle [českého návodu](../../plugins/vosio/SETUP.md). Publikace zdrojů nebo instalace balíčku sama nevytváří Supabase projekt, klienta ani přihlašovací údaje a MCP zůstává do výslovné aktivace vypnuté.

Připojení potřebuje osobní účet a consent; právo na konkrétní nahrávku určuje server. Běžný klient nedostává Supabase service role, serverový confidential client secret, šifrovací klíč ani provider klíče. Nastavení pluginu nevykonává migrace ani konfiguraci infrastruktury. Zobrazení URL, uložení konfigurace, dokončení OAuth a funkční autorizovaný nástroj jsou oddělené důkazy.

Odinstalování skills pluginu nemění nativní MCP entries. Backend grant se odvolává na `/mcp/connections` příslušné instalace; místní logout/remove pouze uklidí konkrétní klientské připojení.

Ověření: unit testy skutečného discovery skriptu se dvěma nezávislými instalacemi, chybnými metadata/URL, 404 a příliš velkou odpovědí; izolovaná lokální instalace pluginu v Codex CLI. Skutečné osobní OAuth a druhý účet potřebují samostatnou klientskou akceptaci.

Nativní konfigurace a OAuth: [Codex MCP](https://developers.openai.com/codex/mcp). Formát balíčku, marketplace a onboarding: [Package your plugin](https://developers.openai.com/plugins/build/plugins).
