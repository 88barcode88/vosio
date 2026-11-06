# Spec Delta

## Purpose

Popsat, jak rozšíření Vosio pro Chrome a Edge pozná online schůzku, podle nastavení spustí nahrávání mikrofonu i zvuku schůzky, na konci ho samo ukončí a spolehlivě odešle do Vosia k přepisu.

## ADDED Requirements

### Requirement: Hlídané weby
Rozšíření SHALL rozpoznávat schůzky na Google Meet (`meet.google.com/<kód>`), Microsoft Teams web (`teams.microsoft.com`, `teams.live.com`) a Zoom web klientovi (`app.zoom.us/wc/…`). Uživatel SHALL moci v nastavení přidat a odebrat vlastní weby; pro každý přidaný web MUST rozšíření získat oprávnění prohlížeče jen k tomuto webu.

#### Scenario: Přidání vlastního webu
- **WHEN** uživatel přidá `https://meet.firma.cz`
- **THEN** prohlížeč se zeptá na přístup k tomuto webu a po povolení rozšíření na něm hlídá schůzky

#### Scenario: Web bez oprávnění
- **WHEN** uživatel přístup k přidanému webu nepovolí
- **THEN** web se v seznamu zobrazí jako neaktivní s možností oprávnění udělit

### Requirement: Režimy spouštění
Nastavení SHALL nabídnout režimy Automaticky, Zeptat se a Vypnuto (výchozí Zeptat se). Na rozpoznané schůzce rozšíření SHALL změnit ikonu, aby bylo vidět, že nahrávání je připravené. Nahrávání zvuku schůzky MUST začít až po aktivaci rozšíření uživatelem na kartě schůzky (kliknutí na ikonu nebo klávesová zkratka).

#### Scenario: Režim Automaticky
- **WHEN** je režim Automaticky a uživatel na kartě rozpoznané schůzky klikne na ikonu nebo stiskne zkratku
- **THEN** nahrávání mikrofonu i schůzky začne okamžitě bez dalšího dialogu

#### Scenario: Režim Zeptat se
- **WHEN** je režim Zeptat se a uživatel na kartě schůzky klikne na ikonu
- **THEN** otevře se okno rozšíření s potvrzením „Nahrát tuto schůzku?“ a nahrávání začne až po potvrzení

#### Scenario: Režim Vypnuto
- **WHEN** je režim Vypnuto
- **THEN** rozšíření schůzky nehlídá ani neoznačuje; ruční start z okna rozšíření na aktuální kartě zůstává dostupný

#### Scenario: Nespárované rozšíření
- **WHEN** uživatel spustí nahrávání a rozšíření není spárované nebo spárování vypršelo
- **THEN** nahrávání se nespustí a rozšíření nabídne spárování

### Requirement: Co se nahrává
Nahrávka SHALL obsahovat zvuk karty schůzky smíchaný s mikrofonem uživatele v kvalitě podle nastavení Vosia. Uživatel MUST během nahrávání dál slyšet schůzku. Mikrofon MUST být povolen jednorázově na stránce rozšíření; bez povolení rozšíření nahraje jen zvuk schůzky a jasně na to upozorní.

#### Scenario: Mikrofon nepovolen
- **WHEN** uživatel mikrofon rozšíření nepovolil
- **THEN** rozšíření nabídne stránku pro povolení a do té doby nahrává jen zvuk schůzky s viditelným upozorněním

#### Scenario: Zvuk schůzky během nahrávání
- **WHEN** nahrávání běží
- **THEN** uživatel slyší účastníky stejně jako bez nahrávání

### Requirement: Viditelný stav nahrávání
Během nahrávání SHALL ikona rozšíření ukazovat, že se nahrává, a okno rozšíření MUST zobrazit délku nahrávky, název schůzky a tlačítko Zastavit. Před prvním nahráváním MUST rozšíření zobrazit upozornění, co a kam nahrává, a připomenout informování účastníků; nahrávání MUST NOT začít před jeho potvrzením.

#### Scenario: První spuštění
- **WHEN** uživatel poprvé spustí nahrávání
- **THEN** zobrazí se upozornění o nahrávání osobní komunikace a odeslání do jeho Vosia a nahrávání začne až po potvrzení

#### Scenario: Ruční zastavení
- **WHEN** uživatel zvolí Zastavit
- **THEN** nahrávání skončí a začne odesílání do Vosia

### Requirement: Automatický konec
Rozšíření SHALL nahrávání samo ukončit a odeslat, když uživatel opustí schůzku, zavře kartu schůzky, karta odejde z adresy schůzky, nebo prohlížeč ukončí zachytávání karty. Na vlastních webech, kde nelze odchod ze schůzky rozpoznat, MUST platit zavření karty, odchod z webu a ruční stop.

#### Scenario: Opuštění Google Meet
- **WHEN** uživatel klikne v Meetu na opuštění hovoru
- **THEN** nahrávání skončí do několika sekund a začne odesílání

#### Scenario: Zavření karty
- **WHEN** uživatel zavře kartu se schůzkou
- **THEN** nahrávání skončí a odešle se vše nahrané do té chvíle

### Requirement: Spolehlivé uložení a odeslání
Rozšíření SHALL audio průběžně ukládat lokálně, aby pád karty, rozšíření nebo prohlížeče nezpůsobil ztrátu více než několika posledních sekund. Po skončení SHALL odeslat všechny části do Vosia a spustit přepis; při výpadku sítě nebo vypršeném spárování MUST odeslání opakovat později. Lokální data MUST smazat až po potvrzeném dokončení.

#### Scenario: Výpadek sítě po schůzce
- **WHEN** po skončení schůzky není připojení
- **THEN** rozšíření ukáže „Čeká na odeslání“ a odešle nahrávku, jakmile je připojení zpět

#### Scenario: Pád prohlížeče během schůzky
- **WHEN** prohlížeč spadne uprostřed nahrávání a uživatel ho znovu otevře
- **THEN** rozšíření najde nedokončenou nahrávku, nabídne její odeslání a odešle vše uložené do pádu

#### Scenario: Úspěšné odeslání
- **WHEN** Vosio potvrdí dokončení a spuštění přepisu
- **THEN** rozšíření zobrazí „Uloženo ve Vosiu“ s odkazem na detail nahrávky a smaže lokální kopii

#### Scenario: Dlouhá schůzka
- **WHEN** schůzka trvá déle, než se vejde do limitu jednoho souboru
- **THEN** rozšíření nahrávku rozdělí na více částí a Vosio z nich vytvoří jeden přepis

### Requirement: Jedna nahrávka současně
Rozšíření SHALL v jednu chvíli nahrávat nejvýše jednu schůzku. Pokus o start na jiné kartě během nahrávání MUST nabídnout ukončení stávající nahrávky.

#### Scenario: Druhá schůzka
- **WHEN** nahrávání běží a uživatel aktivuje rozšíření na jiné schůzce
- **THEN** rozšíření se zeptá, zda ukončit stávající nahrávku, a novou spustí až po jejím zastavení
