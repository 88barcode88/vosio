import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadMcpConfig, type McpConfig } from "./config.server";
import { custody } from "./oauth-store.server";
import { decryptCustody, hashToken } from "./oauth-crypto.server";
import { createRateLimiter } from "@/lib/rate-limit";

export class McpAuthError extends Error {
  // Keep auth failures fixed and independent of Supabase response details.
  constructor(public readonly code: "disabled" | "invalid_token" | "unavailable" | "rate_limited") { super("MCP authentication unavailable."); }
}
const limit = createRateLimiter({ limit: 120, windowMs: 60000 });
const upstreamSchema = z.object({ access_token: z.string().min(1).max(16000), refresh_token: z.string().min(1).max(4000) }).strict();
const claimsSchema = z.object({ sub: z.string().uuid(), client_id: z.string(), session_id: z.string().uuid(), iss: z.string(), aud: z.literal("authenticated"), role: z.literal("authenticated"), exp: z.number().int().positive() });
export const grantSchema = z.object({ id: z.string().uuid(), user_id: z.string().uuid(), session_id: z.string().uuid(), client_id: z.string().uuid(), resource: z.string(), scopes: z.array(z.enum(["vosio:read", "vosio:write"])).min(1).max(2), encrypted: z.string(), upstream_expires_at: z.number().int(), fence: z.string().uuid().nullable().optional() });

// Create a fresh JWT-scoped RLS client that cannot persist or refresh a browser session.
export function upstreamSession(config: McpConfig, jwt: string) {
  return createClient(config.supabaseUrl, config.publishableKey, { global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15000)]), redirect: "error" }) }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

// Verify the signed upstream actor, OAuth client and live Supabase session on every use.
export async function verifyUpstream(config: McpConfig, jwt: string, expectedUser?: string, expectedSession?: string): Promise<{ supabase: SupabaseClient; userId: string; sessionId: string; expiresAt: number }> {
  const supabase = upstreamSession(config, jwt);
  const { data: user, error: userError } = await supabase.auth.getUser(jwt);
  const { data: verified, error: claimsError } = await supabase.auth.getClaims(jwt);
  const parsed = claimsSchema.safeParse(verified?.claims);
  if (userError || claimsError || !user?.user || !parsed.success) throw new McpAuthError("invalid_token");
  const claims = parsed.data;
  if (claims.sub !== user.user.id || expectedUser && claims.sub !== expectedUser || expectedSession && claims.session_id !== expectedSession
    || claims.client_id !== config.upstreamClientId || claims.iss !== `${config.publicSupabaseUrl}/auth/v1` || claims.exp <= Math.floor(Date.now() / 1000)) throw new McpAuthError("invalid_token");
  const active = await supabase.rpc("mcp_auth_session_active_v1");
  if (active.error || active.data !== true) throw new McpAuthError("invalid_token");
  return { supabase, userId: claims.sub, sessionId: claims.session_id, expiresAt: claims.exp };
}

// Authenticate only a bridge bearer and its current grant, never application auth cookies.
export async function authenticateMcpRequest(request: Request) {
  const config = await loadMcpConfig();
  if (!config) throw new McpAuthError("disabled");
  if (new URL(request.url).origin !== new URL(config.resourceUrl).origin) throw new McpAuthError("invalid_token");
  const header = request.headers.get("authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw new McpAuthError("invalid_token");
  const accessHash = hashToken(header.slice(7));
  if (!limit(accessHash).allowed) throw new McpAuthError("rate_limited");
  try {
    const raw = await custody("access", { accessHash, resource: config.resourceUrl });
    const grant = grantSchema.safeParse(raw);
    if (!grant.success || grant.data.resource !== config.resourceUrl || !grant.data.scopes.includes("vosio:read") || grant.data.upstream_expires_at <= Math.floor(Date.now() / 1000)) throw new McpAuthError("invalid_token");
    const upstream = upstreamSchema.parse(decryptCustody(config.encryptionKey, grant.data.id, grant.data.encrypted));
    const verified = await verifyUpstream(config, upstream.access_token, grant.data.user_id, grant.data.session_id);
    // A revoke racing the upstream checks must still prevent returning an authenticated client.
    const current = await custody("access", { accessHash, resource: config.resourceUrl });
    if (!current || current.id !== grant.data.id) throw new McpAuthError("invalid_token");
    return { supabase: verified.supabase, scopes: grant.data.scopes, resourceUrl: config.resourceUrl, userId: verified.userId, grantId: grant.data.id };
  } catch (error) { if (error instanceof McpAuthError) throw error; throw new McpAuthError("unavailable"); }
}
