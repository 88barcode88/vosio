import { proxyMcpOAuth } from "@/lib/mcp/gateway.server";
export const runtime = "nodejs";
// Register public clients only when this installation explicitly enables DCR.
export async function POST(request: Request) { return proxyMcpOAuth(request, "register"); }
