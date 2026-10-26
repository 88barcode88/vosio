# Tým: osobní lidé a výslovné přístupy

Status: lokální source kandidát. Bez aplikace na cílovou databázi, přidělení skutečného administrátora, odesílání pozvánek nebo produkční akceptace.

`GET /api/team` vrací `TeamWorkspace` ze `src/lib/team/types.ts`. Zahrnuje roli, vlastní lidi s jednotlivými přístupovými cestami, samostatné čekající pozvánky a aktuálně spravovatelné rozsahy. `POST /api/team/access` přijímá `{scopeKind,scopeId,projectId,userId,role}`; `DELETE` stejnou identitu bez `role`. `projectId` je povinné nullable pole a u klienta/složky představuje pevnou projektovou hranici. Odpověď `{saved:true}` nebo `{revoked:true}` potvrzuje přesnou mutaci; UI následně obnoví celý serverový pohled.

Administrátor instalace je výslovně provisionovaný řádek `vosio_team_private.installation_administrators`, nikdy service role, první registrace nebo user metadata. Migrace nevkládá žádného administrátora a neexponuje veřejné zapisovací RPC. Administrátor spravuje vlastní tým a objekty, u kterých již má kanonickou management autoritu. Role sama nezpřístupňuje cizí nahrávky. Zakladatel spravuje své projekty; jeho klientské/složkové granty mají vždy konkrétní projektovou hranici. Ostatní nedostanou administrační seznam ani mutaci. `team_authority_v1` používá již existující `mcp_auth_session_active_v1`, proto zaniklá session ani odebraná registry role nepřetrvá jako oprávnění v navigaci.

Lidé pocházejí pouze z vlastních aktivních grantů/členství a oprávněných přijatých pozvánek. Administrátor navíc zachová výslovně spravované kontakty. API neposkytuje globální Auth adresář ani přidání náhodného UUID; nového člověka nejprve osloví současný invitation/token tok. Čekající pozvánka není přístup.

Původní `POST /api/recording-invitations` navíc přijímá `{scope:"client"|"folder",scopeId,projectId,email,role}`. Tentýž hashovaný token, delivery receipt, omezený resend, verified-email preview/accept a revoke zůstávají jedinou cestou. Nevzniká snapshot dnešních recording IDs ani paralelní mail služba. Přijetí atomicky vytvoří jeden scope grant až po opětovném ověření aktuální autority původního správce. Replay potvrzuje historické přijetí a neobnovuje odvolaný grant. Pending i accepted zůstávají rozeznatelné; nové scope identity jsou bezpečná manager metadata.

Výslovný klientský/složkový grant zahrnuje současné i budoucí odpovídající **nesoukromé** nahrávky. Soukromé jsou vždy vynechané, včetně osobní nahrávky administrátora. Samotné organizační zařazení není grant. Efektivní role je nejsilnější ze zbývajících platných cest (`editor` před `reader`); odvolání jedné cesty neruší jinou. Projektové členství a přesný grant jedné project-visible nahrávky mohou existovat současně bez změny visibility. Admin grant bez projektové hranice pokryje pouze nahrávky v jeho kanonické custody, ne cizí projekty. S odebranou instalační rolí přestane platit jeho administrátorský grant bez projektové hranice; projektově ohraničená autorita dál vyžaduje vlastnictví projektu.

`recording_access_role_v1` je společná autorita pro čtení nahrávky, transcriptů, sdílených AI výstupů/projekcí a přesných Storage objektů; rozšíření proto nezavádí druhý content authorizer. Osobní chat, provider konfigurace a právo spouštět osobní AI zůstávají původními osobními capability pravidly. Osobní klientská/složková metadata nadále maskují existující read projekce. Přesun mění vyhodnocení podle aktuálního řádku, nevytváří kopie grantů. Existující organizační RPC dovoluje editaci pouze private nahrávky; tato změna nezavádí nové právo přesouvat shared nahrávky. Izolované fixture přesuny ověřují dynamický grantový kontrakt.

Mutace používají původní `recording_sharing_lock_v1`, stejný jako sharing, revokace a organizační assignment. Znovu ověřují session/roli a přesný rozsah v databázi. Operátor při provision/revoke registry musí použít stejný transakční lock. Žádný browser ani service role nedostává přímý přístup k privátním tabulkám.

## Kompaktní výběr více přístupů

Forward `20261026160001_team_scope_picker_batch.sql` přidává níže popsaný batch kontrakt. Při instalaci i upgradu musí být aplikovaný na cíli před novým app buildem; ověřte jeho owner, ACL/RLS a přesná těla funkcí. Původní v1 API/RPC zůstávají kompatibilní. Syntetické permission a concurrency testy nenahrazují cílový apply/postflight.

`GET /api/team` nyní používá `team_workspace_v2`. Pole `scopes` doplňuje nullable `clientId`, `folderId` a `visibility` pouze k již spravovatelným volbám. Cizí osobní taxonomie se maskuje a chybějící metadata nejsou stav Sdílená. Prázdné projekty zůstávají volitelné; složky jsou plochá osobní taxonomie a nemají odvozeného klientského rodiče.

`POST /api/team/access/batch` přijímá `{requestId,userId,role,scopes:[{scopeKind,scopeId,projectId}]}`: 1–100 různých přesných rozsahů, společná reader/editor role, stávající ověřený příjemce. Používá existující verified session, origin a 16 KiB body guard. `set_team_access_batch_v1` pod stejným sharing lockem nejdřív autorizuje celý výběr a potom transakčně použije původní `set_team_access_v1`. Chyba kterékoli položky vrátí celý zápis. Nejde o smyčku HTTP single-grant požadavků.

Úspěch vrací `{saved:true,count}`. Privátní forced-RLS receipt váže actor/request UUID na kanonický payload; stejný požadavek vrátí historické potvrzení bez opětovného vytvoření odebraných grantů, jiný payload se stejným UUID se odmítne. UI před odesláním zachytí UUID, příjemce a celý výběr. Po síťové chybě/5xx/neplatném potvrzení zachová a uzamkne draft a nabízí ověření stejného požadavku; až po potvrzeném reloadu zobrazuje aktuální přístupy. Recovery draft žije v paměti komponenty, nikoli napříč reloadem stránky. Receipt není tvrzení o dnešním oprávnění.

Soukromé nahrávky rodičovský grant nadále vynechává. Výslovná recording volba používá existující sharing pravidla a ukazuje aktuální Soukromá i souhrnný počet a příjemce. Klient/složka zahrnují nesoukromé nahrávky v dané hranici, včetně selected; samotné projektové členství zahrnuje pouze project-visible. Checkbox rodiče nevytváří skryté exact granty potomků. Odebrání dál používá původní přesnou DELETE identitu a výslovné potvrzení.

## Preflight a návrat

Před samostatně autorizovaným nasazením ověřit skutečnou definici/owner/BYPASSRLS původních helperů, všech prerequisite migrací včetně `mcp_auth_session_active_v1`, přímé ACL a forced RLS. Neopravovat remote ledger automaticky. Aplikovat forward pod stejným trusted vlastníkem jako sharing helpery v jedné transakci s bounded lock/statement timeout. Neprovádět bootstrap administrátora bez výslovně určeného ověřeného účtu a nového souhlasu.

Postflight musí zkontrolovat nepřístupnost private schema pro anon/authenticated/service_role, úzké EXECUTE, prázdný search_path, nezměněné legacy recording/transcript/output počty a reálné dvě identity: founder A/B, member, odebraný admin, private, future, přesun, druhý grant, revokace a souběh. Browser/source testy nejsou RLS důkaz.

Rollback před commitem je transakční. Po commitu nejprve uzamknout sharing a reverzibilně revokovat nové scope grants; zachovat invitation/audit řádky a registry. Starý aplikační build může dál používat původní recording/project API. Obnovení původního role helperu/triggeru vyžaduje samostatný forward s přesnou původní definicí a rozhodnutí o existujících exact project-visible grantech. Nedělat automatický DROP schématu ani mazání lidí/dat.

## Ověření

`tests/unit/team-access.test.ts` ověřuje HTTP/session/validaci, sanitizaci, přesné RPC payloady a fail-closed navigaci. Nezaměňovat mockované DB odmítnutí s reálným důkazem founder/member/RLS. Runtime databázový důkaz a jeho přesná provenience patří do integračního záznamu rodičovského change.
