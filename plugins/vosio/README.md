# Vosio plugin pro Codex

Jeden společný plugin pro vlastní instalace Vosia. Balíček nemá přednastavenou adresu, účet ani přístup k žádné instalaci. Připojení k vašemu vzdálenému MCP spravuje přímo Codex.

## Instalace

V PowerShellu s nainstalovaným Codex CLI:

```powershell
codex.cmd plugin marketplace add 88barcode88/vosio --ref plugin-v0.2.0 --sparse .agents/plugins --sparse plugins/vosio
codex.cmd plugin add vosio@vosio-community
```

Příkaz stáhne pouze marketplace a plugin; zdroj celé aplikace nepotřebujete. Tag `plugin-v0.2.0` zajišťuje konkrétní verzi balíčku. Znovu otevřete Codex. V detailu veřejného pluginu **Vosio** spusťte nastavení; případně v novém chatu vyvolejte jeho skill `setup` a napište „Připoj moje Vosio na https://vase-vosio.example“. Adresu příkladu nahraďte vlastní adresou.

Průvodce potřebuje Node.js 22 nebo novější. Z adresy vašeho webu načte veřejnou OAuth konfiguraci, zjistí vzdálený MCP endpoint a přidá ho do nativního nastavení Codexu pod názvem `vosio-<identifikátor>`. Potom se v prohlížeči přihlásíte svým účtem Vosio a potvrdíte přístup. Nezadáváte Supabase ani Soniox klíče. Každý endpoint má samostatné připojení; existující připojení se nepřepisují.

Například: „Najdi nahrávky z minulého týdne a shrň jejich uložené úkoly.“ Plugin pomáhá hledat přepisy a uložené AI výstupy a na výslovný požadavek upravovat názvy, mluvčí a stav úkolů. Přístup určuje váš účet a aktuální oprávnění serveru. Pokud máte více instalací, upřesněte, kterou chcete použít.

## Co musí být připravené na serveru

Vaše instalace musí mít nasazené a zapnuté Vosio MCP s osobním OAuth, automatickou registrací a discovery na `/.well-known/oauth-authorization-server`. Běžné přihlášení do webu samo o sobě nestačí. V této veřejné větvi zatím není obsažen server Vosio MCP; samotné naklonování aplikace ani instalace pluginu ho nezprovozní. Plugin lze použít s již připravenou kompatibilní instalací. [Podrobnosti a stav](https://github.com/88barcode88/vosio/blob/plugin-v0.2.0/docs/api/vosio-plugin.md).

## Odpojení a aktualizace

Přístup odvolejte na `/mcp/connections` svého Vosia. Odinstalování tohoto pluginu samo neodvolá serverový přístup ani nesmaže nativní MCP připojení v Codexu. Pro přesné připojení lze použít `codex.cmd mcp logout <nazev>` a `codex.cmd mcp remove <nazev>`.

```powershell
codex.cmd plugin marketplace upgrade vosio-community
```

Marketplace je připnutý k uvedené verzi. Pro novější vydání ho přidejte znovu s jeho novým tagem; upgrade obnovuje zvolený ref. Aktualizace veřejného balíčku nemění zvolenou instalaci ani její osobní přihlášení. Veřejná dostupnost balíčku na GitHubu neznamená publikaci do univerzálního katalogu OpenAI.
