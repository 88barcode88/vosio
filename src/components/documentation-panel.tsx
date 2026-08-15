import Link from "next/link";

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
      "Upload je určený pro existující audio a MP4 soubory podporované Sonioxem. Výsledný limit aplikace vychází z limitu připojeného Storage bucketu a z volby tarifu Supabase Auto, Free nebo Paid v Nastavení. Live audio může mít nižší zobrazený limit, například Audio do 128 MB + přepis. Globální projektový limit nelze bezpečně zjistit, proto se zobrazuje jako Nezjištěn."
    ],
    id: "nova-nahravka",
    kicker: "Live záznam nebo soubor",
    title: "Nová nahrávka"
  },
  {
    body: [
      "Nahrávky jsou inbox všech uložených callů. Řádek se otevírá kliknutím, název jde upravit samostatně a smazání nejdřív přesune položku do Koše.",
      "U každé položky je vidět stav, zdroj, velikost a datum. Cílem je rychle najít správný call a přejít do detailu bez zbytečných tlačítek navíc.",
      "Vyhledávání na stránce Nahrávky umí prohledat názvy i uložené přepisy. Fulltext vrátí konkrétní úryvek a po otevření přejde na odpovídající místo v přepisu."
    ],
    id: "nahravky",
    kicker: "Seznam a detail callů",
    title: "Nahrávky"
  },
  {
    body: [
      "Přepis vzniká ze Soniox jobu. U uploadu se používá async přepis, u live režimu realtime WebSocket. Detail nahrávky umí kontrolovat dokončení jobu a u rozpracovaného přepisu průběžně polluje stav v otevřeném prohlížeči.",
      "Pokud Soniox vrátí diarizaci, Vosio zobrazí přepis jako řádkovanou tabulku se sloupci čas, mluvčí a text. U mluvčích lze ručně doplnit jméno a roli Klient / Dodavatel / Nepřiřazeno; tyto údaje se uloží k transcriptu a AI je používá jako kontext."
    ],
    id: "prepis",
    kicker: "Soniox, mluvčí a role",
    title: "Přepis"
  },
  {
    body: [
      "AI zpracování patří do detailu konkrétní nahrávky. Nad hotovým transcriptem lze vytvořit shrnutí, úkoly, časovou osu, meeting notes, CRM poznámku nebo follow-up e-mail.",
      "Každé zpracování je samostatný job, takže můžete spustit více výstupů stejného typu. Výstupy se ukládají do Supabase jako rozbalovací karty s náhledem, kopírováním, Markdown exportem a samostatným smazáním."
    ],
    id: "ai-zpracovani",
    kicker: "Co z callu vytěžit",
    title: "AI zpracování"
  },
  {
    body: [
      "Časová osa není technický seznam po sekundách. Vytváří se jako AI výstup, který rozdělí dlouhý hovor na smysluplné kapitoly podle témat, rozhodnutí, úkolů, rizik a změn kontextu.",
      "Když časová osa ještě neexistuje, karta nabízí přechod do AI zpracování. Technické segmenty ze Sonioxu zůstávají zdrojová data pro diarizaci a časování."
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
      "Export je Markdown-first. Z detailu nahrávky lze stáhnout nebo zkopírovat celou nahrávku, pracovní balíček, samotný přepis nebo jeden vybraný AI výstup.",
      "Pracovní balíček spojuje metadata, přepis, AI výstupy a strukturované pracovní položky: checklist úkolů, kapitoly časové osy, rozhodnutí a rizika.",
      "E-mail po hovoru má navíc akci přes mailto, která otevře výchozí mailový handler v prohlížeči nebo systému. Přímé odesílání přes Gmail, Zoho nebo jiný mailbox je budoucí integrace."
    ],
    id: "export",
    kicker: "Kopírování a Markdown",
    title: "Export"
  },
  {
    body: [
      "Nastavení obsahuje netajné uživatelské preference: výchozí AI model, jazyk výstupu, Soniox realtime model, retenci audia a automatické AI výstupy.",
      "Tajné klíče, Supabase service role, Soniox API key, OpenAI API key a volitelný Gemini API key zůstávají pouze ve Vercelu/server-side. Usage část ukazuje orientační AI a Soniox náklady z uložených metadat; fakturační pravda zůstává u provider dashboardů."
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
      "Trvalé smazání z Koše maže databázový řádek i související storage objekt, přepisy, joby a AI výstupy. Proto je tato akce oddělená od běžného smazání."
    ],
    id: "kos",
    kicker: "Bezpečné mazání",
    title: "Koš"
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
export function DocumentationPanel() {
  return (
    <section className="documentation-panel" aria-label="Dokumentace">
      <header className="documentation-header">
        <span>Dokumentace</span>
        <h1>Jak Vosio funguje</h1>
        <p>Praktický přehled obrazovek, workflow a pravidel v aplikaci.</p>
      </header>
      <div className="documentation-start">
        <strong>Začít s prvním callem</strong>
        <p>Nahrajte live záznam nebo soubor, spusťte přepis, potom vytvořte AI výstupy a exportujte pracovní balíček.</p>
        <div>
          <Link href="/recordings/new">Nová nahrávka</Link>
          <Link href="/recordings">Nahrávky</Link>
          <Link href="/settings">Nastavení</Link>
        </div>
      </div>

      <div className="documentation-layout">
        <nav className="documentation-topics" aria-label="Témata dokumentace">
          <span>Témata</span>
          {documentationSections.map((section) => (
            <a href={`#${section.id}`} key={section.id}>
              {section.title}
            </a>
          ))}
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
        </div>
      </div>
    </section>
  );
}
