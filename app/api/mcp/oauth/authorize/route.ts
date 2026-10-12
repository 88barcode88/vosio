import { proxyMcpOAuth } from "@/lib/mcp/gateway.server";
export const runtime = "nodejs";
// Start only a nonce-bound authorization after strict client and redirect validation.
export async function GET(request: Request) { return proxyMcpOAuth(request, "authorize"); }
