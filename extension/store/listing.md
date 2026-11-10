# Podklady pro Chrome Web Store a Edge Add-ons

Koncept pro podání vlastníkem. Nic z toho není publikováno. Snímky obrazovky: **TBD** (pořídit z dev buildu po ruční akceptaci; viz seznam na konci).

## Jediný účel (single purpose)

**CS:** Rozšíření nahrává zvuk online schůzky v aktuální kartě a váš mikrofon a odesílá nahrávku do vašeho vlastního Vosia k přepisu.

**EN:** The extension records the audio of the online meeting in the current tab together with your microphone and uploads the recording to your own Vosio installation for transcription.

## Název a krátký popis

- **Název:** Vosio – nahrávání schůzek
- **Krátký popis (CS, ≤ 132 znaků):** Nahrává schůzky z Google Meet, Teams a Zoomu do vašeho vlastního Vosia k přepisu.
- **Short description (EN):** Records Google Meet, Teams and Zoom meetings into your own Vosio installation for transcription.

## Dlouhý popis (CS)

Vosio je pracovní prostor pro nahrávky, přepisy a AI výstupy, který si provozujete sami. Toto rozšíření umožňuje nahrát online schůzku jedním kliknutím:

- zvuk schůzky z aktuální karty (Google Meet, Microsoft Teams web, Zoom web klient, případně vlastní weby) smíchaný s vaším mikrofonem,
- režimy Automaticky (jedno kliknutí nebo zkratka), Zeptat se a Vypnuto,
- automatické ukončení po opuštění schůzky, zavření karty nebo opuštění stránky,
- průběžné lokální ukládání – pád prohlížeče nezpůsobí ztrátu více než pár sekund,
- odeslání do **vašeho** Vosia a spuštění přepisu; při výpadku sítě se odešle později.

Párování: zadáte adresu svého Vosia a přihlásíte se na jeho stránce. Rozšíření nikdy nevidí vaše heslo a získá jen úzké oprávnění zakládat nové nahrávky a nahrávat do nich audio. Spárování můžete kdykoli odpojit v rozšíření nebo v Nastavení Vosia.

**Důležité:** Nahráváte osobní komunikaci. Před nahráváním informujte účastníky schůzky; odpovědnost za to nese uživatel. Rozšíření vyžaduje vlastní instalaci Vosia.

## Long description (EN)

Vosio is a self-hosted workspace for recordings, transcripts and AI outputs. This extension records an online meeting with one click: the audio of the current tab (Google Meet, Microsoft Teams web, Zoom web client or your own sites) mixed with your microphone, saved locally while recording and uploaded to **your own** Vosio installation for transcription. You pair it by entering the address of your Vosio and signing in on its page; the extension never sees your password and only receives a narrow permission to create new recordings and upload audio. You can disconnect at any time.

**Important:** you are recording personal communication. Inform meeting participants before recording; this is the user's responsibility. A Vosio installation of your own is required.

## Kontrola proti požadavkům store

| Požadavek | Stav |
|---|---|
| Jediný účel, popis odpovídá chování | splněno (viz výše) |
| Výrazné upozornění před sběrem osobní komunikace | v rozšíření před první nahrávkou (potvrzení nutné), v popisu a v zásadách |
| Zásady ochrany soukromí | `privacy-policy.cs.md`, `privacy-policy.en.md` (publikuje vlastník na veřejné URL) |
| Minimální oprávnění | každé oprávnění odůvodněno v `permissions.md`; širší hostitelé jen jako volitelné a žádané za běhu |
| Žádný vzdálený kód | veškerý kód je v balíčku, žádné `eval`, žádné vzdálené skripty |
| Prohlášení o datech | `data-disclosure.md` |

## Snímky obrazovky (TBD)

Pořídit z dev buildu (1280×800), bez obsahu skutečných schůzek:

1. Popup při rozpoznané schůzce (Zeptat se).
2. Popup během nahrávání (časovač, Zastavit).
3. Nastavení: spárování a režimy.
4. Nastavení: hlídané weby.
5. Čekající nahrávky a „Uloženo ve Vosiu“.
