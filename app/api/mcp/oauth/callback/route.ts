import { proxyMcpOAuth } from "@/lib/mcp/gateway.server";
export const runtime = "nodejs";
// Claim the approved browser-bound request before exchanging upstream OAuth credentials.
export async function GET(request: Request) { return proxyMcpOAuth(request, "callback"); }
