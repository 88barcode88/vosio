import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(2000);
const encrypted = z.string().min(1).max(40000);
const scopes = z.array(z.enum(["vosio:read", "vosio:write"])).min(1).max(2);
const registrationResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("accepted") }).strict(),
  z.object({ status: z.enum(["rate_limited", "capacity_limited"]), retryAfter: z.number().int().min(1).max(60) }).strict()
]);
export const custodySchemas = {
  register: z.object({ clientId: id, name: z.string().min(1).max(100), redirects: z.array(text).min(1).max(10) }).strict(),
  client: z.object({ clientId: id }).strict(),
  pending_create: z.object({ id, clientId: id, redirectUri: text, resource: text, state: z.string().max(1024), challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), scopes, nonceHash: hash, upstreamStateHash: hash, encrypted }).strict(),
  pending: z.object({ id, nonceHash: hash }).strict(),
  pending_approve: z.object({ id, nonceHash: hash, userId: id, scopes }).strict(),
  pending_deny: z.object({ id, nonceHash: hash }).strict(),
  pending_claim: z.object({ nonceHash: hash, stateHash: hash }).strict(),
  grant_create: z.object({ pendingId: id, grantId: id, userId: id, sessionId: id, encrypted, upstreamExpiresAt: z.number().int().positive(), codeHash: hash }).strict(),
  code_claim: z.object({ codeHash: hash, clientId: id, redirectUri: text, resource: text, challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
  token_issue: z.object({ grantId: id, fence: id, accessHash: hash, refreshHash: hash, accessExpiresAt: z.number().int().positive() }).strict(),
  access: z.object({ accessHash: hash, resource: text }).strict(),
  refresh_claim: z.object({ refreshHash: hash, clientId: id, resource: text }).strict(),
  refresh_finish: z.object({ grantId: id, fence: id, encrypted, sessionId: id, upstreamExpiresAt: z.number().int().positive(), accessHash: hash, refreshHash: hash, accessExpiresAt: z.number().int().positive() }).strict(),
  revoke: z.object({ tokenHash: hash, clientId: id }).strict(),
  revoke_grant: z.object({ grantId: id }).strict()
};

// Invoke only fixed custody cases; this service client never reads application content.
export async function custody<A extends keyof typeof custodySchemas>(action: A, payload: z.input<(typeof custodySchemas)[A]>): Promise<Record<string, unknown> | null> {
  const parsed = custodySchemas[action].safeParse(payload);
  if (!parsed.success) throw new Error("OAuth custody unavailable.");
  const { data, error } = await createAdminClient().rpc("mcp_oauth_custody_v1", { p_action: action, p_payload: parsed.data }).abortSignal(AbortSignal.timeout(15000));
  if (error || data !== null && (!data || typeof data !== "object" || Array.isArray(data))) throw new Error("OAuth custody unavailable.");
  return data;
}

// Admit a public client through the installation-wide durable limit without granting data access.
export async function registerDynamicClient(payload: z.input<typeof custodySchemas.register>) {
  const parsed = custodySchemas.register.parse(payload);
  const { data, error } = await createAdminClient().rpc("mcp_register_dynamic_client_v1", { p_payload: parsed }).abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error("OAuth registration unavailable.");
  const result = registrationResult.safeParse(data);
  if (!result.success) throw new Error("OAuth registration unavailable.");
  return result.data;
}
