# Návrhy Týmu Vosio

Stav: SELECTED_A. Uživatel vybral "A – seznam vlevo, detail vpravo" a potvrdil oddělenou roli správce instalace i zakladatele projektu. Tyto tři samostatné lokální návrhy zachovávají podklad výběru; implementované UI je v `src/components/team-manager.tsx`. Autoritativní dokument zůstává `../../DESIGN.md`; zde nevzniká další designový systém. Náhled není potvrzením dostupné backendové capability. Nejnovější pravidlo má přednost před původní obecnou demo formulací: klient/složka vždy vynechá všechny soukromé nahrávky.

Otevřete `a.html`, `b.html` nebo `c.html` přímo v prohlížeči. Sdílejí lokální CSS, JS a kopii existujícího loga; nevyžadují síť, přihlášení ani instalaci. Všechny osoby, e-maily a názvy jsou demo, e-maily používají rezervovanou doménu `.test`. Žádná akce neposílá pozvánku ani nemění přístup.

| Varianta | Uspořádání a výhoda | Kompromis |
| --- | --- | --- |
| A | Seznam vlevo a detail vybrané osoby vpravo. Rychlé přepínání mezi lidmi při správě oprávnění. | Na středně široké obrazovce se skládá do jednoho sloupce. |
| B | Celoplošné pracovní řádky a detail pod seznamem. Nejbližší stávajícímu kompaktnímu inboxu. | Při delším seznamu bude detail níže; produkční varianta by měla udržet orientaci na vybrané osobě. |
| C | Výběr lidí v horním pásu a pod ním široký přehled přístupů s odděleným sloupcem typu rozsahu. | Méně hustý seznam lidí; pro větší tým vyžaduje stránkování nebo hledání. |

Všechny varianty používají stejná data a pravidla: aktivní přístupy oddělené od čekající pozvánky; nahrávka/projekt/klient/složka; klient a složka zahrnují současné i budoucí nahrávky; odebrání přímého grantu nepopírá zbývající cestu přes projekt. Zakladatel projektu vidí pouze jeho spravovaný rozsah; náhled klientských/složkových grantů ve správci instalace nepředjímá dosud řešený datový kontrakt. Vlastní seznam není globální adresář a správa týmu sama nedává přístup k cizímu obsahu.

Mobil do 900 px má pět cílů Nahrávky / Nová / AI prompty / Nastavení / Více. Tým je v dialogu Více. Seznam → detail osoby → Zpět; bez přidání šestého cíle. Všechny interaktivní cíle mají v CSS minimálně 44 px, nativní dialog používá fokus a Escape, běžné názvy i e-maily se zalamují. Font Inter má místní fallback Segoe UI; nestahuje se externí font. Barevné tokeny jsou přeneseny z DESIGN.md, typografie je schválená pracovní velikost, nikoli nový branding.

## Ovládání ukázky

- A/B/C přepínají návrh.
- Motiv přepíná skutečné light/dark tokeny.
- Rozsah přepíná ukázku zakladatele projektu a diskutovaného správce instalace.
- Hledání a výběr člověka mění náhled detailu.
- Pozvat člověka, Přidělit přístup, Odebrat a Detail čekající pozvánky otevírají lokální dialogy.
- Typ klient/složka v editoru ukazuje účinek na současné i budoucí nahrávky před potvrzením.
- Ukázkový stav přepíná načteno / načítání / prázdný seznam / chybu. Při skutečné implementaci by se všechny změny potvrzovaly serverem.

## Podklady

Čteny: DESIGN.md, docs/requirements/ui-direction.md, OpenSpec proposal/design/tasks, specs/team-access-management/spec.md, references/request.md a projektové instrukce. Použity skills frontend-design-direction, ui-ux-pro-max; pro statický kontrolní průchod web-design-guidelines.

Veřejné reference ověřeny přes getdesign.md:

- https://getdesign.md/design-md/linear.app/preview — jemné oddělovače a vrstvení tmavých pracovních ploch; bez lavender brandingu a velké typografie.
- https://getdesign.md/design-md/cal/preview — neutrální primární akce a klidné formuláře; bez marketingové kompozice a vlastního fontu.
- https://getdesign.md/design-md/notion/preview — hierarchie a tichá pracovní plocha; bez teplé palety a sticker grafiky.

Lokální helper `ui-ux-pro-max/scripts/search.py` byl spuštěn pro design systém, keyboard focus modal a Next.js formuláře. Generický výsledek design-system nabízel marketingové a barevné vzory, proto byl odmítnut ve prospěch DESIGN.md. Použita jen relevantní doporučení k focusu, 44px cílům, semantickým formulářům a responsivitě. Žádný MASTER.md ani závislost nevznikly.

## Ověření a limity

Produktové UI vybrané varianty A má samostatné inertní snímky v `implemented/{desktop,mobile}-{dark,light}.png`. Pocházejí z green desktop/mobile Team E2E, používají výslovně demo data a nejsou uživatelskou akceptací ani potvrzením nasazení. Následné opravy identity při souběžné obnově nemění zachycené běžné rozložení. Níže je zachované ověření původních tří návrhů.

- `node --check artifacts/team-design/preview.js`: kontrola syntaxe.
- Skutečný render přes instalovaný Playwright Chromium s explicitní hostitelskou cestou a file:/// prošel. Snímky: `a-desktop-dark.png`, `b-desktop-dark.png`, `c-desktop-dark.png` (1440 px), `a-mobile-light.png` a `a-mobile-detail-light.png` (390 px). Vizuálně prohlédnuty A/B/C desktop a mobilní detail A. Změřený vodorovný přesah: žádný při 1440 ani 390 px. Přepnutí tématu a výběr osoby fungovaly. Nejde o browser QA produktové implementace ani plný accessibility audit. Klávesnicový průchod a kontrast všech stavů nejsou ověřeny. Předchozí localhost timeout pocházel ze sandboxové síťové hranice, nikoli z návrhu.
- Před výběrem je nutné návrhy skutečně zobrazit; samotné HTML ani tento text nesplňují vizuální akceptaci. Rozšířené edge stavy (server error po mutaci, reload a zrušená role) budou součástí produktové implementace, nikoli tohoto lokálního dema.
- Neprovedeno: push, deploy, DB změny, produktový runtime, odesílání, úprava autoritativního DESIGN.md nebo výběr za uživatele.
