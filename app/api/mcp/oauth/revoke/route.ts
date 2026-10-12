import { proxyMcpOAuth } from "@/lib/mcp/gateway.server";
export const runtime = "nodejs";
// Revoke the matching opaque token family without exposing whether it exists.
export async function POST(request: Request) { return proxyMcpOAuth(request, "revoke"); }
