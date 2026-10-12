import "server-only";
import { Buffer } from "node:buffer";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requestContext } from "./request-context.server";

export type McpConfig = {
  resourceUrl: string; origin: string; issuer: string; publicSupabaseUrl: string;
  supabaseUrl: string; publishableKey: string; encryptionKey: Buffer;
  upstreamClientId: string; upstreamClientSecret: string;
  redirectOrigins: readonly string[]; allowLoopback: boolean; dcrEnabled: boolean; callbackUrl: string;
};
export const installationSchema = z.object({ enabled: z.boolean(), webOrigin: z.string(), publicSupabaseUrl: z.string(), upstreamClientId: z.string().uuid() }).strict();
type Environment = Record<string, string | undefined>;

// Permit HTTPS or explicitly enabled exact loopback hosts used by the desktop clients.
export function isMcpAllowedUrl(value: string, allowLoopback: boolean) {
  try { const url = new URL(value); return !url.username && !url.password && !url.hash && (url.protocol === "https:" || allowLoopback && url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)); } catch { return false; }
}

// Select only the named default key; malformed dictionaries never fall back to legacy keys.
function runtimeKey(env: Environment, dictionary: string, legacy: string) {
  const value = env[dictionary] === undefined ? env[legacy] : JSON.parse(env[dictionary]!).default;
  if (typeof value !== "string" || !value || /[\r\n]/.test(value)) throw new Error("MCP runtime unavailable.");
  return value;
}

// Keep the trusted internal service address independent of the public Auth issuer.
export function getEdgeAdminEnv(env: Environment = process.env) {
  const url = new URL(env.SUPABASE_URL ?? "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("MCP runtime unavailable.");
  return { supabaseUrl: url.origin, supabaseServiceRoleKey: runtimeKey(env, "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY") };
}

// Validate operator-owned metadata and exactly two independent MCP secrets.
export function parseMcpConfig(value: unknown, env: Environment = process.env): McpConfig | null {
  try {
    const row = installationSchema.parse(value);
    if (!row.enabled || ![row.webOrigin, row.publicSupabaseUrl].every((value) => isMcpAllowedUrl(value, false) && new URL(value).origin === value)) return null;
    const { supabaseUrl } = getEdgeAdminEnv(env);
    const rawKey = env.MCP_TOKEN_ENCRYPTION_KEY ?? "";
    const encryptionKey = Buffer.from(rawKey, "base64");
    const upstreamClientSecret = env.MCP_SUPABASE_CLIENT_SECRET ?? "";
    if (encryptionKey.length !== 32 || encryptionKey.toString("base64") !== rawKey || upstreamClientSecret.length < 16 || upstreamClientSecret.length > 2000 || [...upstreamClientSecret].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
    return { resourceUrl: `${row.publicSupabaseUrl}/functions/v1/vosio-mcp`, origin: row.webOrigin, issuer: row.webOrigin, publicSupabaseUrl: row.publicSupabaseUrl,
      supabaseUrl, publishableKey: runtimeKey(env, "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), encryptionKey, upstreamClientId: row.upstreamClientId, upstreamClientSecret,
      redirectOrigins: [], allowLoopback: true, dcrEnabled: true, callbackUrl: `${row.webOrigin}/api/mcp/oauth/callback` };
  } catch { return null; }
}

// Read installation activation for every request and every subsequent tool authorization.
export async function loadMcpConfig(): Promise<McpConfig | null> {
  try {
    const env = getEdgeAdminEnv();
    const admin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }) } });
    const { data, error } = await admin.rpc("mcp_installation_v1", { p_action: "read", p_payload: {} });
    return error ? null : parseMcpConfig(data);
  } catch { return null; }
}

// Request-local configuration is never an isolate-wide cached authorization decision.
export function getMcpConfig() { return requestContext.getStore()?.config ?? null; }
