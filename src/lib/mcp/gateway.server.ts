import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { getPublicEnv } from "@/lib/env";
import { filterMcpCookies, MCP_NONCE_COOKIE } from "./request-context.server";
export { MCP_NONCE_COOKIE } from "./request-context.server";

const metadataSchema = z.object({ resource: z.string().url(), webOrigin: z.string().url(), issuer: z.string().url(), authorization_endpoint: z.string().url(), token_endpoint: z.string().url(), revocation_endpoint: z.string().url(), registration_endpoint: z.string().url().optional(), scopes_supported: z.array(z.string()), response_types_supported: z.array(z.string()), grant_types_supported: z.array(z.string()), token_endpoint_auth_methods_supported: z.array(z.string()), revocation_endpoint_auth_methods_supported: z.array(z.string()), code_challenge_methods_supported: z.array(z.string()) }).strict();
const pendingView = z.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), clientName: z.string().max(100), pending: z.object({ id: z.string().uuid(), status: z.enum(["pending", "approved"]), redirectUri: z.string().url(), scopes: z.array(z.string()) }) });
const upstreamView = z.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), authorizationId: z.string().max(200), redirectUrl: z.string().url().nullable() });
const connectionsView = z.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), connections: z.array(z.object({ id: z.string().uuid(), clientName: z.string().max(100), scopes: z.array(z.string()) })).max(50) });
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

// Derive the sole backend destination from the web's existing Supabase connection.
function target() {
  const env = getPublicEnv(); const url = new URL(env.supabaseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("MCP unavailable.");
  return { publicUrl: url.origin, resource: `${url.origin}/functions/v1/vosio-mcp`, key: env.supabasePublishableKey };
}

// Bound both proxy input and backend responses; no unbounded body buffering.
async function boundedBytes(stream: ReadableStream<Uint8Array> | null, maximum: number) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(); const parts: Uint8Array[] = []; let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel(); }, 15000); let complete = false;
  try {
    for (;;) { const next = await reader.read(); if (next.done) { complete = true; break; } size += next.value.length; if (size > maximum) throw new Error("MCP response too large."); parts.push(next.value); }
    if (timedOut) throw new Error("MCP body timeout.");
    const result = new Uint8Array(size); let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  } finally { clearTimeout(timer); if (!complete) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

// Read a small public metadata document without auth cookies, redirects or secret configuration.
export async function getMcpMetadata() {
  try {
    const backend = target();
    const response = await fetch(`${backend.resource}/metadata`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000), headers: { apikey: backend.key } });
    if (!response.ok) return null;
    const data = metadataSchema.parse(JSON.parse(new TextDecoder().decode(await boundedBytes(response.body, 16000))));
    if (data.resource !== backend.resource || new URL(data.webOrigin).origin !== data.webOrigin || !data.webOrigin.startsWith("https://") || data.issuer !== data.webOrigin
      || data.authorization_endpoint !== `${data.webOrigin}/api/mcp/oauth/authorize` || data.token_endpoint !== `${backend.resource}/oauth/token` || data.revocation_endpoint !== `${backend.resource}/oauth/revoke`
      || data.registration_endpoint !== undefined && data.registration_endpoint !== `${backend.resource}/oauth/register`) return null;
    return data;
  } catch { return null; }
}

// Proxy only fixed OAuth paths; preserve separate cookies and validated external redirect locations.
export async function proxyMcpOAuth(request: Request, action: "authorize" | "callback" | "consent" | "token" | "revoke" | "register") {
  try {
    const backend = target(); const metadata = await getMcpMetadata();
    if (!metadata) return new Response(null, { status: 404, headers });
    if (new URL(request.url).origin !== metadata.webOrigin) return new Response(null, { status: 403, headers });
    const outbound = new Headers({ apikey: backend.key });
    for (const name of ["content-type", "origin"]) { const value = request.headers.get(name); if (value) outbound.set(name, value); }
    outbound.set("cookie", filterMcpCookies(request.headers.get("cookie") ?? "", backend.publicUrl).map(({ name, value }) => `${name}=${encodeURIComponent(value!)}`).join("; "));
    const bytes = request.method === "POST" ? await boundedBytes(request.body, 16000) : undefined;
    const response = await fetch(`${backend.resource}/oauth/${action}${new URL(request.url).search}`, { method: request.method, headers: outbound, body: bytes, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20000) });
    const result = new Response(await boundedBytes(response.body, 64000), { status: response.status, headers });
    for (const name of ["content-type", "location", "retry-after"]) { const value = response.headers.get(name); if (value) result.headers.set(name, value); }
    for (const cookie of response.headers.getSetCookie()) {
      const name = cookie.slice(0, cookie.indexOf("="));
      if (!filterMcpCookies(`${name}=value`, backend.publicUrl).length || /;\s*domain=/i.test(cookie)) throw new Error("Unexpected backend cookie.");
      result.headers.append("Set-Cookie", cookie);
    }
    return result;
  } catch { return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers }); }
}

// Fetch an authenticated view using only this installation's auth and nonce cookies.
async function readView(path: string) {
  const backend = target(); const jar = await cookies();
  const cookie = filterMcpCookies(jar.getAll().map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join("; "), backend.publicUrl).map(({ name, value }) => `${name}=${encodeURIComponent(value!)}`).join("; ");
  if (!jar.get(MCP_NONCE_COOKIE)) throw new Error("MCP nonce missing.");
  const response = await fetch(`${backend.resource}/browser/${path}`, { headers: { apikey: backend.key, cookie }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("MCP view unavailable.");
  return JSON.parse(new TextDecoder().decode(await boundedBytes(response.body, 64000))) as unknown;
}

// Render only the current pending request bound to the browser nonce.
export async function readPendingView(id?: string) { return pendingView.parse(await readView(`pending${id ? `?request=${encodeURIComponent(id)}` : ""}`)); }
// Render the verified upstream consent or its exact callback redirect.
export async function readUpstreamView(id: string) { return upstreamView.parse(await readView(`upstream?authorization_id=${encodeURIComponent(id)}`)); }
// List only current actor-owned connections after verification in the Function.
export async function readConnectionsView() { return connectionsView.parse(await readView("connections")); }
