import { getMcpMetadata, readUpstreamView } from "@/lib/mcp/gateway.server";
import { notFound, redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" as const };

// Approve only this installation's dedicated upstream client and nonce-bound pending actor.
export default async function McpUpstreamConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const config = await getMcpMetadata(); if (!config) notFound();
  const params = await searchParams;
  const details = await readUpstreamView(params.authorization_id ?? "").catch(() => null);
  if (!details) notFound();
  if (details.redirectUrl) redirect(details.redirectUrl);
  return <main className="auth-shell"><section className="auth-card" aria-label="Ověření připojení">
    <div className="auth-heading"><h1>Ověřit připojení</h1><p>Vosio vytvoří pro schváleného klienta samostatné přihlášení. Rozsah přístupu jste vybrali v předchozím kroku.</p></div>
    <form action="/api/mcp/oauth/consent" method="post" className="auth-form">
      <input name="authorizationId" value={details.authorizationId} type="hidden" /><input name="nonce" value={details.nonce} type="hidden" />
      <button name="action" value="upstream_approve" type="submit">Potvrdit připojení</button><button name="action" value="upstream_deny" type="submit">Odmítnout</button>
    </form>
  </section></main>;
}
