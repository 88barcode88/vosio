import Link from "next/link";

// McpDocumentationSection explains in plain language how to connect an AI assistant; the address appears only when this installation has MCP enabled.
export function McpDocumentationSection({ resourceUrl }: { resourceUrl: string | null }) {
  return (
    <section className="documentation-section documentation-mcp" id="pripojeni-ai-asistenta">
      <div>
        <h2>Připojení AI asistenta</h2>
        <p>Claude nebo Codex s vašimi nahrávkami</p>
      </div>
      <p>
        AI asistent v Claude nebo Codexu může číst vaše nahrávky, přepisy, výstupy a úkoly. Pokud mu to při připojení
        výslovně povolíte, může také upravovat názvy, jména mluvčích a stavy úkolů. Nahrávky nemaže, nemění sdílení
        a nespouští placené AI zpracování. Vidí jen to, co smíte vidět vy.
      </p>
      {resourceUrl ? (
        <>
          <p>Adresa pro připojení této instalace Vosia:</p>
          <p><code className="documentation-mcp-address">{resourceUrl}</code></p>
          <ol className="documentation-steps">
            <li>V Claude nebo Codexu přidejte vlastní konektor (vlastní MCP server) a vložte adresu výše. V Claude Code ji zadáte příkazem <code>claude mcp add --transport http vosio {resourceUrl}</code>.</li>
            <li>Otevře se přihlašovací stránka Vosia. Přihlaste se svým obvyklým účtem.</li>
            <li>Na stránce souhlasu vyberte, co asistent smí: číst, nebo číst a upravovat. Pak přístup potvrďte.</li>
            <li>Vraťte se do Claude nebo Codexu. Asistent teď vidí vaše nahrávky a můžete se ho na ně ptát.</li>
          </ol>
          <p>
            Přehled připojení a jejich odebrání najdete na stránce <Link href="/mcp/connections">Připojení AI asistentů</Link>.
            Po odebrání asistent okamžitě ztratí přístup.
          </p>
        </>
      ) : (
        <p>V této instalaci není připojení AI asistentů zapnuté.</p>
      )}
      <h3>Bezpečnost</h3>
      <ul className="documentation-list">
        <li>Samotná adresa nic neodemyká. K nahrávkám se asistent dostane až po vašem přihlášení a souhlasu.</li>
        <li>Vosio vás nikdy nepožádá o heslo ani klíč jinde než na své přihlašovací stránce.</li>
        <li>Žádné klíče ani tokeny nikam nekopírujte. Připojení je nepotřebuje.</li>
        <li>Máte podezření, že se připojil někdo cizí, nebo už asistenta nepoužíváte? Připojení odeberte.</li>
      </ul>
    </section>
  );
}
