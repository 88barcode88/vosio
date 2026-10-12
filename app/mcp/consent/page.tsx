import { getMcpMetadata, readPendingView } from "@/lib/mcp/gateway.server";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" as const };

// Reuse the approved auth form shell for explicit downstream scope consent.
export default async function McpConsentPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const config = await getMcpMetadata();
  if (!config) notFound();
  const params = await searchParams;
  const details = await readPendingView(params.request).catch(() => null);
  if (!details || details.pending.status !== "pending") notFound();
  return <main className="auth-shell"><section className="auth-card" aria-label="Připojení MCP klienta">
    <div className="auth-heading"><h1>Připojit {details.clientName}</h1><p>Klient získá přístup jen k obsahu, který smíte ve Vosio používat.</p></div>
    <p>Instalace Vosio: {config.webOrigin}</p><p>Cílová adresa klienta: {new URL(details.pending.redirectUri).origin}</p>
    <form action="/api/mcp/oauth/consent" method="post" className="auth-form">
      <input type="hidden" name="pendingId" value={details.pending.id} /><input type="hidden" name="nonce" value={details.nonce} />
      <label><span>Rozsah přístupu</span><select name="access" defaultValue="read"><option value="read">Číst nahrávky, přepisy, výstupy a úkoly</option>{details.pending.scopes.includes("vosio:write") ? <option value="write">Také upravovat názvy, mluvčí a stavy úkolů</option> : null}</select></label>
      <p>Klient nemůže mazat obsah, měnit sdílení ani spouštět AI zpracování. Připojení můžete kdykoliv odebrat.</p>
      <button name="action" value="approve" type="submit">Povolit vybraný přístup</button><button name="action" value="deny" type="submit">Odmítnout</button>
    </form>
  </section></main>;
}
