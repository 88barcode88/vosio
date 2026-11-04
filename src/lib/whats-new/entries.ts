// Static, user-facing release notes for the in-app "Novinky" page: describe only what people see, no technical detail.
export type WhatsNewKind = "new" | "improved" | "fixed";

export type WhatsNewItem = {
  id: string;
  kind: WhatsNewKind;
  /** What the user sees, in one short sentence. */
  title: string;
  /** One or two sentences explaining it. */
  summary: string;
  /** Optional longer explanation shown after expanding the item. */
  detail?: string;
  /** Optional in-app page that shows the change. */
  href?: string;
};

export type WhatsNewRelease = {
  id: string;
  /** Human label of the release, for example a version number or a month. */
  label: string;
  /** Release date written as DD.MM.YYYY. */
  date: string;
  items: WhatsNewItem[];
};

export const WHATS_NEW_KIND_LABELS: Record<WhatsNewKind, string> = {
  new: "Nové",
  improved: "Vylepšené",
  fixed: "Opravené"
};

// Newest release first; the first entry's id drives the "unread" dot in the sidebar.
export const whatsNewReleases: readonly WhatsNewRelease[] = [
  {
    id: "2026-11-04",
    label: "Listopad 2026",
    date: "04.11.2026",
    items: [
      {
        id: "structured-item-copy-delete",
        kind: "new",
        title: "Kopírování a mazání u úkolů, rozhodnutí i rizik",
        summary: "Hned za každou větou je malá ikona kopírování, která zkopíruje jen samotný text. Ikona vedle koše zkopíruje celou položku včetně štítků, dalšího kroku a citace s časem a mluvčím.",
        detail: "Rozhodnutí a rizika teď mají vlastní koš stejně jako úkoly. Smazání odstraní položku i její opakované kopie ze starších AI zpracování; původní AI výstup zůstane uložený.",
        href: "/recordings"
      }
    ]
  },
  {
    id: "2026-11-03",
    label: "Listopad 2026",
    date: "03.11.2026",
    items: [
      {
        id: "mcp-guide",
        kind: "new",
        title: "Návod na připojení AI asistenta",
        summary: "V Dokumentaci najdete postup, jak propojit Claude nebo Codex se svými nahrávkami, včetně bezpečnostních rad.",
        detail: "Asistent může nahrávky číst a, pokud mu to výslovně povolíte, upravovat názvy, mluvčí a stavy úkolů. Nic nemaže a nespouští placené zpracování. Připojení kdykoli odeberete.",
        href: "/documentation#pripojeni-ai-asistenta"
      },
      {
        id: "whats-new-page",
        kind: "new",
        title: "Stránka Novinky",
        summary: "Tady se dozvíte, co se ve Vosiu změnilo. U položky, která se vás týká, rovnou otevřete příslušné místo v aplikaci.",
        detail: "Tečka u položky Novinky v menu zmizí, jakmile stránku otevřete."
      },
      {
        id: "edit-share-dialog",
        kind: "improved",
        title: "Přehlednější okno Upravit a sdílení",
        summary: "V detailu nahrávky pod tlačítkem Upravit a sdílení je název nahoře na jednom řádku s tlačítkem Uložit, pod ním zařazení, štítky a sdílení. Každá část se ukládá zvlášť.",
        href: "/recordings"
      },
      {
        id: "retranscribe-in-header",
        kind: "improved",
        title: "Přepsat znovu vedle ostatních akcí",
        summary: "Tlačítko Přepsat znovu je v detailu nahrávky nahoře v jedné řadě s Upravit a sdílení, Export a Smazat. U hotového přepisu už pod ním nesvítí zbytečná hláška o stavu.",
        href: "/recordings"
      },
      {
        id: "checklist-delete-all",
        kind: "improved",
        title: "Smazat celý checklist maže všechno",
        summary: "Tlačítko Smazat celý checklist odstraní najednou úkoly, rozhodnutí i blokery daného přepisu. Před smazáním uvidíte, kolik čeho zmizí.",
        detail: "Původní AI výstupy, zápisy, shrnutí, časová osa, nahrávka a přepis zůstanou.",
        href: "/recordings"
      },
      {
        id: "chat-new-look",
        kind: "improved",
        title: "Přehlednější chat nad přepisem",
        summary: "Chat má úvodní návrhy otázek, čitelnější odpovědi s klikacími časy do přepisu a jedno pole pro psaní s výběrem modelu.",
        detail: "Návrh otázky se po kliknutí jen vloží do pole, odešlete ho sami.",
        href: "/recordings"
      },
      {
        id: "audio-download",
        kind: "new",
        title: "Stažení audia",
        summary: "Na záložce Soubory v detailu nahrávky stáhnete původní audio tlačítkem Stáhnout audio. Soubor se uloží pod názvem nahrávky.",
        detail: "Audio uložené po částech zatím jako jeden soubor stáhnout nejde, přehrajete ho ale v přehrávači.",
        href: "/recordings"
      },
      {
        id: "detail-tabs-tidy",
        kind: "improved",
        title: "Úhlednější záložky v detailu",
        summary: "Jména a role mluvčích jsou zarovnané s poli, časová osa má víc místa u časů a mluvčích, tlačítka u uložených AI výstupů jsou pohromadě a načítání se ukáže na jednom řádku."
      },
      {
        id: "rename-after-live",
        kind: "new",
        title: "Pojmenování hned po uložení živé nahrávky",
        summary: "Po uložení živé nahrávky vás detail rovnou vyzve k pojmenování. Vygenerovaný název stačí přepsat, nebo zvolte Později."
      },
      {
        id: "unsaved-changes-question",
        kind: "improved",
        title: "Neuložené změny se neztratí",
        summary: "Když zavíráte Název a zařazení s neuloženou změnou, aplikace se zeptá, jestli ji uložit, zahodit, nebo pokračovat v úpravách."
      },
      {
        id: "row-menu-closes",
        kind: "fixed",
        title: "Nabídka … u nahrávky se zavírá sama",
        summary: "Nabídka u řádku v seznamu se zavře kliknutím jinam, klávesou Escape nebo otevřením nabídky jiné nahrávky, takže se už nepřekrývá víc nabídek."
      },
      {
        id: "bulk-trash",
        kind: "new",
        title: "Více nahrávek najednou do Koše",
        summary: "Zaškrtněte nahrávky v seznamu a v liště výběru klikněte na Do koše. Přesunout jde i nahrávky, které jsou už sdílené.",
        href: "/recordings"
      },
      {
        id: "detail-header-two-lines",
        kind: "improved",
        title: "Klidnější hlavička detailu nahrávky",
        summary: "Název je na vlastním řádku a datum, délka, velikost a zdroj hned pod ním, takže tlačítka akcí zůstanou vedle a hlavička neposkakuje."
      },
      {
        id: "detail-actions-stay-put",
        kind: "fixed",
        title: "Tlačítka v detailu nahrávky už neuskočí",
        summary: "Po kliknutí na Spustit přepis nebo Přepsat znovu zůstanou tlačítka v hlavičce detailu na svém místě; zpráva o stavu přepisu se objeví pod nimi."
      },
      {
        id: "settings-clearer",
        kind: "improved",
        title: "Přehlednější Nastavení",
        summary: "Nastavení má vlevo obsah sekcí, užší a lépe uspořádané bloky a lištu u spodního okraje, která ukáže neuložené změny, chybu i potvrzení uložení.",
        detail: "Změna hesla je schovaná pod tlačítkem Změnit heslo. Automatické výstupy po přepisu jsou seskupené vedle výběru AI modelu. V části Jazyk a přepis vidíte, jaký model Soniox se používá pro živý přepis a pro nahrané soubory. Motiv přepnete tlačítky Světlý a Tmavý; heslo a motiv se ukládají hned, ostatní volby tlačítkem Uložit nastavení, které můžete i zrušit.",
        href: "/settings"
      },
      {
        id: "recordings-sort-columns",
        kind: "new",
        title: "Řazení a přehlednější seznam nahrávek",
        summary: "Seznam nahrávek seřadíte podle klienta, od nejnovějších, od nejstarších, podle názvu nebo délky. Název, datum, typ, délka, klient, projekt a stav mají každý svůj sloupec, takže řádky jsou nižší.",
        href: "/recordings"
      },
      {
        id: "soniox-v6",
        kind: "improved",
        title: "Přesnější přepis",
        summary: "Přepis souborů i živé nahrávání používá nejnovější model Soniox v6 s vyšší přesností a lepším rozpoznáním mluvčích. Uložené nastavení živého přepisu se převede samo.",
        href: "/settings"
      },
      {
        id: "project-sharing-hint",
        kind: "improved",
        title: "Srozumitelnější sdílení s projektem",
        summary: "Volba se jmenuje Členové projektu. Dokud nahrávka nemá projekt, okno vysvětlí, že ji nejdřív přiřadíte k projektu v Zařazení.",
        href: "/recordings"
      },
      {
        id: "consistent-look",
        kind: "improved",
        title: "Sjednocený vzhled",
        summary: "Písmo, tlačítka a ikony mají na všech stránkách stejnou velikost i styl, takže se aplikace lépe čte a ovládá.",
        detail: "Tlačítka, která dřív vypadala jako obyčejná šedá, mají nově stejný vzhled jako ostatní."
      },
      {
        id: "smaller-account",
        kind: "improved",
        title: "Menší karta účtu v menu",
        summary: "Karta s vaším účtem dole v postranním menu zabírá méně místa a e-mail se vejde na jeden řádek."
      },
      {
        id: "roles",
        kind: "improved",
        title: "Role se všude jmenují stejně",
        summary: "Oprávnění se při sdílení a v týmu jmenují „Úpravy“ a „Čtení“ na všech místech."
      },
      {
        id: "faster-lists",
        kind: "improved",
        title: "Rychlejší nahrávky a seznam",
        summary: "Seznam nahrávek a detail se otevírají svižněji, i když máte nahrávek hodně.",
        href: "/recordings"
      },
      {
        id: "chat-citations",
        kind: "new",
        title: "Klikací zdroje v odpovědích chatu",
        summary: "Odpověď chatu ukáže, z které části přepisu vychází. Kliknutím skočíte přímo na to místo."
      },
      {
        id: "chat-keeps-state",
        kind: "fixed",
        title: "Chat si pamatuje rozepsané",
        summary: "Načtená historie i rozepsaná zpráva zůstanou, když přepnete záložku. Otázka se ukáže hned a čeká na odpověď s tečkami."
      },
      {
        id: "player-steady",
        kind: "fixed",
        title: "Přehrávač a přepis už neposkakují",
        summary: "Při načítání, kontrole nebo chybě zůstává místo pro stavové hlášky, takže se záložky a chat nepřesouvají."
      },
      {
        id: "unfinished-recordings",
        kind: "fixed",
        title: "Bezpečnější práce s nedokončenými nahrávkami",
        summary: "Starou nedokončenou nahrávku můžete doplnit z uložené kopie v prohlížeči. Smazání kopie a přesun nahrávky do Koše jsou dvě oddělené akce s potvrzením."
      },
      {
        id: "sharing-keeps-choice",
        kind: "fixed",
        title: "Sdílení si pamatuje výběr",
        summary: "Když sdílení nedoběhne, vybrané nahrávky i lidé zůstanou zachované, i když mezitím změníte filtr nebo seznam."
      }
    ]
  },
  {
    id: "2026-10-12",
    label: "Verze 0.3.2",
    date: "12.10.2026",
    items: [
      {
        id: "live-transcript-connect",
        kind: "fixed",
        title: "Živý přepis se připojuje spolehlivěji",
        summary: "Živý přepis se při zahájení nahrávání připojí bez zbytečných výpadků."
      }
    ]
  },
  {
    id: "2026-09-05",
    label: "Verze 0.3.1",
    date: "05.09.2026",
    items: [
      {
        id: "new-look",
        kind: "improved",
        title: "Nový světlý i tmavý vzhled",
        summary: "Celá aplikace dostala klidný světlý a grafitový tmavý režim s přehlednějšími panely, na telefonu i na počítači."
      },
      {
        id: "focus-and-touch",
        kind: "fixed",
        title: "Pohodlnější ovládání",
        summary: "Výraznější zvýraznění vybraného prvku, větší plochy pro prsty a podpora zvětšeného textu."
      }
    ]
  },
  {
    id: "2026-09-04-v0.2.1",
    label: "Verze 0.2.1",
    date: "04.09.2026",
    items: [
      {
        id: "call-tab-audio",
        kind: "new",
        title: "Nahrávání hovoru z karty prohlížeče",
        summary: "Mikrofon se smíchá se zvukem vybrané karty s hovorem, takže zachytíte obě strany."
      }
    ]
  },
  {
    id: "2026-09-04-v0.2.0",
    label: "Verze 0.2.0",
    date: "04.09.2026",
    items: [
      {
        id: "live-modes",
        kind: "new",
        title: "Režimy živého nahrávání",
        summary: "Nahrávejte jen audio, jen živý přepis, nebo obojí s automatickou zálohou. V Nastavení zvolíte kvalitu zvuku a uvidíte odhad velikosti hodinové nahrávky."
      },
      {
        id: "crash-recovery",
        kind: "new",
        title: "Obnova po zavření stránky",
        summary: "Když se nahrávání přeruší, uložené části se dají obnovit a znovu odeslat."
      },
      {
        id: "ai-background",
        kind: "improved",
        title: "AI výstupy běží na pozadí",
        summary: "Spuštěné AI zpracování se nepřeruší navigací a hotový výsledek najdete i po návratu na stránku."
      }
    ]
  }
];

// getLatestWhatsNewId returns the id that marks "everything seen" for the sidebar dot.
export function getLatestWhatsNewId(releases: readonly WhatsNewRelease[] = whatsNewReleases): string {
  return releases[0]?.id ?? "";
}
