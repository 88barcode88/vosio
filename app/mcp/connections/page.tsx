import { getMcpMetadata, readConnectionsView, MCP_NONCE_COOKIE } from "@/lib/mcp/gateway.server";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" as const };

// List bounded own connection metadata and offer only actor-scoped revocation.
export default async function McpConnectionsPage() {
  const config = await getMcpMetadata(); if (!config) notFound();
  if (!(await cookies()).get(MCP_NONCE_COOKIE)) redirect("/api/mcp/oauth/consent?connections=1");
  const browser = await readConnectionsView().catch(() => null); if (!browser) notFound();
  return <main className="auth-shell"><section className="auth-card" aria-label="Připojení MCP">
    <div className="auth-heading"><h1>Připojení MCP</h1><p>Odebrání připojení zablokuje další požadavky klienta.</p></div>
    {!browser.connections.length ? <p>Nemáte žádná aktivní připojení.</p> : browser.connections.map((item: { id: string; clientName: string; scopes: string[] }) => <form action="/api/mcp/oauth/consent" method="post" className="auth-form" key={item.id}>
      <p>{item.clientName} · {item.scopes.includes("vosio:write") ? "Čtení a úpravy" : "Čtení"}</p>
      <input name="grantId" value={item.id} type="hidden" /><input name="nonce" value={browser.nonce} type="hidden" /><button name="action" value="revoke" type="submit">Odebrat připojení</button>
    </form>)}
    <Link href="/settings">Zpět do nastavení</Link>
  </section></main>;
}
