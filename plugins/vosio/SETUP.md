# Nastavení vlastního Vosio MCP

Tento postup provádí správce vlastní instalace jednou. Běžný uživatel pak v pluginu zadá adresu svého Vosia a osobně se přihlásí. Supabase, Soniox ani serverové OAuth klíče do Codexu neposílá.

## 1. Připravte aplikaci a databázi

Použijte celou aktuální veřejnou aplikaci a všechny migrace v `supabase/migrations`, v pořadí podle názvu. Pro nový prázdný projekt postupujte podle [Supabase návodu](../../supabase/README.md). U existující databáze nejprve ověřte migrační historii a schéma; nepoužívejte reset ani nepřepisujte už aplikované migrace.

Nasazení webu musí mít vlastní kanonickou HTTPS adresu a běžné Supabase/provider proměnné z `.env.example`. `NEXT_PUBLIC_APP_URL` je adresa tohoto webu. MCP secrets patří do Edge Function, nikoli do Vercelu nebo prohlížeče. Zdroj obsahuje webové stránky `/mcp/consent`, `/mcp/upstream-consent` a `/mcp/connections` i discovery a OAuth adaptéry.

## 2. Vytvořte upstream OAuth klienta

Ve **svém** Supabase projektu povolte OAuth server a nastavte authorization path `/mcp/upstream-consent` na své webové doméně. Pod **Authentication → OAuth Apps** založte confidential klienta pro Vosio MCP a zaregistrujte přesný callback:

```text
https://vase-vosio.example/api/mcp/oauth/callback
```

Adresa je příklad; použijte skutečný HTTPS webový origin své instalace. Uložte Client ID a jednorázově zobrazený Client Secret do správce hesel. Pokud už máte aktivního klienta a jeho secret, používejte stejné hodnoty. Nevytvářejte ani nerotujte klienta jen kvůli přidání dalšího uživatele.

Upstream confidential klient patří serveru. Codex/Claude se při prvním připojení samostatně registruje jako public klient; nepotřebuje jeho Client ID ani Client Secret.

## 3. Uložte dva serverové klíče

Ve **svém projektu → Edge Functions → Secrets** vložte:

| Název | Hodnota |
| --- | --- |
| `MCP_TOKEN_ENCRYPTION_KEY` | Nový náhodný klíč: přesně 32 bajtů v base64. Zachovejte a zálohujte ho pro čtení uložených OAuth tokenů. |
| `MCP_SUPABASE_CLIENT_SECRET` | Client Secret confidential klienta z kroku 2. Není to Supabase API key ani JWT secret. |

Hodnoty nepatří do repozitáře, chatu ani pluginu. Šifrovací klíč měňte pouze v rámci řízené obnovy tokenové custody; jeho náhrada znečitelní existující připojení.

Pro **první vytvoření** šifrovacího klíče v PowerShellu:

```powershell
$mcpKeyBytes = New-Object byte[] 32
$mcpKeyGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $mcpKeyGenerator.GetBytes($mcpKeyBytes)
    Set-Clipboard -Value ([Convert]::ToBase64String($mcpKeyBytes))
} finally {
    $mcpKeyGenerator.Dispose()
    [Array]::Clear($mcpKeyBytes, 0, $mcpKeyBytes.Length)
}
```

Hodnota se nevypíše; vložte ji ze schránky do Supabase a správce hesel. Potom vyčistěte schránku pomocí `Set-Clipboard -Value ''`. Nepoužívejte tento příkaz pro přepsání klíče aktivní instalace.

## 4. Nakonfigurujte instalaci ve vypnutém stavu

V SQL editoru vlastního projektu, s oprávněním správce, nahraďte všechny tři příklady skutečnými údaji:

```sql
select public.mcp_installation_v1('configure', jsonb_build_object(
  'enabled', false,
  'webOrigin', 'https://vase-vosio.example',
  'publicSupabaseUrl', 'https://vas-projekt.supabase.co',
  'upstreamClientId', 'UUID-CONFIDENTIAL-KLIENTA'
));
select public.mcp_installation_v1('read', '{}'::jsonb);
```

Čtení musí vrátit přesně stejné originy a Client ID s `enabled=false`. Konfigurace neobsahuje secrets. Její identita je neměnná; pokus přepsat ji na jiný server skončí konfliktem, aby se staré tokeny nepřesměrovaly jinam. Běžný přihlášený účet tyto service-only RPC používat nemůže.

## 5. Sestavte a nasaďte Function

Z kořene vlastní pracovní kopie aplikace:

```powershell
npm.cmd ci
npm.cmd run check:mcp
supabase functions deploy vosio-mcp --project-ref VAS_PROJECT_REF --no-verify-jwt
```

`check:mcp` potřebuje Deno a balí sdílené TypeScript moduly do `supabase/functions/vosio-mcp/generated`; ty se negitují. Nasaďte pouze tuto Function. `verify_jwt=false` je úmyslné: Function ověřuje vlastní opaque OAuth token, upstream uživatele, živou relaci a aktuální oprávnění/RLS. Bez nich nástroje nepovolí.

Výsledná MCP URL je:

```text
https://vas-projekt.supabase.co/functions/v1/vosio-mcp
```

Web a Function musí patřit stejné nakonfigurované instalaci. Supabase poskytuje běžné runtime klíče sama; při self-hostingu je musí správce navázat ve vlastním Edge Runtime. Nestačí vložit libovolný Supabase API key do klienta.

## 6. Výslovně zapněte a ověřte MCP

Po ověření vlastního webu, Function, OAuth klienta a obou secrets:

```sql
select public.mcp_installation_v1('enable', '{"enabled":true}'::jsonb);
select public.mcp_installation_v1('read', '{}'::jsonb);
```

Ověřte, že `https://vase-vosio.example/.well-known/oauth-authorization-server` zveřejňuje pouze vaše originy, Function token/register/revoke endpointy a PKCE S256. Přístup k nástrojům bez přihlášení musí být odmítnut. Zdroj nebo úspěšný deploy sám nepotvrzuje osobní OAuth a aktuální práva k nahrávkám.

V Codexu nainstalujte společný veřejný plugin podle [README](README.md), spusťte setup a zadejte svůj web. Přihlaste se svým účtem a potvrďte přístup. Ověřte autorizované čtení a pak reader/editor/odebrání přístupu pomocí druhého účtu. Pokud jste OAuth nedokončili nebo druhý účet nemáte, označte tuto akceptaci jako neprovedenou.

Pro Claude Code stačí vlastní MCP URL:

```sh
claude mcp add --transport http vosio https://vas-projekt.supabase.co/functions/v1/vosio-mcp
```

V `/mcp` dokončete osobní přihlášení. Další člověk nedostává serverové klíče. Jeho přístup určuje jeho účet a aktuální sdílení nahrávek.

## Provoz, obnova a pokročilý setup

Vypnutí je `mcp_installation_v1('enable', '{"enabled":false}')`; custody ani nahrávky se nemažou. Přístup konkrétního uživatele se odvolává na `/mcp/connections` vašeho webu. Při obnově vraťte stejné secrets a stejnou identitu instalace. Nejasný výsledek zápisu ověřte čtením; neopakujte automaticky vytvoření klienta nebo rotaci secretu.

Pro správce je také dostupný `npm run setup:mcp`. Bez `--apply`, `--enable` nebo `--disable` provede preflight/dry-run, nikoli zápis. Hosted režim používá scoped `SUPABASE_ACCESS_TOKEN` pouze z process environment, `--project-ref`, `--web-origin`, `--supabase-url` a owned `--receipt` pod `.tmp/mcp-setup`; secrets se nevypisují. `--apply` je samostatný opt-in, který může vytvořit klienta a první secrets. Ruční dashboard postup výše není pokyn k jeho dalšímu spuštění proti aktivní instalaci. Po nejistém výsledku se nejprve rekonciluje receipt.

Self-hosted Supabase musí prokázat kompatibilní Auth OAuth, sessions/JWT, web cookie bridge, veřejný issuer, gateway cesty a Edge Runtime. Použijte `--service-url` a `--self-hosted-preflight` pouze po této kontrole; helper neaktualizuje platformu ani neslibuje kompatibilitu z čísla verze. Přesný kontrakt a preflight formát jsou v [MCP API dokumentaci](../../docs/api/mcp-plugin.md).

Oficiální zdroje: [Supabase OAuth server](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [Function secrets](https://supabase.com/docs/guides/functions/secrets), [Function authentication](https://supabase.com/docs/guides/functions/auth).
