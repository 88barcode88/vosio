# Vosio – rozšíření prohlížeče (Chrome / Edge)

Manifest V3 rozšíření, které nahrává online schůzky (Google Meet, Microsoft Teams web, Zoom web, vlastní weby) do **vlastního** Vosia uživatele. Přepis spouští Vosio. Rozšíření neobsahuje žádnou adresu konkrétní instalace, žádné tajemství ani npm závislost.

Návrh a kontrakt: `openspec/changes/vosio-browser-extension/` (`design.md` D4, D6, D8; `specs/browser-extension-*`).

## Sestavení

```bash
npm run build:extension            # chrome  -> .tmp/extension/chrome/
npm run build:extension -- edge    # edge    -> .tmp/extension/edge/
npm run build:extension -- dev     # dev     -> .tmp/extension/dev/ (název „(dev)“, volitelný stabilní key)
```

Build (`scripts/build-vosio-extension.mjs`) jen přeloží `extension/src/**/*.ts` nainstalovaným `typescriptem` (bez bundleru; ES moduly se importují jako `./x.ts` a v emitu se přepíšou na `./x.js`), content scripty slepí do jednoho klasického skriptu (content scripty nemohou být ES moduly), zkopíruje HTML/CSS/ikony a manifest a ověří, že všechny soubory odkazované z manifestu existují. Ikony (`extension/icons/`) vznikly z `public/vosio-logo.svg` skriptem `scripts/generate-extension-icons.mjs`.

## Načtení do Chrome / Edge (unpacked)

1. `npm run build:extension -- dev`
2. Chrome: `chrome://extensions` → zapnout „Režim pro vývojáře“ → „Načíst rozbalené“ → vybrat `.tmp/extension/dev`.
   Edge: `edge://extensions` → „Vývojářský režim“ → „Načíst rozbalené“ → totéž.
3. Po změně kódu spustit build znovu a v `chrome://extensions` kliknout na „Znovu načíst“.

### Dev klíč (stabilní ID)

Bez `key` v manifestu dostane každý počítač jiné ID rozšíření (a tím i jinou návratovou adresu `https://<id>.chromiumapp.org/`). Server (DCR) to nevadí, ale pro stabilní testování lze vytvořit lokální klíč, který **není v gitu** (`extension/dev-key.pem` je v `.gitignore`):

```bash
openssl genrsa -out extension/dev-key.pem 2048
npm run build:extension -- dev      # vypíše: Dev key found: extension id will be <id>
```

Jiné umístění klíče: proměnná `VOSIO_EXTENSION_DEV_KEY_FILE`. Public key se do manifestu vkládá jen u cíle `dev`; chrome/edge buildy `key` nikdy neobsahují (ID přidělí Chrome Web Store / Edge Add-ons, každé ID se zaregistruje samostatně přes DCR).

## Testy

```bash
npm run test -- tests/unit/extension-   # pairing, settings, detekce, nahrávání, fronta odesílání
npm run typecheck && npm run lint       # pokrývají i extension/ (minimální chrome.d.ts místo @types/chrome)
```

Testy používají `chrome.*` stub, Web Locks a fake server drátového kontraktu D8 (`tests/unit/extension-test-utils.ts`). Skutečné chování prohlížeče (tabCapture, offscreen, MediaRecorder, `launchWebAuthFlow`, selektory Meet/Teams/Zoom) testy **neověřují** – viz kontrolní seznam níže.

## Architektura (stručně)

| Část | Soubor | Role |
|---|---|---|
| Service worker | `src/background/service-worker.ts` | události prohlížeče, zprávy, ikona/popup per karta, spouštění |
| Párování | `background/pairing.ts`, `pair-flow.ts` | discovery, DCR, PKCE, tokeny, serializovaný refresh (`navigator.locks`), odpojení |
| Capture API | `background/capture-api.ts` | POST klient D8, 1× refresh při 401, signed PUT |
| Stavový automat | `background/recording.ts` | jedna nahrávka, auto-stop signály, obnova po pádu |
| Fronta odesílání | `background/upload.ts` | create → parts → PUT → complete, backoff, `chrome.alarms` |
| Offscreen | `src/offscreen/*` | `AudioContext` mix, `MediaRecorder`, chunky do IndexedDB, rotace částí |
| Úložiště | `src/db/*` | IndexedDB (relace + chunky) |
| Detekce | `src/content/*`, `shared/platforms.ts` | modul na platformu, monitor s debounce |
| UI | `popup/`, `options/`, `permissions/` | česky, tokeny podle DESIGN.md |

Režimy: **Automaticky** = klik na ikonu nebo zkratka (`Alt+Shift+R`) na rozpoznané schůzce okamžitě spustí nahrávání (popup se na takové kartě vypíná `action.setPopup({popup:""})`); **Zeptat se** = popup s potvrzením; **Vypnuto** = schůzky se neoznačují a nic se nespouští samo, ruční start z popupu zůstává. Zkratka se řídí režimem: v Automaticky startuje okamžitě, v Zeptat se / Vypnuto otevře popup s potvrzením (`action.openPopup()`, při selhání notifikace); běžící nahrávku zastaví ve všech režimech. Před první nahrávkou je vždy nutné potvrdit upozornění o informování účastníků.

## Návod pro self-hostery

- **Žádná konfigurace serveru** kromě nasazení verze Vosia s capture rozhraním (`vosio-mcp` s `/capture/*`, migrace scopes, `RECORDING_TRANSCRIPTION_DISPATCH_TOKEN`; viz `docs/api/browser-extension-capture.md`).
- Uživatel v rozšíření zadá adresu svého Vosia; rozšíření z ní samo zjistí OAuth metadata (`/.well-known/oauth-authorization-server`), zaregistruje se jako veřejný klient (DCR) a přihlášení proběhne na stránce Vosia. Adresa Supabase se odvodí z metadat (a z `/capture/config`), nikdy není v balíčku.
- **Vlastní build s vlastním ID funguje**: `npm run build:extension` → načíst unpacked, nebo zabalit vlastním klíčem. Každé ID se zaregistruje samostatně přes DCR (návratová adresa `https://<id>.chromiumapp.org/oauth`), server nic nenastavuje.
- Ověření čistoty balíčku: `rg -n "supabase\.co|<ref-projektu>|<vaše-doména>" .tmp/extension` nesmí nic najít.

## Ruční akceptace (úkol 7.2, vyžaduje nasazení na privátní target)

Zapsat verze Chrome a Edge a výsledky (bez obsahu nahrávek). Dokud není provedeno, je akceptace **pending**.

- [ ] Instalace dev buildu v Chrome i Edge; ID se liší, obě se spárují (DCR pro každé ID).
- [ ] Spárování: zadání adresy, dvě žádosti o oprávnění (web, pak server), přihlášení na Vosiu, „Spárováno s … jako …“; zrušení okna / odmítnutí souhlasu nic neuloží.
- [ ] Mikrofon: stránka `permissions.html`, povolení platí i v offscreen dokumentu; bez povolení nahrává jen schůzka s viditelným upozorněním.
- [ ] Režimy: Automaticky (klik/zkratka bez dialogu), Zeptat se (potvrzení), Vypnuto (bez označení, ruční start funguje).
- [ ] Meet, Teams web, Zoom web a vlastní web: ikona se změní na schůzce; aktivace přežije přechod lobby → hovor (SPA URL).
- [ ] Zvuk: uživatel dál slyší schůzku, v nahrávce je schůzka i mikrofon, žádná ozvěna; 60 min bez růstu paměti.
- [ ] Auto stop: opuštění hovoru, zavření karty, změna URL, ukončení zachytávání; ruční Zastavit.
- [ ] Jedna nahrávka současně: aktivace na druhé kartě nabídne ukončení stávající.
- [ ] Upozornění před první nahrávkou (nahrávání nezačne před potvrzením).
- [ ] Výpadek sítě po schůzce → „Čeká na odeslání“ → odeslání po obnovení sítě.
- [ ] Pád/zabití prohlížeče uprostřed nahrávky → po startu nabídka a odeslání uloženého (ztráta ≤ ~5 s).
- [ ] Dlouhá schůzka (více částí) → jeden přepis ve Vosiu se správným pořadím částí.
- [ ] Odpojení ve Vosiu → „Odpojeno ve Vosiu“, čekající nahrávky zůstanou; po novém spárování se dokončí do téže nahrávky (bez duplicity).
- [ ] Odpojení v rozšíření (s čekající nahrávkou) → varování, nahrávka zůstane.
- [ ] Vypršení spárování (30 dní, simulovat) → „Spárování vypršelo – přihlaste se znovu“.
- [ ] Smazání nahrávky ve Vosiu během uploadu → konec opakování a nabídka Stáhnout/Smazat.
- [ ] Přepis se spustí bez otevřeného Vosia (viz závislost na HTTPS `NEXT_PUBLIC_APP_URL` u dlouhých přepisů).
- [ ] Hlavičku `Origin: chrome-extension://<id>` posílá Chrome i Edge u POST ze service workeru (D2).
- [ ] `PUT` na podepsanou URL: potřeba/nepotřeba `apikey` na hosted i self-host; `x-upsert: false` neodmítnut.

## Odchylky od návrhu (D6/D8)

- Oprávnění `alarms` je v manifestu (potřebuje ho `chrome.alarms`), `commands` v `permissions` není (je to klíč manifestu) – shodně s aktualizovaným D6.
- `scopes_supported` serveru zůstává `[vosio:read, vosio:write]` (D1). Klient proto `vosio:capture` v discovery nekontroluje; nepodporovanou instalaci pozná podle `invalid_scope` (nebo `invalid_request` u starších serverů, které neznámý scope normalizují) při DCR, `invalid_scope` při authorize nebo 404 z `/capture/config` (stejná česká hláška „Aktualizujte Vosio“) a spárování vrátí zpět. 404 bez obálky `{error:{code}}` při samotném nahrávání (konfigurace mostu nenačtena, starší Function po rollbacku) je opakovatelné (backoff), trvalé je jen 404 s obálkou `not_found`.
- Upload zahozený v rozšíření se do webové obnovy vrací až po 7 dnech od založení vazby; server se o zahození nedozví.
- `/complete` s `transcription.state: "not_started"` je úspěch (audio uloženo, lokální data se smažou); klient zkusí `/complete` se stejným `requestId` ještě nejvýše 3× při dalších během fronty (záznam o tom přežije smazání audia).
- Při 409 `incomplete_parts` klient znovu pošle do `/parts` **celý souvislý seznam částí od indexu 0**; existující části přijdou jako `exists`, chybějící dostanou nové `uploadUrl`. Odmítnutý podpis (PUT 400/401/403) vyvolá jednu re-registraci, pak nahrávka selže.
- Adresy ze serveru se ověřují: `uploadUrl` musí být HTTPS na originu spárovaného serveru (resource), `detailUrl` HTTPS na `webOrigin` z configu, jinak chyba / odkaz se neotevře.
- `GET /capture/recordings/{id}/status` v D8 nevrací `captureRevision`, ale zpráva o `revision_conflict` říká „načti `/status` a pokračuj s aktuální revizí“. Klient čte volitelné pole `captureRevision` z odpovědi `/status`; pokud chybí, odeslání se zopakuje později. **Server má do `/status` přidat `captureRevision`.**
- Stavy nahrávky, které klient po `/status` považuje za „hotovo“ (konec opakování, smazání lokálních dat): `uploaded`, `transcribing`, `completed` (konstanta `DONE_STATUSES`, shodně s enumem serveru).

## Gotchas (controller přenese do `docs/gotchas.md`)

- **`getMediaStreamId` musí být volán synchronně v gestu**: `action.onClicked`, `commands.onCommand` i klik v popupu volají `chrome.tabCapture.getMediaStreamId` jako první příkaz (před jakýmkoli `await`); stream ID platí jen pár sekund a je jednorázové.
- **Zachycená karta je ztlumená**, dokud se zvuk nepřesměruje do `AudioContext.destination`; offscreen mix proto posílá zdroj karty do `MediaStreamDestination` (nahrávka) i do `destination` (uživatel slyší). Mikrofon jde jen do nahrávky (jinak ozvěna).
- **Offscreen dokument nemůže zobrazit dotaz na mikrofon**; povolení se dělá na viditelné stránce rozšíření (`permissions/permissions.html`) a platí pro celý origin `chrome-extension://<id>`.
- **Content scripty nesmí být ES moduly**: build je slepuje do klasického skriptu (`content/entry-*.js`); sdílený kód (`shared/platforms.ts`) se tím do každého balíčku vkládá znovu.
- **Service worker usíná**: stav nahrávky je v `chrome.storage.local` (`activeRecording`), stav karet v `chrome.storage.session`; po restartu `RecordingController.recover()` zjistí z offscreen dokumentu, zda nahrávání běží, jinak z chunků v IndexedDB udělá čekající nahrávku. Per-tab badge a popup Chrome při navigaci maže; content script po načtení stav hlásí znovu.
- **Service worker během dlouhého PUT**: Chrome ukončuje worker po 30 s nečinnosti. Během PUT části běží každých 20 s lehké volání `chrome.runtime.getPlatformInfo` (`background/keep-alive.ts`). **Zbývající riziko:** pokud prohlížeč worker přesto ukončí, PUT se přeruší; fronta pokračuje po dalším probuzení (alarm `vosio-tick`, `onStartup`) a část nahraje znovu (existující části server vrací jako `exists`). Reálně ověřit na pomalém uploadu (7.2).
- **Důvěryhodnost zpráv**: service worker přijímá od content scriptů jen `meeting-state` s validovaným tvarem; všechny ostatní zprávy jen ze stránek rozšíření (`sender.url` začíná `chrome.runtime.getURL("")`, `sender.id === chrome.runtime.id`). `chrome.storage.local.setAccessLevel(TRUSTED_CONTEXTS)` se volá při startu workeru, pokud ho prohlížeč podporuje (tokeny pak nečtou content scripty).
- **Mikrofon v offscreen**: před `getUserMedia` se zjišťuje stav oprávnění (`navigator.permissions.query`); bez `granted` se mikrofon přeskočí (nahrává se jen schůzka s upozorněním), samotné `getUserMedia` má timeout 4 s.
- **Refresh token se rotuje**: nový pár se ukládá před použitím a refresh běží pod `navigator.locks`; po ztracené odpovědi obnovy je další pokus replay → grant se odvolá → stav „Odpojeno ve Vosiu“ → nové spárování a pokračování do téže nahrávky (stejná `requestId`).
- **Meeting selektory** (konzervativní; neznámý jazyk/DOM = „nejsem v hovoru“, takže se nikdy neukončí omylem, zůstanou zavření karty/změna URL/ruční stop):
  - Meet: URL `meet.google.com/abc-defg-hij`; v hovoru = tlačítko s `aria-label`/`data-tooltip` „Leave call“ / „Opustit hovor“ (a další jazyky).
  - Teams: `#hangup-button`, `button[data-tid="hangup-main-btn"]`, `button[data-tid="call-hangup"]` nebo štítek Leave/Zavěsit; samotná URL Teams nestačí (celá aplikace), schůzka = `/meetup-join`, `/light-meetings`, `/meet/` nebo signál „v hovoru“.
  - Zoom web: `/wc/…`; v hovoru = `button.footer__leave-btn` nebo štítek Leave. Content script běží jen v hlavním rámci (`all_frames` vypnuto) – pokud Zoom vykresluje ovládání v iframe, bude nutná úprava.
  - „Opuštěno“ se potvrzuje až po 3 s nepřítomnosti signálu (debounce proti blikání při opětovném připojení).
- Vlastní weby: `registerContentScripts` ovlivní jen nově načtené stránky; po přidání je nutné otevřené karty načíst znovu. Match pattern ignoruje port, uložený je `https://<host>`.
