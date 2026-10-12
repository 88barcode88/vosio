# Vosio

Vosio je Next.js PWA pro nahrávání a upload audia, live i souborové přepisy přes Soniox, uložené AI výstupy, úkoly, chat nad přepisem a volitelné sdílení nahrávek s kolegy.

Toto je veřejný zdrojový repozitář aplikace. Aktuální aplikace `0.3.2` obsahuje celé produktové funkce aktuální vývojové verze, migrační řetězec, MCP server i univerzální plugin. Neobsahuje cizí účty, API klíče ani uživatelská data. Každá instalace používá vlastní Supabase, Soniox, web a případné AI poskytovatele.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2F88barcode88%2Fvosio&project-name=vosio&repository-name=vosio&env=NEXT_PUBLIC_SUPABASE_URL%2CNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY%2CNEXT_PUBLIC_APP_URL%2CSUPABASE_SERVICE_ROLE_KEY%2CSONIOX_API_KEY%2COPENAI_API_KEY&envDescription=Use%20your%20own%20Supabase%2C%20Soniox%20and%20AI%20accounts.&envLink=https%3A%2F%2Fgithub.com%2F88barcode88%2Fvosio%23nastaven%C3%AD)

## Co aplikace obsahuje

- Resumable upload do private Supabase Storage a živé nahrávání s průběžným ukládáním, obnovou a zachováním přepisu při výpadku.
- Live Soniox autentizaci při navázání WebSocketu; hlavní provider klíč zůstává na serveru.
- Vyhledávání nahrávek a přepisů, mluvčí, markery, organizaci, přehrávání a Koš.
- Osobní používání bez týmu a volitelné projektové/individuální sdílení s rolemi, pozvánkami a aktuálními serverovými oprávněními.
- Durable souborové přepisy a recovery původní operace; nejasný provider request se automaticky neopakuje.
- Uložené AI výstupy, checklist, časovou osu, model/reasoning picker a chat nad přepisem; OpenAI, volitelně Gemini a Mistral.
- Vzdálený Vosio MCP přes Supabase Edge Function, osobní OAuth/PKCE, automatickou registraci Codex/Claude a odvolání přístupu.
- Jeden společný Codex plugin: při nastavení si každý vybere vlastní instalaci. Serverová URL autora ani jeho klíče v balíčku nejsou.

## Nastavení

Potřebujete Node.js 22+, npm a vlastní Supabase/Soniox účty. Pro MCP navíc Deno, Supabase CLI a kompatibilní Supabase OAuth server.

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
```

Vyplňte `.env.local` nebo prostředí svého deploymentu:

| Proměnná | Použití |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Veřejná URL vašeho Supabase projektu. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe publishable klíč vašeho projektu. |
| `NEXT_PUBLIC_APP_URL` | Kanonický HTTPS origin vašeho webu pro callbacky; například `https://vosio.example`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Privilegovaný klíč pouze na serveru. |
| `SONIOX_API_KEY` | Serverový Soniox klíč; region se vybírá v nastavení uživatele. |
| `OPENAI_API_KEY` | Výchozí AI poskytovatel. |
| `GEMINI_API_KEY`, `MISTRAL_API_KEY` | Volitelné; pokud tyto poskytovatele používáte. |
| `RECORDING_TRANSCRIPTION_WORKER_TOKEN` | Volitelný serverový Bearer secret pro vlastní externí transcription scheduler. |

MCP secrets `MCP_TOKEN_ENCRYPTION_KEY` a `MCP_SUPABASE_CLIENT_SECRET` patří pouze do **Supabase Edge Functions → Secrets**, ne do webu nebo Codexu. Žádné tajné hodnoty necommitujte. `.env.example` obsahuje jen názvy a netajné příklady.

## Databáze a upgrade

Na novém prázdném projektu aplikujte **všechny** migrace z `supabase/migrations` v pořadí podle názvu. Samotná baseline nestačí.

```powershell
supabase link --project-ref VAS_PROJECT_REF
supabase db push
```

Na existující instalaci nejprve vytvořte ověřenou zálohu a porovnejte skutečné schéma i migrační historii. Aplikujte pouze chybějící forwards. Neresetujte produkci, neupravujte staré migrace a neopravujte historii bez plánu. Sdílení mění oprávnění a capture kontrakty: databázi, web a workery upgradujte společně. [Databázový návod](supabase/README.md), [upgrade a rollback hranice](docs/api/project-sharing-runbook.md).

V Supabase Auth nastavte Site URL svého webu, přesné callbacky a účet správce. Pro pozvánky nastavte vlastní SMTP a přesné Invite/Magic Link šablony podle [Auth](docs/api/auth.md) a [pozvánek](docs/api/recording-invitations.md). Nevytvářejte sdílený demonstrační účet ani automatické public signup kvůli pluginu.

```powershell
npm.cmd run dev
```

Lokální aplikace běží na `http://127.0.0.1:3047`. HTTPS je vyžadované pro veřejné MCP/OAuth originy. Web lze nasadit na vlastní Vercel projekt nebo kompatibilní Next.js runtime; deploy button nezřizuje Supabase ani provider účty a neaplikuje migrace. Kopie repozitáře se aktualizuje samostatně.

## Připojení v Codexu a Claude Code

Správce jednou připraví vlastní server podle [českého MCP setupu](plugins/vosio/SETUP.md). Zdroj obsahuje Function `supabase/functions/vosio-mcp`, OAuth bridge, consent stránky, discovery i potřebné migrace. MCP je do výslovné konfigurace a aktivace vypnuté.

Pak každý uživatel nainstaluje společný plugin:

```powershell
codex.cmd plugin marketplace add 88barcode88/vosio --ref main --sparse .agents/plugins --sparse plugins/vosio
codex.cmd plugin add vosio@vosio-community
```

Restartujte Codex, spusťte setup pluginu Vosio a zadejte adresu **svého** webu. Osobně se přihlaste a potvrďte přístup. Klient nepotřebuje zdroj aplikace, Supabase service role, Client Secret ani provider klíče. [Použití a aktualizace pluginu](plugins/vosio/README.md).

Pro Claude Code přidejte vlastní Function URL a dokončete přihlášení v `/mcp`:

```sh
claude mcp add --transport http vosio https://your-project.supabase.co/functions/v1/vosio-mcp
```

MCP čte pouze dostupné nahrávky/přepisy/výstupy/úkoly a na výslovný požadavek mění názvy, mluvčí a stav úkolu. Neposkytuje mazání, správu přístupů, libovolné SQL ani placené AI generování. Přístup odvolejte na `/mcp/connections` vlastní instalace; odinstalování pluginu backend grant neodvolává.

## Workery a provoz

Přijatý souborový přepis používá durable worker, bounded dispatch a autentizovaný Soniox callback. Pro dlouhé úlohy nastavte vlastní externí scheduler a alerts podle [capture kontraktu](docs/api/capture-operation-contracts.md); GET polling je pouze čtení. Transkripce nemá globální off-switch.

Trash retention a ruční purge worker vyžadují vlastní scheduler token a explicitní aktivaci. Jejich zdroj nepřidává Cron, nezapíná mazání a nezpracuje backlog jen nasazením aplikace. [Trash setup](supabase/README.md#trash-retention-edge-function-deployment), [manual purge](docs/api/manual-recording-purge-worker.md).

## Ověření

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd run check:mcp
npm.cmd run test:e2e
```

SQL/RLS/concurrency testy jsou v `supabase/tests`, native proof skripty v `scripts/verify-*-postgres.mjs`. Používejte pouze vlastní disposable loopback databázi. Source test, lokální SQL proof, vzdálený deploy, skutečné OAuth, Storage a Soniox/AI provider běh jsou samostatné důkazy. Nová instalace musí ověřit svůj target a osobní přihlášení, včetně druhého účtu a revokace.

## Dokumentace a licence

[Architektura](docs/architecture.md), [konvence](docs/conventions.md), [gotchas](docs/gotchas.md), [Supabase schema](docs/api/supabase-schema.md), [MCP kontrakt](docs/api/mcp-plugin.md), [bezpečnost](SECURITY.md).

Projekt je source-available podle [LICENSE.md](LICENSE.md). Vlastní osobní a interní nasazení je povolené; placený SaaS/resale nebo white-label vyžaduje písemné povolení. Zdroj neposílá skrytý tracking ani licenční beacon.
