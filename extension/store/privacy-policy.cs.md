# Zásady ochrany soukromí – rozšíření Vosio pro prohlížeč

> Koncept. Doplní a na veřejné URL zveřejní provozovatel rozšíření (správce: [DOPLNIT jméno/firma a kontakt]). Platnost od: [DOPLNIT DD.MM.YYYY].

## Co rozšíření dělá

Rozšíření Vosio nahrává zvuk online schůzky v aktuální kartě prohlížeče a zvuk vašeho mikrofonu a odesílá nahrávku do **vaší vlastní instalace Vosia** k přepisu. Nahrávání začne jen vaší akcí (kliknutí na ikonu, klávesová zkratka, tlačítko v okně rozšíření).

## Jaká data zpracovává

- **Zvuk schůzky a mikrofonu** – po dobu nahrávání se průběžně ukládá do úložiště prohlížeče na vašem počítači (IndexedDB). Po potvrzeném odeslání do Vosia se lokální kopie smaže. Neodeslané nahrávky můžete kdykoli stáhnout nebo smazat v okně rozšíření.
- **Údaje o spárování** – adresa vašeho Vosia, e-mail vašeho účtu a OAuth tokeny (úzké oprávnění `vosio:capture`: zakládat nové nahrávky, nahrávat audio, spouštět přepis; nelze číst existující nahrávky). Ukládají se jen lokálně v prohlížeči. Heslo rozšíření nikdy nevidí – přihlášení probíhá na stránce vašeho Vosia.
- **Nastavení** – režim, vlastní weby, adresa Vosia; ukládá se do synchronizovaného úložiště prohlížeče (podle vašeho nastavení synchronizace).
- **URL a titulek aktivní karty** – čtou se lokálně jen k rozpoznání schůzky a k pojmenování nahrávky; mimo název nahrávky se neodesílají.

## Komu se data odesílají

Pouze do instalace Vosia, kterou jste sami spárovali (její web a její úložiště). Provozovatel rozšíření žádná vaše data neobdrží, nepoužívá analytiku ani reklamy a data neprodává ani nepředává třetím stranám. Zpracování nahrávek a přepisů ve vašem Vosiu se řídí vaším nastavením a poskytovatelem přepisu, kterého ve Vosiu používáte (správcem těchto dat jste vy).

## Nahrávání osobní komunikace – vaše odpovědnost

Zvuk schůzky může obsahovat osobní údaje dalších osob. Před nahráváním informujte účastníky a zajistěte právní základ (např. souhlas). Rozšíření vás na to před první nahrávkou upozorní.

## Vaše možnosti

- Spárování kdykoli odpojíte v nastavení rozšíření nebo ve Vosiu (Nastavení → Připojené aplikace). Přístup se okamžitě zneplatní.
- Odinstalováním rozšíření se smažou všechna lokální data rozšíření.
- Spárování platí nejvýše 30 dní, poté se musíte přihlásit znovu.

## Kontakt

[DOPLNIT kontakt správce]
