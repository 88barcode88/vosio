import { getMcpMetadata } from "@/lib/mcp/gateway.server";
export const dynamic = "force-dynamic";
// Serve the canonical web issuer while publishing the Function token endpoints.
export async function GET() {
  const metadata = await getMcpMetadata();
  if (!metadata) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { resource: _resource, webOrigin: _webOrigin, ...discovery } = metadata;
  return Response.json(discovery, { headers: { "Cache-Control": "no-store" } });
}
