import "server-only";
import { loadMcpConfig, type McpConfig } from "./config.server";
import { runMcpRequest } from "./request-context.server";
import { authenticateMcpRequest, McpAuthError } from "./auth.server";
import { handleMcpProtocol } from "./protocol.server";
import { browserIdentity, handleMcpOAuth, readBrowserPending, upstreamConsentDetails } from "./oauth.server";
import { readAuthorizedAudioChunk } from "./audio.server";

// Advertise only public discovery information; custody and runtime secrets stay in the Function.
export function mcpMetadata(config: McpConfig) {
  const base = `${config.origin}/api/mcp/oauth`;
  return { resource: config.resourceUrl, webOrigin: config.origin, issuer: config.issuer,
    authorization_endpoint: `${base}/authorize`, token_endpoint: `${config.resourceUrl}/oauth/token`, revocation_endpoint: `${config.resourceUrl}/oauth/revoke`,
    ...(config.dcrEnabled ? { registration_endpoint: `${config.resourceUrl}/oauth/register` } : {}),
    scopes_supported: ["vosio:read", "vosio:write"], response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"] };
}

// Return only nonce-bound page models, never pending ciphertext, session objects or secrets.
async function browserView(config: McpConfig, url: URL) {
  const view = url.pathname.split("/").at(-1);
  if (view === "pending") {
    const details = await readBrowserPending(config, url.searchParams.get("request") ?? undefined);
    return Response.json({ nonce: details.nonce, clientName: details.clientName, pending: { id: details.pending.id, status: details.pending.status, redirectUri: details.pending.redirectUri, scopes: details.pending.scopes } });
  }
  if (view === "upstream") {
    const details = await upstreamConsentDetails(config, url.searchParams.get("authorization_id") ?? "");
    return Response.json({ nonce: details.nonce, authorizationId: details.authorizationId, redirectUrl: details.redirectUrl });
  }
  if (view === "connections") {
    const details = await browserIdentity(config);
    const result = await details.session.rpc("mcp_list_own_connections_v1").abortSignal(AbortSignal.timeout(15000));
    if (result.error || !Array.isArray(result.data) || result.data.length > 50) throw new Error("Unavailable");
    return Response.json({ nonce: details.nonce, connections: result.data });
  }
  return new Response(null, { status: 404 });
}

// Dispatch a single Function using canonical configured URLs, never forwarded host headers.
export async function handleMcpEdge(request: Request) {
  const config = await loadMcpConfig();
  if (!config) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const incoming = new URL(request.url);
  // Supabase gateways strip /functions/v1; direct local runtime tests may retain it.
  const prefix = ["/functions/v1/vosio-mcp", "/vosio-mcp"].find((path) => incoming.pathname === path || incoming.pathname.startsWith(`${path}/`));
  if (!prefix) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const suffix = incoming.pathname.slice(prefix.length);
  const canonical = new Request(`${config.resourceUrl}${suffix}${incoming.search}`, request);
  return runMcpRequest(canonical, config, async () => {
    let response: Response;
    try {
      if (request.method === "GET" && suffix === "/metadata") response = Response.json(mcpMetadata(config));
      else if (request.method === "GET" && suffix === "/resource-metadata") response = Response.json({ resource: config.resourceUrl, authorization_servers: [config.issuer], scopes_supported: ["vosio:read", "vosio:write"], bearer_methods_supported: ["header"] });
      else if (request.method === "GET" && /^\/browser\/(pending|upstream|connections)$/.test(suffix)) response = await browserView(config, new URL(canonical.url));
      else if (/^\/oauth\/(authorize|callback|consent|token|revoke|register)$/.test(suffix)) {
        const action = suffix.split("/").at(-1)! as Parameters<typeof handleMcpOAuth>[1];
        const allowed = action === "authorize" || action === "callback" ? ["GET"] : action === "consent" ? ["GET", "POST"] : ["POST"];
        response = allowed.includes(request.method) ? await handleMcpOAuth(new Request(`${config.origin}/api/mcp${suffix}${incoming.search}`, canonical), action) : new Response(null, { status: 405 });
      } else if (suffix === "") response = await handleMcpProtocol(canonical, authenticateMcpRequest);
      else if (request.method === "GET" && /^\/audio\/[a-f0-9-]+$/i.test(suffix)) {
        const identity = await authenticateMcpRequest(canonical);
        if (incoming.search || request.headers.has("origin") && request.headers.get("origin") !== new URL(config.resourceUrl).origin) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
        const value = request.headers.get("range"); const range = value ? /^bytes=(\d+)-(\d*)$/.exec(value) : null;
        const start = range ? Number(range[1]) : 0; const end = range?.[2] ? Number(range[2]) : start + 1_048_575;
        if (value && !range || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start + 1 > 1_048_576) return new Response(null, { status: 416, headers: { "Cache-Control": "no-store" } });
        const audio = await readAuthorizedAudioChunk(identity, suffix.slice(7), start, end - start + 1);
        const after = await authenticateMcpRequest(canonical);
        if (after.grantId !== identity.grantId || after.userId !== identity.userId) throw new McpAuthError("invalid_token");
        response = new Response(new Uint8Array(audio.bytes), { status: audio.status, headers: { "Content-Type": audio.mimeType, "Content-Length": String(audio.bytes.length), "Accept-Ranges": "bytes", Vary: "Authorization", "X-Content-Type-Options": "nosniff", ...(audio.contentRange ? { "Content-Range": audio.contentRange } : {}) } });
      } else response = new Response(null, { status: 404 });
    } catch (error) {
      const unauthorized = error instanceof McpAuthError && error.code === "invalid_token";
      response = Response.json({ error: unauthorized ? "invalid_token" : "unavailable" }, { status: unauthorized ? 401 : 403,
        headers: unauthorized ? { "WWW-Authenticate": `Bearer resource_metadata="${config.resourceUrl}/resource-metadata", error="invalid_token"` } : {} });
    }
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  });
}
