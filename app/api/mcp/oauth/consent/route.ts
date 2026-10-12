import { proxyMcpOAuth } from "@/lib/mcp/gateway.server";
export const runtime = "nodejs";
// Bind connection-management forms to a secure nonce after verified browser authentication.
export async function GET(request: Request) { return proxyMcpOAuth(request, "consent"); }
// Require same-origin nonce-bound consent or revocation with a current verified actor.
export async function POST(request: Request) { return proxyMcpOAuth(request, "consent"); }
