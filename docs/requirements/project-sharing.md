# Projektové sdílení Vosio

Stav: lokální zdrojová implementace. Nejde o potvrzení aplikovaných migrací,
nasazení ani živého onboarding testu. Provozní brány jsou v
[runbooku](../api/project-sharing-runbook.md).

## Uživatelé a přístup

Tým je volitelný. Freelancer používá Vosio bez projektu i bez klienta. Projekt
může existovat bez klienta. Nové i původní nahrávky jsou výchozí soukromé;
přiřazení k projektu samo obsah nesdílí a pozvání člena nezveřejní staré záznamy.

| Role | Povolené operace |
| --- | --- |
| Čtenář | Celé povolené audio, přepis, uložené AI výstupy a úkoly |
| Editor | Čtení, přidání nahrávky do projektu, název, jméno/role mluvčího, stav úkolu |
| Zakladatel projektu | Správa členů, projektových pozvánek a sdíleného projektového obsahu |
| Správce celé instalace | Správa vlastního seznamu lidí a již spravovatelných rozsahů; role sama nedává cizí obsah |
| Vlastník samostatné nahrávky | Správa přesného sdílení a pozvánek jejího obsahu |

Editor ani čtenář nespouštějí AI/chat, nespravují přístup a nemažou ani neobnovují
obsah. Osobní AI vyžaduje původního osobního vlastníka i současný přístup a správu.
Cizí osobní chat, klienti, složky, štítky, prompty, provider nastavení, job snapshots
a audit se nesdílí. Autorství není trvalé oprávnění.

## Viditelnost a vytvoření

- Soukromá: pouze vlastník, i uvnitř cizího projektu.
- Členové projektu: současní a budoucí aktivní členové projektu, případně další výslovné přesné nebo klientské/složkové granty.
- Vybraní lidé: výslovné přesné nebo klientské/složkové granty; členství projektový výběr nerozšiřuje.

## Tým, klienti a složky

Tým je dostupný instalačnímu správci a zakladateli projektu; běžný člen nemá
správcovský přehled ani přes přímou adresu/API. Správce instalace je výslovný
neveřejný registr účtů bez bootstrapu. Seznam lidí je vlastní, ne globální adresář.
Zakladatel vidí a spravuje pouze lidi a pozvánky svých projektů.

Ve variantě A je vlevo seznam lidí a čekajících pozvánek, vpravo detail aktivních
přístupů. Na mobilu je Tým pod Více a detail nabízí návrat. Pozvat lze na nahrávku,
projekt, klienta nebo složku. Pending pozvánka nedává přístup; vznikne až přijetím.
Klient/složka zahrnují současné i budoucí nesoukromé nahrávky v autorizované hranici.
Soukromé nahrávky se vždy vynechají, včetně nahrávek autora grantu. Přesun mění
účinek dynamického grantu; odebrání jedné cesty neruší jiný platný přístup.
Podrobný kontrakt a rollout hranice: [team-access](../api/team-access.md).

Live relace a každá položka upload fronty mají neměnný snapshot projektu,
viditelnosti, příjemců a request ID již před vytvořením draftu. Retry nesmí použít
jiný scope nebo vytvořit tichou kopii. Vytvoření a přístup vynucuje jedna DB transakce.

Zakladatel může editorovi připravit přesný jednorázový výběr. Editor jej vybere
přímo v aplikaci, bez kopírování kódu. Create znovu ověří aktuální roli, platnost,
neodvolané schválení a přesnou sadu příjemců. Jedno schválení patří jedné nahrávce,
nikoli celé frontě. U samostatné nahrávky se předem vybírají již potvrzení příjemci;
nový člověk se zve emailem až z detailu uložené nahrávky.

Potvrzení příjemci označují omezený seznam kontaktů nabídnutý UI, nikoli nový
univerzální souhlasový kontrakt nad každým UUID. DB nadále vynucuje existenci
příjemce, oprávnění aktéra, přesný scope a grant; nepovoluje enumeraci adresáře Auth.

Pozdější a hromadné sdílení je explicitní. Nejvýše 100 vstupních ID se mění jedním
atomic RPC, celé nebo vůbec. Nejasná odpověď znamená opakování stejného requestu,
nikoli novou operaci. Historický receipt není potvrzení současných oprávnění.

Sdílený projektový obsah spravuje zakladatel. Autor jej sám neprivatizuje,
neodpojuje ani nemaže. Odebrání autora zachová projektová data a odstraní jeho
týmový přístup včetně příslušných selected grants a pending pozvánek. Jeho vlastní
soukromá data zůstávají soukromá. Převod vlastnictví účtu není součástí této funkce.

Zakladatel může svou vlastní původní sdílenou nahrávku vrátit na soukromou
s odvoláním jejích grants a pending pozvánek. Nahrávky jiných autorů zůstávají
projektu; jejich návrat původnímu autorovi se nezavádí.

## Pozvánky

Pozvat lze existující i nový účet, vždy emailem. Onboarding je pouze na pozvánku,
bez veřejného signup. Pending pozvánka neposkytuje přístup. Ověření Auth identity
ani GET preview pozvánku nepřijímá; přijetí je výslovný POST správného ověřeného
emailu. Token musí být platný, neodvolaný a stále autorizovaný pro původní scope.

První přijetí pozvánky k samostatné soukromé nahrávce atomicky změní pouze přesná
pozvaná ID na vybrané sdílení. Smazání pending pozvánky neodebírá již přijaté členství
nebo grant; k tomu slouží samostatná akce odebrání přístupu.

## Capture, revokace a historie

Nové upload/capture/provider start requesty po revokaci selžou. UI uchová dostupný
lokální text/audio pro výslovné řešení; nesmí automaticky odsdílet projektový draft.
Již nevratně zahájená async práce pokračuje pod přesným durable operation/job
receipt i bez autorovy session, bez obnovení jeho přístupu nebo nové AI operace.

Provider POST po nejasném výsledku se automaticky neopakuje. Stav uncertain
vyžaduje externě ověřené operátorské řešení. Nový přepis zachová starší generace,
uložené AI výstupy, joby a intents. Nepoužívá legacy destruktivní completion helper.
Signed audio URL vydané před revokací mohou platit do 300 sekund; stažené kopie
nelze odvolat.

## Povinná akceptace před rolloutem

Skutečné F/E/R/S/X role musí ověřit private izolaci, project/selected přesnost,
title/speaker/task edit, UI i přímé API/REST/RPC zamítnutí, revokaci ze staré session,
Storage podpisy, capture retry/recovery a pokračování přijaté async práce. Samostatně
se ověří existující/nový účet v izolovaném Auth/email sinku, TTL, double accept a
accept/revoke závody. Unit nebo inert browser mock není důkaz těchto vlastností.

Mobil, desktop, světlý/tmavý motiv, klávesnice, focus a retry musí zachovat schválený
Notion Warm design. MCP, veřejný signup, přesuny mezi nezávislými databázemi,
account transfer a nové mazací workflow jsou mimo rozsah.
