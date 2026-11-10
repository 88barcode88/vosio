# Odůvodnění oprávnění (pro formulář store)

Manifest: `extension/manifest.json`. Pro každé oprávnění: co dělá, proč je nutné, co se bez něj stane.

## Oprávnění (`permissions`)

| Oprávnění | Odůvodnění |
|---|---|
| `tabCapture` | Zachycení zvuku karty se schůzkou po kliknutí uživatele na ikonu nebo zkratku. Bez něj nelze nahrát druhou stranu schůzky. |
| `offscreen` | Nahrávání (`MediaRecorder`, `AudioContext`) musí běžet v dokumentu, který existuje po celou schůzku; service worker to neumí. Používá se důvod `USER_MEDIA`. |
| `storage` | Uložení nastavení (režim, vlastní weby, adresa Vosia) a stavu spárování. |
| `unlimitedStorage` | Průběžné lokální ukládání zvuku (desítky MB za hodinu) do IndexedDB, aby se nahrávka neztratila při pádu nebo výpadku sítě. |
| `identity` | `launchWebAuthFlow` pro přihlášení na stránce uživatelova Vosia (OAuth s PKCE). Heslo rozšíření nikdy nevidí. |
| `scripting` | Registrace content scriptu pro vlastní weby, které uživatel sám přidá v nastavení. |
| `tabs` | Čtení URL a stavu aktivní karty pro rozpoznání schůzky a automatické ukončení (zavření karty, odchod z adresy schůzky). Obsah stránek se nečte. |
| `notifications` | Volitelné upozornění „Schůzka zjištěna“ a hlášení „Uloženo ve Vosiu“ / „Je potřeba znovu spárovat“. |
| `alarms` | Opakování odesílání po výpadku sítě a pravidelná kontrola čekajících nahrávek. |

Klávesová zkratka (výchozí Alt+Shift+R) je klíč `commands` v manifestu, nikoli oprávnění.

## Hostitelská oprávnění (`host_permissions`)

| Vzor | Odůvodnění |
|---|---|
| `https://meet.google.com/*` | Rozpoznání schůzky Google Meet (content script čte jen přítomnost tlačítka „Opustit hovor“ a titulek stránky). |
| `https://teams.microsoft.com/*`, `https://teams.live.com/*` | Totéž pro Microsoft Teams web. |
| `https://app.zoom.us/*`, `https://*.zoom.us/wc/*` | Totéž pro Zoom web klient. |

## Volitelná hostitelská oprávnění (`optional_host_permissions: https://*/*`)

Žádají se **až za běhu**, vždy na konkrétní origin a po výslovném kliknutí uživatele:

- origin uživatelova Vosia a jeho serveru (Supabase) při párování – nutné pro načtení OAuth metadat, registraci, výměnu tokenů a nahrání audia (instalace jsou self-hostované, adresu rozšíření předem nezná),
- konkrétní vlastní weby schůzek, které uživatel přidá v nastavení.

Rozšíření neobsahuje adresu žádné konkrétní instalace a nežádá přístup ke všem webům najednou.
