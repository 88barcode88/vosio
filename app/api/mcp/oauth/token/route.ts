import { proxyMcpOAuth } from "@/lib/mcp/gateway.server";
export const runtime = "nodejs";
// Exchange a one-use code or fenced refresh without cookie authentication.
export async function POST(request: Request) { return proxyMcpOAuth(request, "token"); }
