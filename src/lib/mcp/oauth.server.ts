import "server-only";
import { randomUUID } from "node:crypto";
import { getRequestCookies as cookies, redirectResponse, setBindingCookie, MCP_NONCE_COOKIE, MCP_PENDING_COOKIE } from "./request-context.server";
export { MCP_NONCE_COOKIE, MCP_PENDING_COOKIE } from "./request-context.server";
import { Buffer } from "node:buffer";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { createRateLimiter } from "@/lib/rate-limit";
import { getMcpConfig, isMcpAllowedUrl, type McpConfig } from "./config.server";
import { custody, registerDynamicClient } from "./oauth-store.server";
import { decryptCustody, encryptCustody, equalHash, hashToken, newOpaqueToken, pkceChallenge } from "./oauth-crypto.server";
import { grantSchema, verifyUpstream } from "./auth.server";

const uuid = z.string().uuid();
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const bounded = z.string().min(1).max(2000);
export const authorizeSchema = z.object({ response_type: z.literal("code"), client_id: uuid, redirect_uri: bounded, state: z.string().max(1024).default(""), code_challenge: opaque, code_challenge_method: z.literal("S256"), resource: bounded, scope: z.string().max(100).default("vosio:read") }).strict();
export const tokenSchema = z.discriminatedUnion("grant_type", [
  z.object({ grant_type: z.literal("authorization_code"), client_id: uuid, code: opaque, redirect_uri: bounded, resource: bounded, code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/) }).strict(),
  z.object({ grant_type: z.literal("refresh_token"), client_id: uuid, refresh_token: opaque, resource: bounded, scope: z.string().max(100).optional() }).strict()
]);
const metadataUrl = z.string().max(2000).refine((value) => isMcpAllowedUrl(value, false));
export const registerSchema = z.object({ client_name: z.string().trim().min(1).max(100).default("MCP client"), redirect_uris: z.array(bounded).min(1).max(10), token_endpoint_auth_method: z.literal("none").default("none"), grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).min(1).max(2).default(["authorization_code", "refresh_token"]), response_types: z.array(z.literal("code")).length(1).default(["code"]),
  client_uri: metadataUrl.optional(), logo_uri: z.union([metadataUrl, z.literal("")]).optional(),
  scope: z.string().max(100).optional(), application_type: z.enum(["native", "web"]).optional(), contacts: z.array(z.string().email().max(254)).max(10).optional(),
  tos_uri: z.union([metadataUrl, z.literal("")]).optional(), policy_uri: metadataUrl.optional(),
  software_id: z.string().max(100).optional(), software_version: z.string().max(100).optional()
}).strict();
const pendingSchema = z.object({ id: uuid, clientId: uuid, redirectUri: bounded, resource: bounded, state: z.string().max(1024), scopes: z.array(z.enum(["vosio:read", "vosio:write"])).min(1).max(2), userId: uuid.nullable(), encrypted: z.string().max(40000), status: z.enum(["pending", "approved"]).optional() });
const pendingSecrets = z.object({ state: opaque, verifier: opaque }).strict();
const upstreamTokens = z.object({ access_token: z.string().min(1).max(16000), refresh_token: z.string().min(1).max(4000) });
const browserFormSchema = z.object({ action: z.enum(["approve", "deny", "upstream_approve", "upstream_deny", "revoke"]), nonce: opaque, pendingId: uuid.optional(), authorizationId: z.string().min(1).max(200).optional(), grantId: uuid.optional(), access: z.enum(["read", "write"]).optional() }).strict();
const requestLimit = createRateLimiter({ limit: 30, windowMs: 60000 });

class OAuthFailure extends Error {
  // Return fixed OAuth errors without raw upstream or database information.
  constructor(public readonly code: "invalid_request" | "invalid_grant" | "invalid_scope" | "invalid_client" | "access_denied" | "temporarily_unavailable" | "unauthorized_client", public readonly status = 400, public readonly retryAfter?: number) { super("OAuth request could not be completed."); }
}

// Resolve enabled configuration without revealing missing secret names or values.
function enabledConfig() { const config = getMcpConfig(); if (!config) throw new OAuthFailure("temporarily_unavailable", 503); return config; }

// Reuse Supabase SSR cookie handling with a finite timeout, solely for browser consent identity.
async function consentSession(config: McpConfig) {
  const jar = await cookies();
  return createServerClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { name: `sb-${new URL(config.publicSupabaseUrl).hostname.split(".")[0]}-auth-token` },
    global: { fetch: (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15000)]) }) },
    cookies: { getAll: () => jar.getAll(), setAll: (items) => { items.forEach(({ name, value, options }) => jar.set(name, value, options)); } }
  });
}

// Normalize only supported Vosio scopes; write always entails read.
export function normalizeMcpScopes(value: string) {
  const scopes = value.split(/\s+/).filter(Boolean);
  if (!scopes.length || scopes.some((scope) => scope !== "vosio:read" && scope !== "vosio:write")) throw new OAuthFailure("invalid_request");
  return scopes.includes("vosio:write") ? ["vosio:read", "vosio:write"] as const : ["vosio:read"] as const;
}

// Require canonical callback serialization so TypeScript and durable SQL compare the same host/path.
export function validateMcpRedirect(config: McpConfig, value: string) {
  if (!isMcpAllowedUrl(value, config.allowLoopback) || value.length > 2000 || /[\s\\]/.test(value) || value.includes("#")) throw new OAuthFailure("invalid_request");
  const url = new URL(value);
  if (url.href !== value) throw new OAuthFailure("invalid_request");
  const loopbackOrigin = url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ? `http://${url.hostname}` : null;
  if (loopbackOrigin && value.includes("?") || ["code", "state", "error"].some((key) => url.searchParams.has(key))) throw new OAuthFailure("invalid_request");
  return value;
}

// Desktop loopback callbacks may change only their ephemeral port, keeping the same exact host and path.
export function matchesMcpRedirect(config: McpConfig, registered: string, actual: string) {
  try { validateMcpRedirect(config, registered); validateMcpRedirect(config, actual); } catch { return false; }
  if (registered === actual) return true;
  if (!config.allowLoopback || !isMcpAllowedUrl(registered, true) || !isMcpAllowedUrl(actual, true)) return false;
  const first = new URL(registered); const second = new URL(actual);
  if (first.protocol !== "http:" || second.protocol !== "http:" || first.hostname !== second.hostname
    || first.search || second.search || !["127.0.0.1", "[::1]", "localhost"].includes(first.hostname)) return false;
  first.port = ""; second.port = "";
  return first.href === second.href;
}

// Bound bodies while streaming so chunked input cannot bypass content-length limits.
async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 16000) throw new OAuthFailure("invalid_request");
  const reader = request.body?.getReader();
  if (!reader) throw new OAuthFailure("invalid_request");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
  // Cancel a stalled body read without racing a database write or retrying token operations.
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder(); let text = ""; let size = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 16000) { await reader.cancel(); throw new OAuthFailure("invalid_request"); } text += decoder.decode(next.value, { stream: true }); }
    if (signal.aborted) throw new OAuthFailure("invalid_request");
    return text + decoder.decode();
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

// Reject duplicate form/query keys instead of silently choosing one attacker-controlled value.
function uniqueParams(params: URLSearchParams) {
  const entries: Record<string, string> = {};
  for (const [key, value] of params) { if (Object.hasOwn(entries, key)) throw new OAuthFailure("invalid_request"); entries[key] = value; }
  return entries;
}

// Parse only JSON or ordinary URL-encoded OAuth bodies with a fixed size ceiling.
async function body(request: Request) {
  const text = await boundedBody(request);
  if ((request.headers.get("content-type") ?? "").startsWith("application/json")) return JSON.parse(text);
  if ((request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) return uniqueParams(new URLSearchParams(text));
  throw new OAuthFailure("invalid_request");
}

// Bind browser forms to this exact origin and a secure nonce cookie.
export async function browserIdentity(config: McpConfig, suppliedNonce?: string) {
  const jar = await cookies();
  const nonce = jar.get(MCP_NONCE_COOKIE)?.value;
  if (!opaque.safeParse(nonce).success || suppliedNonce && !equalHash(hashToken(nonce!), hashToken(suppliedNonce))) throw new OAuthFailure("access_denied");
  const session = await consentSession(config);
  const { data, error } = await session.auth.getUser();
  if (error || !data.user) throw new OAuthFailure("access_denied", 401);
  const active = await session.rpc("mcp_auth_session_active_v1").abortSignal(AbortSignal.timeout(15000));
  if (active.error || active.data !== true) throw new OAuthFailure("access_denied");
  return { session, userId: data.user.id, nonce: nonce!, pendingId: jar.get(MCP_PENDING_COOKIE)?.value, config };
}

// Load pending authorization through both browser nonce and durable request identity.
export async function readBrowserPending(config: McpConfig, requestedId?: string) {
  const browser = await browserIdentity(config);
  const id = requestedId ?? browser.pendingId;
  if (!uuid.safeParse(id).success || browser.pendingId !== id) throw new OAuthFailure("access_denied");
  const pending = pendingSchema.parse(await custody("pending", { id: id!, nonceHash: hashToken(browser.nonce) }));
  if (pending.resource !== config.resourceUrl || pending.userId && pending.userId !== browser.userId) throw new OAuthFailure("access_denied");
  const client = await custody("client", { clientId: pending.clientId });
  if (!client || !Array.isArray(client.redirects) || !client.redirects.some((uri) => typeof uri === "string" && matchesMcpRedirect(config, uri, pending.redirectUri))) throw new OAuthFailure("access_denied");
  validateMcpRedirect(config, pending.redirectUri);
  return { ...browser, pending, clientName: typeof client.name === "string" ? client.name.slice(0, 100) : "MCP klient" };
}

// Validate complete upstream redirects before following even an already-approved authorization.
export function validateUpstreamRedirect(config: McpConfig, value: string, expectedState: string) {
  const url = new URL(value);
  if (`${url.origin}${url.pathname}` !== config.callbackUrl || url.username || url.password || url.hash || url.searchParams.getAll("state").length !== 1
    || url.searchParams.get("state") !== expectedState || [...url.searchParams.keys()].some((key) => !["code", "state", "error", "error_description"].includes(key))) throw new OAuthFailure("access_denied");
  if (url.searchParams.getAll("code").length > 1 || url.searchParams.getAll("error").length > 1 || !(url.searchParams.has("code") !== url.searchParams.has("error"))) throw new OAuthFailure("access_denied");
  return url.href;
}

// Check pending actor before asking Supabase for OAuth details or handling auto-approval.
export async function upstreamConsentDetails(config: McpConfig, authorizationId: string) {
  if (!z.string().min(1).max(200).safeParse(authorizationId).success) throw new OAuthFailure("invalid_request");
  const browser = await readBrowserPending(config);
  if (browser.pending.status !== "approved" || browser.pending.userId !== browser.userId) throw new OAuthFailure("access_denied");
  const secrets = pendingSecrets.parse(decryptCustody(config.encryptionKey, browser.pending.id, browser.pending.encrypted));
  const { data, error } = await browser.session.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) throw new OAuthFailure("access_denied");
  if ("redirect_url" in data) return { ...browser, secrets, redirectUrl: validateUpstreamRedirect(config, data.redirect_url, secrets.state), authorizationId };
  if (data.authorization_id !== authorizationId || data.client.id !== config.upstreamClientId || data.redirect_uri !== config.callbackUrl
    || data.user.id !== browser.userId || data.scope !== "email") throw new OAuthFailure("access_denied");
  return { ...browser, secrets, redirectUrl: null, authorizationId };
}

// Exchange only this installation's confidential OAuth client with no retry or browser-session reuse.
async function upstreamExchange(config: McpConfig, values: Record<string, string>) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/oauth/token`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${config.upstreamClientId}:${config.upstreamClientSecret}`).toString("base64")}` }, body: new URLSearchParams(values) });
  if (!response.ok) throw new OAuthFailure("invalid_grant");
  const text = await boundedBody(new Request("https://oauth-response.invalid", { method: "POST", body: response.body, duplex: "half" } as RequestInit));
  const tokens = upstreamTokens.safeParse(JSON.parse(text));
  if (!tokens.success) throw new OAuthFailure("invalid_grant");
  return tokens.data;
}

// Issue fenced bridge tokens while preserving the grant's fixed scope set on refresh.
async function issueBridgeTokens(config: McpConfig, raw: Record<string, unknown>, refresh: boolean, requestedScopes?: ReturnType<typeof normalizeMcpScopes>) {
  const grant = grantSchema.parse(raw);
  if (!grant.fence || grant.resource !== config.resourceUrl || !grant.scopes.includes("vosio:read")) throw new OAuthFailure("invalid_grant");
  try {
    if (requestedScopes && (requestedScopes.length !== grant.scopes.length || requestedScopes.some((scope) => !grant.scopes.includes(scope)))) throw new OAuthFailure("invalid_scope");
    const old = upstreamTokens.parse(decryptCustody(config.encryptionKey, grant.id, grant.encrypted));
    const tokens = refresh ? await upstreamExchange(config, { grant_type: "refresh_token", refresh_token: old.refresh_token }) : old;
    const verified = await verifyUpstream(config, tokens.access_token, grant.user_id, grant.session_id);
    const now = Math.floor(Date.now() / 1000);
    const accessExpiresAt = Math.min(now + 300, verified.expiresAt);
    const accessToken = newOpaqueToken(); const refreshToken = newOpaqueToken();
    const common = { grantId: grant.id, fence: grant.fence, accessHash: hashToken(accessToken), refreshHash: hashToken(refreshToken), accessExpiresAt };
    const saved = refresh ? await custody("refresh_finish", { ...common, encrypted: encryptCustody(config.encryptionKey, grant.id, tokens), sessionId: verified.sessionId, upstreamExpiresAt: verified.expiresAt }) : await custody("token_issue", common);
    if (saved?.ok !== true) throw new OAuthFailure("invalid_grant");
    return { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: accessExpiresAt - now, scope: grant.scopes.join(" ") };
  } catch (error) {
    // External refresh uncertainty consumes the family; callers must authorize a new connection.
    await custody("revoke_grant", { grantId: grant.id }).catch(() => null);
    if (error instanceof OAuthFailure && error.code === "invalid_scope") throw error;
    throw new OAuthFailure("invalid_grant");
  }
}

// Set secure browser-binding cookies without putting them into downstream redirects.
function bindCookies(response: Response, id: string, nonce: string) {
  for (const [name, value] of [[MCP_PENDING_COOKIE, id], [MCP_NONCE_COOKIE, nonce]]) setBindingCookie(response, name, value, 600);
  return response;
}

// Dispatch fixed OAuth endpoints with bounded strict input and generic no-store responses.
export async function handleMcpOAuth(request: Request, action: "authorize" | "token" | "register" | "revoke" | "callback" | "consent") {
  try {
    const config = enabledConfig();
    const url = new URL(request.url);
    if (url.origin !== config.origin) throw new OAuthFailure("invalid_request");
    const rateKey = hashToken(`${action}:${request.headers.get("x-forwarded-for")?.slice(0, 100) ?? "unknown"}`);
    if (!requestLimit(rateKey).allowed) throw new OAuthFailure("temporarily_unavailable", 429, 60);
    let response: Response;
    if (action === "register") {
      if (!config.dcrEnabled) throw new OAuthFailure("unauthorized_client", 403);
      const parsed = registerSchema.parse(await body(request));
      if (!parsed.grant_types.includes("authorization_code")) throw new OAuthFailure("invalid_request");
      // Declarative client metadata never confers authorization and no metadata URL is fetched.
      if (parsed.scope) normalizeMcpScopes(parsed.scope);
      parsed.redirect_uris.forEach((uri) => validateMcpRedirect(config, uri));
      const clientId = randomUUID();
      const registration = await registerDynamicClient({ clientId, name: parsed.client_name, redirects: parsed.redirect_uris });
      if (registration.status !== "accepted") throw new OAuthFailure("temporarily_unavailable", 429, registration.retryAfter);
      response = Response.json({ ...parsed, client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000) }, { status: 201 });
    } else if (action === "authorize") {
      const args = authorizeSchema.parse(uniqueParams(url.searchParams));
      if (args.resource !== config.resourceUrl) throw new OAuthFailure("invalid_request");
      validateMcpRedirect(config, args.redirect_uri);
      const client = await custody("client", { clientId: args.client_id });
      if (!client || !Array.isArray(client.redirects) || !client.redirects.some((uri) => typeof uri === "string" && matchesMcpRedirect(config, uri, args.redirect_uri))) throw new OAuthFailure("invalid_client");
      const id = randomUUID(); const nonce = newOpaqueToken(); const state = newOpaqueToken(); const verifier = newOpaqueToken();
      const scopes = [...normalizeMcpScopes(args.scope)];
      if ((await custody("pending_create", { id, clientId: args.client_id, redirectUri: args.redirect_uri, resource: config.resourceUrl, state: args.state, challenge: args.code_challenge, scopes, nonceHash: hashToken(nonce), upstreamStateHash: hashToken(state), encrypted: encryptCustody(config.encryptionKey, id, { state, verifier }) }))?.ok !== true) throw new OAuthFailure("temporarily_unavailable", 503);
      response = bindCookies(redirectResponse(`${config.origin}/mcp/consent?request=${id}`, 303), id, nonce);
    } else if (action === "token") {
      const args = tokenSchema.parse(await body(request));
      if (args.resource !== config.resourceUrl) throw new OAuthFailure("invalid_grant");
      const requestedScopes = args.grant_type === "refresh_token" && args.scope !== undefined ? normalizeMcpScopes(args.scope) : undefined;
      const raw = args.grant_type === "authorization_code" ? await custody("code_claim", { codeHash: hashToken(args.code), clientId: args.client_id, redirectUri: args.redirect_uri, resource: args.resource, challenge: pkceChallenge(args.code_verifier) }) : await custody("refresh_claim", { refreshHash: hashToken(args.refresh_token), clientId: args.client_id, resource: args.resource });
      if (!raw) throw new OAuthFailure("invalid_grant");
      response = Response.json(await issueBridgeTokens(config, raw, args.grant_type === "refresh_token", requestedScopes));
    } else if (action === "revoke") {
      const args = z.object({ token: opaque, client_id: uuid, token_type_hint: z.enum(["access_token", "refresh_token"]).optional() }).strict().parse(await body(request));
      await custody("revoke", { tokenHash: hashToken(args.token), clientId: args.client_id });
      response = new Response(null, { status: 200 });
    } else if (action === "callback") {
      const args = z.object({ code: z.string().min(1).max(2000).optional(), state: opaque, error: z.string().max(100).optional(), error_description: z.string().max(1000).optional() }).strict().parse(uniqueParams(url.searchParams));
      const jar = await cookies(); const nonce = jar.get(MCP_NONCE_COOKIE)?.value;
      if (!opaque.safeParse(nonce).success) throw new OAuthFailure("access_denied");
      const pending = pendingSchema.parse(await custody("pending_claim", { nonceHash: hashToken(nonce!), stateHash: hashToken(args.state) }));
      if (!pending.userId || jar.get(MCP_PENDING_COOKIE)?.value !== pending.id || pending.resource !== config.resourceUrl) throw new OAuthFailure("access_denied");
      const secrets = pendingSecrets.parse(decryptCustody(config.encryptionKey, pending.id, pending.encrypted));
      if (secrets.state !== args.state || args.error || !args.code) throw new OAuthFailure("access_denied");
      const tokens = await upstreamExchange(config, { grant_type: "authorization_code", code: args.code, code_verifier: secrets.verifier, redirect_uri: config.callbackUrl });
      const verified = await verifyUpstream(config, tokens.access_token, pending.userId);
      const grantId = randomUUID(); const code = newOpaqueToken();
      if ((await custody("grant_create", { pendingId: pending.id, grantId, userId: verified.userId, sessionId: verified.sessionId, encrypted: encryptCustody(config.encryptionKey, grantId, tokens), upstreamExpiresAt: verified.expiresAt, codeHash: hashToken(code) }))?.ok !== true) throw new OAuthFailure("invalid_grant");
      const target = new URL(validateMcpRedirect(config, pending.redirectUri)); target.searchParams.set("code", code); if (pending.state) target.searchParams.set("state", pending.state);
      response = redirectResponse(target, 303);
      for (const name of [MCP_PENDING_COOKIE, MCP_NONCE_COOKIE]) setBindingCookie(response, name, "", 0);
    } else if (request.method === "GET") {
      if (url.search !== "?connections=1") throw new OAuthFailure("invalid_request");
      const session = await consentSession(config); const { data, error } = await session.auth.getUser();
      const active = await session.rpc("mcp_auth_session_active_v1").abortSignal(AbortSignal.timeout(15000));
      if (error || !data.user || active.error || active.data !== true) throw new OAuthFailure("access_denied");
      response = bindCookies(redirectResponse(`${config.origin}/mcp/connections`, 303), randomUUID(), newOpaqueToken());
    } else {
      if (request.headers.get("origin") !== config.origin) throw new OAuthFailure("access_denied");
      const args = browserFormSchema.parse(await body(request));
      const browser = await browserIdentity(config, args.nonce);
      if (args.action === "revoke") {
        if (!args.grantId) throw new OAuthFailure("invalid_request");
        const result = await browser.session.rpc("mcp_revoke_own_connection_v1", { p_grant_id: args.grantId }).abortSignal(AbortSignal.timeout(15000));
        if (result.error) throw new OAuthFailure("temporarily_unavailable", 503);
        response = redirectResponse(`${config.origin}/mcp/connections`, 303);
      } else if (args.action === "approve" || args.action === "deny") {
        const { pending } = await readBrowserPending(config, args.pendingId);
        if (pending.status !== "pending") throw new OAuthFailure("access_denied");
        if (args.action === "deny") {
          if ((await custody("pending_deny", { id: pending.id, nonceHash: hashToken(browser.nonce) }))?.ok !== true) throw new OAuthFailure("access_denied");
          const target = new URL(pending.redirectUri); target.searchParams.set("error", "access_denied"); if (pending.state) target.searchParams.set("state", pending.state);
          response = redirectResponse(target, 303);
        } else {
          const scopes: Array<"vosio:read" | "vosio:write"> = args.access === "write" ? ["vosio:read", "vosio:write"] : ["vosio:read"];
          if (scopes.some((scope) => !pending.scopes.includes(scope))) throw new OAuthFailure("access_denied");
          if (!await custody("pending_approve", { id: pending.id, nonceHash: hashToken(browser.nonce), userId: browser.userId, scopes })) throw new OAuthFailure("access_denied");
          const secrets = pendingSecrets.parse(decryptCustody(config.encryptionKey, pending.id, pending.encrypted));
          const target = new URL(`${config.publicSupabaseUrl}/auth/v1/oauth/authorize`);
          target.search = new URLSearchParams({ response_type: "code", client_id: config.upstreamClientId, redirect_uri: config.callbackUrl, scope: "email", state: secrets.state, code_challenge: pkceChallenge(secrets.verifier), code_challenge_method: "S256" }).toString();
          response = redirectResponse(target, 303);
        }
      } else {
        if (!args.authorizationId) throw new OAuthFailure("invalid_request");
        const details = await upstreamConsentDetails(config, args.authorizationId);
        if (details.redirectUrl) response = redirectResponse(details.redirectUrl, 303);
        else {
          const result = args.action === "upstream_approve" ? await details.session.auth.oauth.approveAuthorization(args.authorizationId, { skipBrowserRedirect: true }) : await details.session.auth.oauth.denyAuthorization(args.authorizationId, { skipBrowserRedirect: true });
          if (result.error || !result.data) throw new OAuthFailure("access_denied");
          response = redirectResponse(validateUpstreamRedirect(config, result.data.redirect_url, details.secrets.state), 303);
        }
      }
    }
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    const failure = error instanceof OAuthFailure ? error : error instanceof z.ZodError || error instanceof SyntaxError ? new OAuthFailure("invalid_request") : new OAuthFailure("temporarily_unavailable", 503);
    return Response.json({ error: failure.code }, { status: failure.status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...(failure.retryAfter ? { "Retry-After": String(failure.retryAfter) } : {}) } });
  }
}
