# Spec Delta

## Purpose

Bezpečně spárovat rozšíření prohlížeče Vosio s konkrétní self-hostovanou instalací Vosia uživatele tak, aby rozšíření získalo jen úzké oprávnění k nahrávání a uživatel ho mohl kdykoli odpojit.

## ADDED Requirements

### Requirement: Párování s vlastní instalací
Rozšíření SHALL umožnit zadat adresu webu Vosia a z ní automaticky zjistit OAuth metadata, registrovat se jako veřejný klient a zahájit přihlášení. Rozšíření MUST NOT vyžadovat client ID, secret, callback ani Supabase klíče od uživatele a MUST NOT obsahovat adresu žádné konkrétní instalace.

#### Scenario: První spárování
- **WHEN** uživatel v rozšíření zadá `https://vosio.firma.cz` a zvolí Spárovat
- **THEN** rozšíření požádá prohlížeč o přístup jen k originům této instalace (web a jeho Supabase), načte metadata, zaregistruje klienta a otevře přihlašovací okno Vosia

#### Scenario: Adresa není Vosio nebo je nedostupná
- **WHEN** zadaná adresa nevrací platná OAuth metadata Vosia, používá jiný protokol než HTTPS, nebo instalace má MCP/OAuth bridge vypnutý
- **THEN** rozšíření zobrazí srozumitelnou chybu a nic neuloží

#### Scenario: Uživatel odmítne oprávnění prohlížeče
- **WHEN** uživatel v dialogu prohlížeče nepovolí přístup k originům instalace
- **THEN** párování se nezahájí a rozšíření vysvětlí, proč je přístup potřeba

### Requirement: Přihlášení výhradně na stránce Vosia
Přihlášení a souhlas SHALL proběhnout na stránkách instalace Vosia v okně prohlížeče otevřeném rozšířením, s autorizačním kódem a PKCE S256. Rozšíření MUST NOT vidět heslo ani přihlašovací cookie uživatele.

#### Scenario: Úspěšné přihlášení a souhlas
- **WHEN** uživatel se v okně přihlásí svým účtem a potvrdí souhlas
- **THEN** okno se zavře, rozšíření vymění kód za tokeny a zobrazí „Spárováno s vosio.firma.cz jako <e-mail>“

#### Scenario: Zrušené okno nebo odmítnutý souhlas
- **WHEN** uživatel okno zavře, souhlas odmítne, nebo server vrátí chybu místo návratu
- **THEN** rozšíření zůstane nespárované, neuloží žádný token a nabídne zkusit znovu; okno nikdy nezůstane viset bez možnosti zavření

### Requirement: Úzký scope vosio:capture
Bridge SHALL podporovat scope `vosio:capture` jako samostatnou sadu, kterou nelze kombinovat s `vosio:read` ani `vosio:write`. Token s `vosio:capture` MUST být přijat pouze capture rozhraním a MUST být odmítnut MCP nástroji a čtením audia. Tokeny `vosio:read`/`vosio:write` MUST být capture rozhraním odmítnuty.

#### Scenario: Capture token na MCP
- **WHEN** klient zavolá MCP endpoint nebo čtení audia s tokenem `vosio:capture`
- **THEN** požadavek je odmítnut jako nedostatečný scope a žádná data se nevrátí

#### Scenario: MCP token na capture rozhraní
- **WHEN** klient zavolá capture endpoint s tokenem `vosio:read` nebo `vosio:write`
- **THEN** požadavek je odmítnut a nevznikne žádná nahrávka

#### Scenario: Smíšená sada scopes
- **WHEN** klient požádá o `vosio:capture vosio:read`
- **THEN** autorizace je odmítnuta, nevznikne grant a rozšíření zobrazí chybu místo nekonečného čekání

#### Scenario: Capture s jinou návratovou adresou
- **WHEN** klient požádá o `vosio:capture` s návratovou adresou, která není `https://<32 písmen a–p>.chromiumapp.org/…`
- **THEN** registrace nebo autorizace je odmítnuta a souhlas se nezobrazí

#### Scenario: Stávající MCP připojení
- **WHEN** existující Codex nebo Claude Code klient používá `vosio:read`/`vosio:write`
- **THEN** chování MCP, 11 nástrojů, refresh a odvolání zůstávají beze změny

### Requirement: Souhlas popisuje oprávnění rozšíření
Stránka souhlasu SHALL pro `vosio:capture` zobrazit, že jde o rozšíření prohlížeče, které smí pouze zakládat nové nahrávky uživatele, nahrávat do nich audio a spouštět jejich přepis, a že nesmí číst existující nahrávky. Zobrazený identifikátor MUST pocházet z ověřené návratové adresy, ne jen z názvu, který klient sám uvedl.

#### Scenario: Souhlas pro rozšíření
- **WHEN** přihlášený uživatel otevře souhlas pro žádost se scopem `vosio:capture`
- **THEN** vidí popis úzkého oprávnění a identifikátor rozšíření z návratové adresy a nemá volbu čtení/úprav

### Requirement: Platnost a obnova spárování
Spárování SHALL platit nejvýše 30 dní od souhlasu, krátkodobý přístupový token se SHALL obnovovat rotací refresh tokenu. Po vypršení, odvolání nebo neplatné obnově MUST rozšíření přejít do stavu „Je potřeba znovu spárovat“ a MUST NOT ztratit lokálně uložené neodeslané nahrávky.

#### Scenario: Vypršení po 30 dnech
- **WHEN** uplyne 30 dní od souhlasu
- **THEN** rozšíření při další akci zobrazí „Spárování vypršelo – přihlaste se znovu“ a po novém přihlášení odešle čekající nahrávky

#### Scenario: Nové spárování uprostřed odesílání
- **WHEN** spárování zanikne (vypršení, ztracená odpověď obnovy, odpojení) během odesílání nahrávky a uživatel se znovu spáruje stejným rozšířením a účtem
- **THEN** rozšíření pokračuje v odesílání do téže nahrávky ve Vosiu a nevznikne duplikát

#### Scenario: Krátkodobé 401
- **WHEN** capture požadavek vrátí 401
- **THEN** rozšíření se nejdřív jednou pokusí o obnovu tokenu a teprve při jejím selhání zobrazí „Je potřeba znovu spárovat“

#### Scenario: Souběžná obnova tokenu
- **WHEN** dvě části rozšíření potřebují obnovit token současně
- **THEN** proběhne nejvýše jedna obnova a obě použijí nový token; opakované použití starého refresh tokenu nenastane

### Requirement: Přehled a odpojení v Nastavení Vosia
Nastavení Vosia SHALL obsahovat sekci s aktivními připojeními uživatele (rozšíření i MCP klienti) s typem oprávnění, datem spárování a akcí Odpojit. Odpojení MUST okamžitě zneplatnit grant a tokeny daného připojení; další požadavek rozšíření MUST selhat.

#### Scenario: Odpojení rozšíření
- **WHEN** uživatel v Nastavení u rozšíření zvolí Odpojit a potvrdí
- **THEN** připojení zmizí ze seznamu a další capture požadavek rozšíření je odmítnut; rozšíření zobrazí „Odpojeno ve Vosiu“

#### Scenario: Žádná připojení
- **WHEN** uživatel nemá žádné aktivní připojení
- **THEN** sekce zobrazí prázdný stav s odkazem na návod k instalaci rozšíření

#### Scenario: Cizí připojení
- **WHEN** uživatel zobrazí sekci
- **THEN** vidí pouze vlastní připojení a nemůže odpojit připojení jiného uživatele

### Requirement: Odpojení v rozšíření
Rozšíření SHALL nabídnout akci Odpojit, která odvolá token na serveru a smaže lokální tokeny. Neodeslané nahrávky MUST zůstat zachované, dokud je uživatel výslovně nesmaže.

#### Scenario: Odpojení s čekající nahrávkou
- **WHEN** uživatel odpojí rozšíření a existuje neodeslaná nahrávka
- **THEN** rozšíření ho upozorní, tokeny smaže a nahrávku ponechá k odeslání po novém spárování nebo ke stažení
