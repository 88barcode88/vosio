# UI Workspace Direction

## Rozhodnutí

Vosio se designově vede jako kompaktní pracovní audio workspace ve stylu moderního CRM, Linear a Notion.

Hlavní objekt aplikace je nahrávka. Přepis, AI zpracování, časová osa a soubory se řeší v kontextu konkrétní nahrávky.

## Důvody

- Uživatel potřebuje rychle zapnout live nahrávání nebo vložit existující soubor.
- Po uložení potřebuje rychle pracovat s konkrétní nahrávkou.
- Samostatný globální AI panel není hlavní workflow; AI zpracování má větší hodnotu uvnitř detailu nahrávky.
- Technická časová osa po segmentech není pro běžné použití dost užitečná; cílově má jít o AI kapitoly hovoru.
- Aplikace má být používaná opakovaně, takže potřebuje kompaktní pracovní hustotu místo velkých prezentačních karet.

## Dopady

- Sidebar zůstává čistý: nová nahrávka, nahrávky, prompty, koš a nastavení.
- `/recordings/new` bude capture plocha se dvěma akčními kartami: live nahrávání a upload souboru.
- `/recordings/[recordingId]` bude hlavní pracovní plocha s kompaktním headerem a taby.
- `AI zpracování` se přesune do detailu nahrávky jako tab.
- `Časová osa` se bude cílově generovat přes AI jako obsahové kapitoly.
- Dark i light mode musí být plnohodnotné režimy.

## Navazující dokumenty

- `DESIGN.md`
- `docs/requirements/ui-direction.md`
