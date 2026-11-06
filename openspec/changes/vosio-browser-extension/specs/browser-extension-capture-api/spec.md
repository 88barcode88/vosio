# Spec Delta

## Purpose

Dát spárovanému rozšíření úzké serverové rozhraní, přes které založí vlastní nahrávku, nahraje audio po částech a spustí přepis bez otevřeného Vosia, se stejnými pravidly vlastnictví, limitů a přepisu jako nahrávání ve Vosiu.

## ADDED Requirements

### Requirement: Autentizace capture požadavků
Každý capture požadavek SHALL nést `Authorization: Bearer` s platným tokenem `vosio:capture` a hlavičku `Origin` rovnou `chrome-extension://<id>`, kde `<id>` odpovídá návratové adrese `https://<id>.chromiumapp.org/` uložené u grantu. Server MUST při každém požadavku ověřit aktivní grant a živou session uživatele; cookies se nepoužívají.

#### Scenario: Platný požadavek rozšíření
- **WHEN** rozšíření, jehož ID odpovídá grantu, pošle požadavek s platným tokenem
- **THEN** server operaci provede jménem uživatele grantu s jeho aktuálními oprávněními

#### Scenario: Token použitý z jiného původu
- **WHEN** požadavek s platným capture tokenem přijde z prohlížeče s `Origin` webové stránky nebo jiného rozšíření
- **THEN** server požadavek odmítne a nic nezmění

#### Scenario: Odvolaný nebo prošlý token
- **WHEN** grant byl odvolán, vypršel nebo upstream session uživatele zanikla
- **THEN** server vrátí 401 a rozšíření může rozlišit „je potřeba znovu spárovat“

### Requirement: Konfigurace pro nahrávání
Capture rozhraní SHALL vrátit nastavení potřebná pro nahrávání: cílový bitrate podle `liveAudioQuality`, maximální velikost jedné části podle aktuálního limitu úložiště a povolené typy audia. Při nedostupném limitu MUST rozhraní vrátit chybu místo neomezené hodnoty.

#### Scenario: Načtení konfigurace
- **WHEN** rozšíření před nahráváním požádá o konfiguraci
- **THEN** obdrží bitrate, limit velikosti části a povolené MIME typy své instalace

### Requirement: Založení nahrávky
Capture rozhraní SHALL založit novou soukromou nahrávku uživatele bez projektu. Název MUST dodat rozšíření (platforma a místní čas začátku schůzky) a uložit ho spolu s `requestId`, aby opakování bylo shodné. Založení MUST být idempotentní podle `requestId`.

#### Scenario: Opakované založení po výpadku sítě
- **WHEN** rozšíření pošle stejný `requestId` a název dvakrát
- **THEN** existuje jediná nahrávka a obě odpovědi vrátí totéž ID

#### Scenario: Název v místním čase
- **WHEN** schůzka v Praze začala ve 14:00 místního času
- **THEN** název nahrávky obsahuje 14:00, ne čas v UTC

### Requirement: Upload audia po částech
Rozhraní SHALL nejdřív zaregistrovat všechny části nahrávky (pořadí 0–999, přesný MIME `audio/webm`, přesná velikost do limitu) a pro každou vydat krátkodobé oprávnění k nahrání právě tohoto objektu na veřejné adrese Supabase instalace. Audio MUST NOT procházet přes webovou aplikaci ani přes tělo capture požadavku.

#### Scenario: Nahrání tří částí
- **WHEN** rozšíření zaregistruje části 0, 1 a 2 a nahraje je
- **THEN** v úložišti existují tři objekty pod složkou uživatele a nahrávky se zaregistrovaným MIME a velikostí

#### Scenario: Část přesahuje limit
- **WHEN** rozšíření ohlásí část větší než limit nebo nepovolený typ
- **THEN** registrace je odmítnuta s chybou, kterou rozšíření zobrazí uživateli

#### Scenario: Opakované nahrání téže části
- **WHEN** nahrání části selže a vydání nového oprávnění je odmítnuto, protože objekt už existuje
- **THEN** rozšíření pokračuje dokončením a o úplnosti rozhoduje kontrola manifestu při dokončení

### Requirement: Rozpracovaný upload není nabízen k obnově ve webu
Nahrávka, kterou rozšíření právě odesílá, MUST NOT být ve Vosiu nabízena k ruční obnově z neúplných částí. Po potvrzeném dokončení nebo trvalém selhání odesílání se chová jako každá jiná nahrávka.

#### Scenario: Otevřený panel obnovy během uploadu
- **WHEN** uživatel ve Vosiu otevře obnovu nahrávek, zatímco rozšíření odesílá části
- **THEN** tato nahrávka v nabídce obnovy není a upload rozšíření dokončí celou nahrávku

### Requirement: Dokončení a spuštění přepisu
Po nahrání všech částí SHALL rozhraní dokončit nahrávku stejným kontraktem jako segmentovaná nahrávka ve Vosiu (včetně délky nahrávky) a spustit asynchronní přepis se stejným modelem jako web, regionem `sonioxRegion` uživatele a stejným jazykovým nastavením jako ostatní asynchronní přepisy. Odeslání přepisu MUST začít bez otevřeného Vosia a bez dalšího požadavku rozšíření.

#### Scenario: Přepis po skončení schůzky
- **WHEN** rozšíření po skončení schůzky nahraje všechny části a ohlásí dokončení
- **THEN** ve Vosiu se objeví nahrávka se stavem přepisu „ve frontě“ a přepis je odeslán ke zpracování, aniž by uživatel Vosio otevřel; je-li instalace dostupná přes HTTPS s nastavenou veřejnou adresou, dokončí se přepis také bez otevřeného Vosia

#### Scenario: Instalace bez veřejné HTTPS adresy
- **WHEN** instalace nemá nastavenou veřejnou HTTPS adresu pro zpětné volání přepisu a přepis trvá déle než okno odeslání
- **THEN** přepis se dokončí stávajícím dohledáním při otevření nahrávky ve Vosiu a dokumentace tento rozdíl uvádí

#### Scenario: Dokončení s chybějící částí
- **WHEN** rozšíření ohlásí dokončení, ale některá zaregistrovaná část v úložišti chybí nebo nesedí velikost či MIME
- **THEN** dokončení je odmítnuto, přepis se nespustí a rozšíření může chybějící část nahrát znovu

#### Scenario: Opakované dokončení
- **WHEN** rozšíření dokončení zopakuje se stejným `requestId` (například po ztracené odpovědi)
- **THEN** vrátí se tentýž výsledek, nevznikne druhá operace přepisu ani druhý placený požadavek u Sonioxu

#### Scenario: Selhání odeslání přepisu
- **WHEN** serverové odeslání přepisu dočasně selže
- **THEN** nahrávka zůstane ve stavu, který Vosio umí dohledat stávající obnovou přepisu, a rozšíření hlásí úspěšné uložení audia

### Requirement: Rozsah capture oprávnění
Capture rozhraní MUST NOT umožnit čtení, výpis, změnu, sdílení ani mazání nahrávek. Smí pracovat pouze s nahrávkou, kterou založilo totéž rozšíření (ID návratové adresy) pro téhož uživatele, a jen v krocích založení, upload, dokončení a dotaz na stav.

#### Scenario: Pokus o cizí nahrávku
- **WHEN** rozšíření pošle ID nahrávky, kterou nezaložilo pro tohoto uživatele
- **THEN** server požadavek odmítne a neprozradí, zda nahrávka existuje

#### Scenario: Stav vlastní nahrávky
- **WHEN** rozšíření se zeptá na stav nahrávky, kterou samo založilo
- **THEN** dostane jen stav uploadu/přepisu a odkaz na detail ve Vosiu, bez obsahu přepisu

#### Scenario: Nahrávka smazaná ve Vosiu během uploadu
- **WHEN** uživatel nahrávku ve Vosiu přesune do koše dříve, než ji rozšíření dokončí
- **THEN** rozhraní další kroky odmítne a rozšíření přestane opakovat odesílání a nabídne lokální kopii ke stažení nebo smazání
