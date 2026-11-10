import Link from "next/link";

// ExtensionDocumentationSection explains in plain language how to install, pair and use the Vosio browser extension for recording online meetings.
export function ExtensionDocumentationSection() {
  return (
    <section className="documentation-section documentation-mcp" id="rozsireni-prohlizece">
      <div>
        <h2>Rozšíření prohlížeče</h2>
        <p>Nahrávání online schůzek jedním kliknutím</p>
      </div>
      <p>
        Rozšíření Vosio pro Chrome a Edge nahraje schůzku v Google Meet, Microsoft Teams nebo Zoomu na webu a uloží ji do Vosia.
        Nemusíte mít Vosio otevřené ani vybírat kartu ke sdílení. Nahrává váš mikrofon i zvuk schůzky.
      </p>
      <h3>Instalace</h3>
      <ul className="documentation-list">
        <li>Z obchodu: najděte Vosio v Chrome Web Store nebo Edge Add-ons a zvolte Přidat.</li>
        <li>Ze zdrojových souborů: v prohlížeči otevřete správu rozšíření, zapněte Režim pro vývojáře, zvolte Načíst nerozbalené a vyberte složku s rozšířením z repozitáře Vosia.</li>
      </ul>
      <h3>Spárování se svým Vosiem</h3>
      <ol className="documentation-steps">
        <li>Otevřete rozšíření a zadejte adresu svého Vosia, tedy tu, kterou otevíráte v prohlížeči (například https://vosio.vase-firma.cz).</li>
        <li>Zvolte Spárovat. Otevře se přihlašovací stránka vašeho Vosia. Heslo zadáváte jen tam, rozšíření ho nikdy nevidí.</li>
        <li>Na stránce souhlasu potvrďte, že rozšíření smí nahrávat. Hotovo.</li>
      </ol>
      <p>
        Rozšíření dostane jen úzké oprávnění: smí založit vaši nahrávku, nahrát do ní zvuk a spustit přepis. Nečte jiné nahrávky,
        nic nemaže a nemění sdílení.
      </p>
      <h3>Režimy a spuštění nahrávání</h3>
      <ul className="documentation-list">
        <li><strong>Automaticky:</strong> jedno kliknutí na ikonu rozšíření (nebo klávesová zkratka) na kartě se schůzkou okamžitě spustí nahrávání mikrofonu i schůzky, bez dalšího dialogu.</li>
        <li><strong>Zeptat se</strong> (výchozí): po kliknutí na ikonu se nejdřív zobrazí potvrzení.</li>
        <li><strong>Vypnuto:</strong> rozšíření schůzky nehlídá a nic nenahrává.</li>
      </ul>
      <p>
        Chrome ani Edge nedovolí nahrát zvuk schůzky bez vašeho zásahu, proto i v režimu Automaticky musíte jednou kliknout na ikonu
        rozšíření nebo použít klávesovou zkratku. Na rozpoznané schůzce se ikona změní, abyste viděli, že je nahrávání připravené.
        Kromě Meet, Teams a Zoomu na webu si v nastavení rozšíření přidáte další weby.
      </p>
      <p>
        Na konci schůzky rozšíření nahrávání samo zastaví, uloží zvuk do Vosia a spustí přepis. Nahrávku můžete zastavit i ručně.
        U dlouhých nahrávek Vosio dokončí přepis, i když ho nemáte otevřené, jen pokud má vaše instalace veřejnou HTTPS adresu.
        Jinak se přepis dokončí, až otevřete detail nahrávky.
      </p>
      <h3>Informujte účastníky</h3>
      <p>
        Před nahráváním schůzky řekněte ostatním účastníkům, že ji nahráváte. Nahrávání rozhovoru bez vědomí účastníků může porušovat
        pravidla vaší firmy nebo zákon.
      </p>
      <h3>Odpojení</h3>
      <p>
        Rozšíření odpojíte v jeho nastavení nebo ve Vosiu v <Link href="/settings#settings-connections">Nastavení v části Připojené aplikace a rozšíření</Link>.
        Po odpojení ve Vosiu rozšíření okamžitě ztratí přístup. Nahrávky, které už ve Vosiu jsou, zůstanou.
      </p>
    </section>
  );
}
