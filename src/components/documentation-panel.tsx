import Link from "next/link";
import { McpDocumentationSection } from "@/components/documentation-mcp-section";

type DocumentationSection = {
  body: string[];
  id: string;
  kicker: string;
  title: string;
};

const documentationSections: DocumentationSection[] = [
  {
    body: [
      "Vosio je pracovní audio workspace pro nahrávání, přepis a vytěžení callů. Hlavní objekt je vždy nahrávka: buď vznikne živě v aplikaci, nebo ji vložíte jako soubor z telefonu či počítače.",
      "Aplikace ukládá audio a metadata do Supabase, přepis zpracovává přes Soniox a nad hotovým transcriptem vytváří AI výstupy jako shrnutí, úkoly, meeting notes, CRM poznámku, časovou osu nebo follow-up e-mail."
    ],
    id: "o-aplikaci",
    kicker: "Jak Vosio funguje jako celek",
    title: "O aplikaci"
  },
  {
    body: [
      "Na stránce Nová nahrávka jsou dvě hlavní cesty: Nahrávat live a Nahrát soubor. Live režim ukládá audio a přepis, nebo jen textový live přepis bez audio zálohy; pro live audio platí samostatná ochranná politika.",
      "Pro videohovor vyberte v nabídce sdílení konkrétní kartu prohlížeče s hovorem a zapněte sdílení jejího zvuku. Sdílení celého okna nebo obrazovky pro tento režim nestačí. Vosio spojí zvuk karty s mikrofonem.",
      "Upload je určený pro existující audio a MP4 soubory podporované Sonioxem. Výsledný limit aplikace vychází z limitu připojeného Storage bucketu a z volby tarifu Supabase Auto, Free nebo Paid v Nastavení. Live audio může mít nižší zobrazený limit, například Audio do 128 MB + přepis. Globální projektový limit nelze bezpečně zjistit, proto se zobrazuje jako Nezjištěn."
    ],
    id: "nova-nahravka",
    kicker: "Live záznam nebo soubor",
    title: "Nová nahrávka"
  },
  {
    body: [
      "Nahrávky jsou inbox všech uložených callů. Řádek se otevírá kliknutím, název jde upravit samostatně a smazání nejdřív přesune položku do Koše.",
      "V detailu nahrávky je název na vlastním řádku a hned pod ním datum, délka, velikost a zdroj; tlačítka akcí jsou vedle, na užší obrazovce pod nimi.",
      "Seznam má samostatné sloupce Název, Datum, Typ, Délka, Klient, Projekt a Stav. Na užším okně se Typ a Klient schovají, na telefonu se datum a typ ukážou pod názvem.",
      "Vedle počtů podle stavu zvolíte řazení: Podle klienta (výchozí, skupiny podle klienta), Nejnovější, Nejstarší, Název A–Z nebo Nejdelší. Řazení se pamatuje v adrese stránky spolu s filtry.",
      "Export, úprava názvu a zařazení nahrávky se rozbalují přímo v detailu. Přehrávač začíná jako malý řádek s přehráváním a rozbalením. Rozbalení ukáže posun v audiu; sbalení ani přepnutí záložky přehrávání nepřeruší. Na mobilu zůstává přehrávač nahoře v detailu a nezakrývá spodní navigaci.",
      "Vyhledávání na stránce Nahrávky umí prohledat názvy i uložené přepisy. Fulltext vrátí konkrétní úryvek a po otevření přejde na odpovídající místo v přepisu.",
      "V nabídce nahrávky otevřete Název a zařazení. Název a zařazení mají vlastní tlačítka Uložit; uložení jedné části neuloží druhou. Klient a Projekt se v seznamu zobrazují odděleně.",
      "Když okno Název a zařazení zavíráte s neuloženou změnou, zeptá se: Uložit a zavřít, Zahodit změny, nebo Pokračovat v úpravách. Nabídka … u řádku se zavře kliknutím jinam, klávesou Escape nebo otevřením nabídky jiné nahrávky.",
      "Po uložení živé nahrávky se otevře její detail a hned nabídne pojmenování; vygenerovaný název stačí přepsat a uložit, nebo zvolit Později."
    ],
    id: "nahravky",
    kicker: "Seznam a detail callů",
    title: "Nahrávky"
  },
  {
    body: [
      "Přepis vzniká ze Soniox jobu. U uploadu se používá async přepis (model Soniox v6), u live režimu realtime WebSocket s modelem zvoleným v Nastavení (výchozí Soniox realtime v6). Detail nahrávky umí kontrolovat dokončení jobu a u rozpracovaného přepisu průběžně polluje stav v otevřeném prohlížeči.",
      "Pokud Soniox vrátí diarizaci, Vosio zobrazí přepis jako řádkovanou tabulku se sloupci čas, mluvčí a text. U mluvčích lze ručně doplnit jméno a roli Klient / Dodavatel / Nepřiřazeno; tyto údaje se uloží k transcriptu a AI je používá jako kontext."
    ],
    id: "prepis",
    kicker: "Soniox, mluvčí a role",
    title: "Přepis"
  },
  {
    body: [
      "AI zpracování patří do detailu konkrétní nahrávky. Nad hotovým transcriptem lze vytvořit shrnutí, úkoly, časovou osu, meeting notes, CRM poznámku nebo follow-up e-mail.",
      "Každé zpracování je samostatný job, takže můžete spustit více výstupů stejného typu. Výstupy se ukládají do Supabase jako rozbalovací karty s náhledem, kopírováním, Markdown exportem a samostatným smazáním.",
      "U každého úkolu, rozhodnutí a rizika je hned za větou malá ikona kopírování pro samotný text. Ikona kopírování vedle koše zkopíruje celou položku i se štítky, dalším krokem a citací (čas a mluvčí). Koš smaže položku i její opakované kopie ze starších AI zpracování, původní AI výstup zůstává uložený."
      ,"V Nastavení můžete každý ze šesti automatických výstupů zapnout samostatně. Výchozí stav je vypnuto; dříve výslovně zapnutá časová osa zůstává zapnutá. Volby platí při novém dokončení přepisu včetně importu textu a obnovy rozpracovaného záznamu. Starší přepisy se zpětně nezpracovávají."
      ,"Vybrané výstupy vznikají nezávisle. Selhání jednoho nezastaví ostatní; stav a hotové výsledky se v otevřené AI nebo Časové ose aktualizují průběžně. Přerušené automatické zpracování lze obnovit jen omezeným počtem pokusů. Zavření prohlížeče ani ukončení serveru nezaručuje dokončení; další otevření AI nebo Časové osy zkontroluje uloženou práci. Smazání hotového výstupu automatické zpracování znovu nespustí."
    ],
    id: "ai-zpracovani",
    kicker: "Co z callu vytěžit",
    title: "AI zpracování"
  },
  {
    body: [
      "Časová osa není technický seznam po sekundách. Vytváří se jako AI výstup, který rozdělí dlouhý hovor na smysluplné kapitoly podle témat, rozhodnutí, úkolů, rizik a změn kontextu.",
      "Prázdná karta nabízí vytvoření časové osy přímo na místě. Časovou osu lze také zapnout mezi automatickými výstupy pro budoucí dokončené přepisy. Každé nové dokončení má nejvýše jeden automatický výstup daného typu a používá v tu chvíli uložený výchozí model a vlastní úpravu promptu."
    ],
    id: "casova-osa",
    kicker: "Obsahové kapitoly hovoru",
    title: "Časová osa"
  },
  {
    body: [
      "AI prompty jsou instrukce za šesti existujícími AI tlačítky. Uživatel upravuje pouze text; název, typ výstupu a JSON schéma zůstávají systémové a pouze ke čtení.",
      "Upravený text se automaticky použije pod stejným tlačítkem. Obnovení výchozího nastavení deaktivuje úpravu, ale nemění starší uložené AI výstupy ani jejich auditní údaje."
    ],
    id: "prompty",
    kicker: "Systémové základy a vlastní text",
    title: "AI prompty"
  },
  {
    body: [
      "Tým najdete v hlavní navigaci, na mobilu pod Více. Je dostupný správci instalace a zakladateli projektu. Zakladatel spravuje lidi a pozvánky svých projektů; role správce sama nezpřístupňuje obsah cizích nahrávek.",
      "Vyberte člověka a přidělte mu přístup k nahrávce, projektu, klientovi nebo složce. Nového člověka pozvěte e-mailem. Čekající pozvánka ještě neuděluje přístup.",
      "V Upravit a sdílení máte tři volby: Soukromá, Vybraní lidé a Členové projektu. Členové projektu dostanou nahrávku včetně těch, kdo do projektu přibudou později. Volba je dostupná až po přiřazení nahrávky k projektu v části Zařazení.",
      "Sdílení klienta nebo složky zahrnuje současné i budoucí nesoukromé nahrávky v uvedeném rozsahu. Soukromé nahrávky se vždy vynechají. Při odebrání potvrzujete jednu cestu přístupu; další platné přístupy zůstávají v detailu viditelné."
    ],
    id: "tym",
    kicker: "Lidé, pozvánky a přístupy",
    title: "Tým"
  },
  {
    body: [
      "Export je Markdown-first. Z detailu nahrávky lze stáhnout nebo zkopírovat celou nahrávku, pracovní balíček, samotný přepis nebo jeden vybraný AI výstup.",
      "Pracovní balíček spojuje metadata, přepis, AI výstupy a strukturované pracovní položky: checklist úkolů, kapitoly časové osy, rozhodnutí a rizika.",
      "Původní audio stáhnete v detailu nahrávky na záložce Soubory tlačítkem Stáhnout audio. Audio uložené po částech zatím jako jeden soubor stáhnout nejde; přehrajete ho v přehrávači.",
      "E-mail po hovoru má navíc akci přes mailto, která otevře výchozí mailový handler v prohlížeči nebo systému. Přímé odesílání přes Gmail, Zoho nebo jiný mailbox je budoucí integrace."
    ],
    id: "export",
    kicker: "Kopírování a Markdown",
    title: "Export"
  },
  {
    body: [
      "Nastavení obsahuje netajné uživatelské preference. Na širší obrazovce je vlevo obsah sekcí, na telefonu řada odkazů nahoře. Pod výběrem výchozího AI modelu je vysvětlení Model a kvalita; pomáhá zvolit rychlost, cenu a míru kontroly výsledku.",
      "V části Účet je tlačítko Změnit heslo. Po rozbalení vyžaduje současné heslo, nové heslo (alespoň 8 znaků) a potvrzení; heslo se uloží hned a do nastavení se neukládá.",
      "Lišta u spodního okraje ukazuje, jestli máte neuložené změny, jestli uložení selhalo (změny zůstanou ve formuláři) nebo jestli je vše uložené. Zrušit změny vrátí formulář do uloženého stavu. Motiv (Světlý nebo Tmavý) se uloží hned v tomto prohlížeči.",
      "Jazyk a přepis ukazuje použitý model Soniox pro živý přepis i pro nahrané soubory. Model pro soubory nastavuje správce instalace; pokud je neplatný, Nastavení na to upozorní.",
      "Automatické výstupy mají šest samostatných voleb: shrnutí, úkoly, zápis ze schůzky, CRM poznámka, navazující e-mail a časová osa. Když jsou všechny vypnuté, AI se samo nespustí. Vysvětlení live přepisu je viditelné přímo u nastavení. Technické informace mají vlastní sbalenou část; Diagnostika a využití zachovává podrobnosti pod Více informací."
      ,"Pro budoucí položky v Koši můžete zvolit 24 hodin, 7 dní nebo 30 dní. Výchozí volba je 30 dní a změna nemění termín položek, které už v Koši jsou. Usage ukazuje orientační AI a Soniox náklady; skutečné vyúčtování najdete u poskytovatelů."
    ],
    id: "nastaveni",
    kicker: "Preference a usage",
    title: "Nastavení"
  },
  {
    body: [
      "Odkaz Kup mi kafe je dobrovolná podpora vývoje. Není to platba za používání aplikace, neodemyká funkce a není potřeba pro provoz vlastního nasazení.",
      "Tlačítko otevírá externí Stripe Donate stránku autora. Vosio kvůli tomu nepotřebuje žádný další klíč ve Vercelu a samotná aplikace přes tento odkaz nezpracovává platební údaje."
    ],
    id: "kup-mi-kafe",
    kicker: "Dobrovolná podpora autora",
    title: "Kup mi kafe"
  },
  {
    body: [
      "Smazání nahrávky z hlavního seznamu je soft-delete. Položka zmizí z Nahrávek a objeví se v Koši, kde ji lze ještě zkontrolovat.",
      "Více nahrávek najednou přesunete zaškrtnutím v seznamu a tlačítkem Do koše v liště výběru (nejvýše 100). Nahrávky, které smazat nesmíte, zůstanou vybrané; ty, které se nepodaří přesunout, také zůstanou vybrané a můžete to zkusit znovu.",
      "Ruční trvalé smazání je dostupné ihned po přesunu do Koše, bez ohledu na zvolený automatický termín. Automatický termín se při přesunu uloží ke konkrétní nahrávce a ukáže se u ní v Koši.",
      "Automatické čištění je v repozitáři zatím pouze připravený zdrojový postup: není nasazen ani aktivní.",
      "Trvalé smazání maže databázový řádek i související storage objekt, přepisy, joby a AI výstupy. Proto je tato akce oddělená od běžného smazání."
    ],
    id: "kos",
    kicker: "Bezpečné mazání",
    title: "Koš"
  },
  {
    body: [
      "Stránka Novinky v menu vysvětluje, co se ve Vosiu změnilo, a to jen z pohledu toho, co uvidíte. Změny můžete filtrovat podle druhu (Nové, Vylepšené, Opravené) a rozbalit podrobnosti. U položek s odkazem Ukázat v aplikaci se rovnou otevře příslušná stránka.",
      "Tečka u položky Novinky v menu znamená, že jste novinky ještě neotevřeli. Zmizí po otevření stránky."
    ],
    id: "novinky",
    kicker: "Co je nového",
    title: "Novinky"
  },
  {
    body: [
      "Vosio je PWA, takže se na mobilu dá používat přes browser a instalovat jako aplikace. Mobilní režim je online-first, protože uploady, auth session a stavy přepisů musí být aktuální.",
      "Výsledný limit aplikace vychází z limitu aktuálně připojeného Storage bucketu a z volby tarifu Supabase Auto, Free nebo Paid v Nastavení. U live audia aplikace ukazuje vyřešený limit, například Audio do 128 MB + přepis, a ukládání audia ukončí s bezpečnostní rezervou, zatímco přepis pokračuje. Globální projektový limit nelze bezpečně zjistit a aplikace ho zobrazuje jako Nezjištěn."
    ],
    id: "mobil-limity",
    kicker: "Telefon, PWA a limity",
    title: "Mobil a limity"
  }
];

// DocumentationPanel renders the in-app manual for the current Vosio workflows.
export function DocumentationPanel({ mcpResourceUrl = null }: { mcpResourceUrl?: string | null }) {
  return (
    <section className="documentation-panel" data-utility-surface="documentation" aria-label="Dokumentace">
      <header className="documentation-header">
        <span>Dokumentace</span>
        <h1>Jak Vosio funguje</h1>
        <p>Praktický přehled obrazovek, workflow a pravidel v aplikaci.</p>
      </header>
      <div className="documentation-layout">
        <nav className="documentation-topics" aria-label="Témata dokumentace">
          <span>Témata</span>
          {documentationSections.map((section) => (
            <a href={`#${section.id}`} key={section.id}>
              {section.title}
            </a>
          ))}
          <a href="#pripojeni-ai-asistenta">Připojení AI asistenta</a>
        </nav>

        <div className="documentation-content">
          {documentationSections.map((section) => (
            <section className="documentation-section" id={section.id} key={section.id}>
              <div>
                <h2>{section.title}</h2>
                <p>{section.kicker}</p>
              </div>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
          <McpDocumentationSection resourceUrl={mcpResourceUrl} />
          <p className="documentation-more"><Link href="/whats-new">Otevřít Novinky</Link></p>
        </div>
      </div>
    </section>
  );
}
