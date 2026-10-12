# Univerzální plugin Vosio

- Jeden veřejně distribuovatelný balíček pro nezávislé instalace. Žádná zabudovaná instalace autora, privátní Git repo, tajné klíče ani data.
- Uživatel při nastavení zvolí vlastní HTTPS web Vosia, poté se osobně přihlásí přes OAuth. Serverové Supabase a provider klíče do klienta nepatří.
- Vzdálené připojení a tokeny spravuje nativní Codex. Plugin nemá lokální server ani vlastní úložiště přihlašovacích údajů.
- Každá MCP resource má vlastní entry; nastavení jiné instalace nepřepisuje starou. Při více připojeních musí být vybraná zamýšlená instalace. Současný soukromý plugin zůstává zachovaný.
- Nástroje čtou pouze dostupné nahrávky/přepisy/uložené výstupy/úkoly. Editace názvu, mluvčího a stavu úkolu vyžaduje výslovný požadavek a aktuální serverová oprávnění. Placené AI, mazání, přístupy a obecné SQL jsou mimo rozsah.
- Veřejná distribuce probíhá přes repo marketplace. Přijetí do univerzálního katalogu OpenAI je samostatný proces.
- Veřejná aplikace obsahuje potřebný MCP server, OAuth bridge, oprávnění a migrace spolu se zbytkem aktuální aplikace. Správce vlastní instalace je nasadí a nastaví; bez této konfigurace není její MCP aktivní. Zveřejnění zdrojů nezřizuje cizí infrastrukturu ani nepřenáší účty nebo klíče autora.

Akceptace: dvě vlastní webové adresy musí vyprodukovat dvě odlišné MCP entries bez sdílení tokenů; neplatná nebo vypnutá instalace nesmí vést k fallbacku; balíček nesmí obsahovat konkrétní instalaci autora; vlastní osobní přihlášení a autorizované čtení se ověří odděleně od instalace pluginu.
