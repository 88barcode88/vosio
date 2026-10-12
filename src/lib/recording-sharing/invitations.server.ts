import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getPublicEnv } from "@/lib/env";
import { createRateLimiter, type RateLimitResult } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessListSchema, invitationCreateSchema, invitationPreviewSchema, invitationSummarySchema, invitationTokenSchema, revokeAccessSchema, type InvitationCreate } from "./invitation-contract";

export { invitationCreateSchema } from "./invitation-contract";
export type InvitationClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }> };
type Delivery = (email: string, token: string, origin: string) => Promise<boolean>;
const actorLimit = createRateLimiter({ limit: 20, windowMs: 3_600_000 });
const scopeLimit = createRateLimiter({ limit: 30, windowMs: 3_600_000 });
const recipientLimit = createRateLimiter({ limit: 5, windowMs: 3_600_000 });
const INVITATION_TTL_MS = 7 * 24 * 3_600_000;
type InvitationErrorCode = "invitation_unavailable" | "rate_limited" | "invitation_cooldown" | "invitation_retry_limited" | "invitation_attempts_exhausted" | "invitation_not_pending";

export class InvitationError extends Error {
  readonly code: InvitationErrorCode;
  readonly retryAfterSeconds?: number;
  // constructor retains allowlisted outcome metadata, never provider or database text.
  constructor(public readonly status: number, options: { code?: InvitationErrorCode; retryAfterSeconds?: number } = {}) {
    super("Pozvánka není dostupná nebo akci nelze dokončit.");
    this.code = options.code ?? "invitation_unavailable";
    this.retryAfterSeconds = status === 429 && Number.isFinite(options.retryAfterSeconds) && options.retryAfterSeconds! > 0
      ? Math.ceil(options.retryAfterSeconds!) : undefined;
  }
}

// hashInvitationToken keeps application tokens out of database rows and RPC receipts.
export function hashInvitationToken(token: string) { return createHash("sha256").update(invitationTokenSchema.parse(token)).digest("hex"); }

// rpc invokes only session-scoped entry points and discards all backend error detail.
async function rpc(client: InvitationClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error?.code === "55000" && name === "revoke_recording_invitation_v1") throw new InvitationError(409, { code: "invitation_not_pending" });
  if (error?.code === "55000" && name === "resend_recording_invitation_v1") throw new InvitationError(429, { code: "invitation_retry_limited" });
  if (error) throw new InvitationError(error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500);
  return data;
}

// enforceBudget preserves the actual remaining window from the repository's per-process limiter.
function enforceBudget(result: RateLimitResult) {
  if (!result.allowed) throw new InvitationError(429, { code: "rate_limited", retryAfterSeconds: result.retryAfterSeconds });
}

// consumeSharedBudget is called only after current manager authority has been checked without writes.
function consumeSharedBudget(scope: string, email: string) {
  const recipientKey = createHash("sha256").update(email.toLowerCase()).digest("hex");
  enforceBudget(scopeLimit(scope));
  enforceBudget(recipientLimit(recipientKey));
}

// preflightCreate checks the project founder or every exact recording manager before shared budget consumption.
async function preflightCreate(client: InvitationClient, projectId: string | null, recordingIds: string[]) {
  if (projectId) {
    await listAccess(client, { projectId, recordingId: null });
  } else {
    for (const recordingId of recordingIds) await listAccess(client, { projectId: null, recordingId });
  }
}

// assertResendWindow distinguishes terminal exhaustion from the current receipt's finite cooldown.
function assertResendWindow(receipt: z.infer<typeof invitationSummarySchema>) {
  if (receipt.acceptedAt || receipt.revokedAt) throw new InvitationError(403);
  if (receipt.attemptCount >= 5) throw new InvitationError(409, { code: "invitation_attempts_exhausted" });
  const nextAttempt = Date.parse(receipt.nextAttemptAt);
  if (!Number.isFinite(nextAttempt)) throw new InvitationError(500);
  const retryAfterSeconds = Math.ceil((nextAttempt - Date.now()) / 1000);
  if (retryAfterSeconds > 0) throw new InvitationError(429, { code: "invitation_cooldown", retryAfterSeconds });
}

// deliverInvitation uses invite-only Auth and a stateless, no-signup OTP path for existing accounts.
export async function deliverInvitation(email: string, token: string, origin: string): Promise<boolean> {
  const destination = new URL("/invitations/accept", origin);
  destination.hash = new URLSearchParams({ token, type: "invite" }).toString();
  const admin = createAdminClient();
  const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: destination.toString() });
  if (!invited.error) return true;
  if (!invited.error.code || (invited.error.status ?? 0) >= 500) throw new Error("Invitation delivery is uncertain.");
  if (!["email_exists", "user_already_exists"].includes(invited.error.code ?? "")) return false;
  const env = getPublicEnv();
  const auth = createStatelessClient(env.supabaseUrl, env.supabasePublishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "implicit" } });
  destination.hash = new URLSearchParams({ token, type: "email" }).toString();
  const result = await auth.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: destination.toString() } });
  if (result.error && (!result.error.code || (result.error.status ?? 0) >= 500)) throw new Error("Invitation delivery is uncertain.");
  return !result.error;
}

// deliverReserved settles only a known outcome for the exact reserved attempt; ambiguity remains pending.
async function deliverReserved(client: InvitationClient, rawReceipt: unknown, token: string, origin: string, deliver: Delivery) {
  const receipt = invitationSummarySchema.parse(rawReceipt);
  let delivery: "sent" | "failed" | "pending" = "pending";
  try {
    const delivered = await deliver(receipt.email, token, origin);
    const settled = await rpc(client, "settle_recording_invitation_delivery_v1", { p_invitation_id: receipt.id, p_attempt_id: receipt.attemptId, p_delivered: delivered });
    if (settled === true) delivery = delivered ? "sent" : "failed";
  } catch { /* An ambiguous provider/settlement response requires a fresh bounded reservation. */ }
  return { id: receipt.id, delivery };
}

// createInvitation persists a pending invitation and binds its receipt before sending any email.
export async function createInvitation(client: InvitationClient, actor: string, input: InvitationCreate, origin: string, deliver: Delivery = deliverInvitation) {
  const value = invitationCreateSchema.parse(input);
  const projectId = value.scope === "standalone" ? null : value.projectId.toLowerCase();
  const recordingIds = value.scope === "project" ? [] : value.recordingIds;
  enforceBudget(actorLimit(actor));
  await preflightCreate(client, projectId, recordingIds);
  consumeSharedBudget(projectId ?? [...recordingIds].sort().join(","), value.email);
  const token = randomBytes(32).toString("base64url");
  const hash = hashInvitationToken(token);
  const id = z.uuid().parse(await rpc(client, "create_recording_invitation_v1", { p_token_hash: hash, p_email: value.email, p_role: value.role, p_scope: value.scope === "project" ? "project" : "recordings", p_project_id: projectId, p_recording_ids: recordingIds, p_expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString() }));
  const receipt = await rpc(client, "get_recording_invitation_delivery_v1", { p_invitation_id: id, p_expected_token_hash: hash });
  return deliverReserved(client, receipt, token, origin, deliver);
}

// resendInvitation rotates the token within the existing ID and never bypasses the DB retry budget.
export async function resendInvitation(client: InvitationClient, actor: string, id: string, origin: string, deliver: Delivery = deliverInvitation) {
  id = z.uuid().parse(id).toLowerCase();
  enforceBudget(actorLimit(actor));
  const previous = invitationSummarySchema.parse(await rpc(client, "get_recording_invitation_delivery_v1", { p_invitation_id: id }));
  assertResendWindow(previous);
  consumeSharedBudget(id, previous.email);
  const token = randomBytes(32).toString("base64url");
  let receipt;
  try {
    receipt = await rpc(client, "resend_recording_invitation_v1", { p_invitation_id: id, p_token_hash: hashInvitationToken(token), p_expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString() });
  } catch (error) {
    if (error instanceof InvitationError && error.code === "invitation_retry_limited") {
      const current = invitationSummarySchema.parse(await rpc(client, "get_recording_invitation_delivery_v1", { p_invitation_id: id }));
      assertResendWindow(current);
    }
    throw error;
  }
  return deliverReserved(client, receipt, token, origin, deliver);
}

// previewInvitation projects only safe fields after the database verifies the intended recipient.
export async function previewInvitation(client: InvitationClient, token: string) {
  return invitationPreviewSchema.parse(await rpc(client, "preview_recording_invitation_v1", { p_token_hash: hashInvitationToken(token) }));
}

// acceptInvitation delegates verified-email, TTL, locks and replay decisions to one atomic RPC.
export async function acceptInvitation(client: InvitationClient, token: string) {
  return { id: z.uuid().parse(await rpc(client, "accept_recording_invitation_v1", { p_token_hash: hashInvitationToken(token) })) };
}

// revokeInvitation keeps current manager authorization and accept/revoke serialization in Postgres.
export async function revokeInvitation(client: InvitationClient, id: string) {
  const changed = await rpc(client, "revoke_recording_invitation_v1", { p_invitation_id: z.uuid().parse(id) });
  if (typeof changed !== "boolean") throw new InvitationError(500);
  return { revoked: true, changed };
}

// listAccess returns only the narrow current-manager projection for one scope.
export async function listAccess(client: InvitationClient, scope: { projectId: string | null; recordingId: string | null }) {
  return accessListSchema.parse(await rpc(client, "list_recording_access_v1", { p_project_id: scope.projectId, p_recording_id: scope.recordingId }));
}

// revokeAccess removes an active grant/member through its authoritative manager RPC.
export async function revokeAccess(client: InvitationClient, input: z.infer<typeof revokeAccessSchema>) {
  const value = revokeAccessSchema.parse(input);
  await rpc(client, value.kind === "member" ? "revoke_project_member_v1" : "revoke_recording_grant_v1", value.kind === "member" ? { p_project_id: value.projectId, p_user_id: value.userId } : { p_recording_id: value.recordingId, p_user_id: value.userId });
  return { revoked: true };
}
