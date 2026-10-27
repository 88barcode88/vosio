# Zařazení nahrávky

Lokální kandidát vyžaduje forward `20261027074514_shared_recording_organization.sql`
před odpovídajícím app deployem. Zde popsané RPC nejsou potvrzením produkčního
apply, Supabase HTTP/Auth/Storage postflightu ani akceptace druhým uživatelem.

## Autorita a cíle

`recording_organization_context_v1(recording_id)` vrací pod současným sharing
lockem pouze assignment ID, visibility a `organization_policy` s
`personalEditable` a `projectIds`. Vyžaduje aktuální `can_manage_recording`,
nesmazaný řádek a authenticated identitu. Reader, editor ani instalační admin
bez správy konkrétní nahrávky tím nezískají právo organizovat obsah.

Vlastní private nahrávka zachovává původní capture pravidla projektu. Vlastní
selected nahrávka může dostat vlastní klient/složku/štítky a vlastní founder
projekt. Visibility se nemění. Founder nad nesoukromou nahrávkou jiného autora
smí změnit projekt pouze v rámci své správy. Osobní klient, složka a štítky autora
zůstávají redigované a beze změny; osobní cíle v payloadu musí být prázdné.
Project visibility nesmí skončit bez projektu, a cizí autor nesmí tiše získat
správu odpojením nahrávky od zakladatelova projektu. Transfer k jinému founderovi
není podporován. Zakladatelův klient musí odpovídat jeho projektu u osobně
vlastněné nahrávky, stejně jako v původním private kontraktu.

## Náhled a uložení

`preview_recording_organization_v1(recording_id, client_id, project_id,
folder_id, tag_ids)` validuje celé cílové zařazení. Vrací `fingerprint`,
`exactRecipients`, `addedPaths`, `removedPaths` a oddělené `pendingInvitations`.
Cesty obsahují jen ID, e-mail příjemce, roli a druh rozsahu. Pozvánky obsahují
jen ID, e-mail, roli a rozsah. Nevrací token/hash, audio, obsah přepisu ani osobní
taxonomii cizího autora. Pending pozvánka není aktivní přístup. Soukromé nahrávky
nemají dynamické scope cesty ani pending publikum.

UI ukáže vybraný cíl, zachované exact příjemce a přidané/odebrané aktivní cesty.
Čekající pozvánky cíle označí jako budoucí přístup až po přijetí. Změna draftu
zneplatní potvrzení. `assign_recording_organization_v2(..., expected_fingerprint)`
získá stejný lock, zopakuje celý preflight a dovolí jedinou atomickou mutation
jen pro shodný fingerprint. Ten váže současné assignment ID, normalizované
štítky, cíle, exact granty a aktuální i budoucí přístupové cesty. Není autorizačním
tokenem; server vždy znovu ověřuje správce.

Při projektovém přesunu se aktivním exact grantům přepojí pouze
`scope_project_id`. ID, příjemci a role zůstávají; revoked řádky se nemění.
Nevolá se reset sdílení, nevzniká e-mail ani AI job. Uložení vrací bezpečný
context jako transakční readback; akce porovná uložená ID a invaliduje
`/recordings` (včetně hledání/filtrů), detail a `/team`. Při chybě zůstává draft.
Stará `assign_recording_organization_v1` zůstává kompatibilní jen pro private
caller a interně používá stejný preflight/v2. Sdílené uložení bez potvrzeného
fingerprintu není povoleno. Přímá private UI větev používá fresh context a
preflight na serveru; nesoukromá větev nejdřív načte autoritativní policy.

## Blokace

- `42501`: chybějící správa, cizí osobní cíl, nepovolený projekt/custody transfer.
- `22023`: nesoulad klienta a vlastního founder projektu.
- `40001 / organization preview stale`: změněné zařazení, exact/scope grant nebo
  čekající pozvánka. UI vyžádá nový náhled a potvrzení, zachová hodnoty.
- `55000 / organization pending invitation`: projektový přesun zasahuje živou
  pozvánku aktuálního/cílového projektu nebo přesný invitation item. Záměrně
  konzervativní blokace zachovává původní invitation scope.
- `55000 / organization active transcription`: projektový přesun při
  prepared/started/accepted/uncertain operaci nebo legacy queued/running jobu.
  Ani připravená práce se touto editací neruší. Původní
  `guard_recording_transcription_delete_v1` zůstává beze změny.
- `55000 / organization exact scope mismatch`: historická nekonzistence exact
  scope vyžaduje samostatnou explicitní opravu, nikoli oživení grantu.

Prázdné vlastní složky mají pravdivou nápovědu ke stávající akci `Spravovat`
v přehledu nahrávek; editor nevytváří novou CRUD cestu ani produkční složku.

## Lokální ověření a rollout

`tests/sql/shared-recording-organization.sql` běží s `psql -v ON_ERROR_STOP=1`
v prázdné izolované databázi se schématem přes `20261026160001` a novým forwardem.
Fixture je transakční a končí rollbackem. Zahrnuje visibility, recipient scope,
osobní cíle, reader/editor/no authority, foreign autora, pending, aktivní práci
a stale preview. `tests/sql/shared-recording-organization-concurrency.mjs`
spouští dvě skutečná spojení do pevné lokální `organization_fixture`, ověří obě
pořadí sharing locku pro save/revoke a uklidí vlastní syntetické řádky.
Bootstrap emuluje jen Auth/Storage tabulky; neověřuje HTTP ani fyzické audio.

Před živým apply ověřit shodu existujících resolverů, zámků, grant triggerů,
invitation schématu, migračního baseline a trusted vlastníka funkcí. Po apply
ověřit těla/ACL, přesná ID/role/scope a viditelnost konkrétního povoleného testu.
Databázový návrat nesmí přepnout exact scope zpět nebo obnovit revoked granty.
UI revert může ponechat additive RPC; širší návrat vyžaduje individuální kontrolu
aktuálního stavu. Žádná hromadná oprava existujících nahrávek není součástí kandidáta.
