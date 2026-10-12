import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptInvitation, createInvitation, hashInvitationToken, previewInvitation, listAccess, revokeAccess,
  resendInvitation, revokeInvitation, deliverInvitation, invitationCreateSchema,
} from "@/lib/recording-sharing/invitations.server";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), anonymous: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.anonymous }));
vi.mock("@/lib/env", () => ({ getPublicEnv: () => ({ supabaseUrl: "https://auth.example.test", supabasePublishableKey: "public" }) }));

const id = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000002";
const recordingId = "30000000-0000-4000-8000-000000000003";
const token = "x".repeat(43);
const receipt = { id, email: "recipient@example.test", role: "reader", scope: "recordings", expiresAt: "2026-10-01T00:00:00Z", acceptedAt: null, revokedAt: null, attemptId: projectId, attemptCount: 1, deliveryState: "pending", lastAttemptAt: "2026-09-22T00:00:00Z", nextAttemptAt: "2026-09-22T00:01:00Z", authorizationCurrent: true };
const input = { scope: "standalone" as const, recordingIds: [recordingId], email: receipt.email, role: "reader" as const };
const emptyAccess = { members: [], grants: [], invitations: [] };

// client provides RPC receipts only; it cannot simulate PostgreSQL permission enforcement.
function client() {
  return { rpc: vi.fn(async (name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: null | { code: string } }> => {
    expect(args).toBeDefined();
    return { data: name === "create_recording_invitation_v1" || name === "accept_recording_invitation_v1" ? id : name === "settle_recording_invitation_delivery_v1" || name === "revoke_recording_invitation_v1" ? true : name === "list_recording_access_v1" ? emptyAccess : receipt, error: null };
  }) };
}

describe("invitation orchestration (RPC boundary, not database proof)", () => {
  let now = Date.now();
  beforeEach(() => { vi.clearAllMocks(); now += 3_600_001; vi.spyOn(Date, "now").mockReturnValue(now); });

  it("persists only a hash before delivery and settles the exact attempt", async () => {
    const db = client();
    const deliver = vi.fn(async () => true);
    const result = await createInvitation(db, "actor-create", input, "https://vosio.test", deliver);
    const payload = db.rpc.mock.calls.find(([name]) => name === "create_recording_invitation_v1")![1];
    expect(payload).toMatchObject({ p_scope: "recordings", p_project_id: null, p_recording_ids: [recordingId] });
    expect(payload.p_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(db.rpc.mock.invocationCallOrder[0]).toBeLessThan(deliver.mock.invocationCallOrder[0]!);
    expect(db.rpc).toHaveBeenCalledWith("get_recording_invitation_delivery_v1", { p_invitation_id: id, p_expected_token_hash: payload.p_token_hash });
    expect(db.rpc).toHaveBeenCalledWith("settle_recording_invitation_delivery_v1", { p_invitation_id: id, p_attempt_id: projectId, p_delivered: true });
    expect(result).toEqual({ id, delivery: "sent" });
    expect(JSON.stringify(result)).not.toContain(payload.p_token_hash);
  });

  it.each(["project", "project-selected"] as const)("preserves %s scope and exact IDs", async (scope) => {
    const db = client();
    const value = invitationCreateSchema.parse({ email: receipt.email, role: "editor", scope, projectId, ...(scope === "project-selected" ? { recordingIds: [recordingId] } : {}) });
    await createInvitation(db, `actor-${scope}`, value, "https://vosio.test", async () => true);
    expect(db.rpc.mock.calls.find(([name]) => name === "create_recording_invitation_v1")![1]).toMatchObject({ p_scope: scope === "project" ? "project" : "recordings", p_project_id: projectId, p_recording_ids: scope === "project" ? [] : [recordingId] });
  });

  it.each(["project-reader", "project-editor", "outsider", "unrelated-founder"])("does not deliver after DB denies %s", async (actor) => {
    const db = client(); db.rpc.mockResolvedValue({ data: null as never, error: { code: "42501" } });
    const deliver = vi.fn();
    await expect(createInvitation(db, actor, input, "https://vosio.test", deliver)).rejects.toMatchObject({ status: 403 });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("rejects malformed, mixed and excessive scopes before persistence", () => {
    for (const candidate of [{ ...input, projectId }, { ...input, role: "owner" }, { ...input, recordingIds: [] }, { ...input, recordingIds: [recordingId, recordingId] }, { ...input, recordingIds: Array(101).fill(recordingId) }, { ...input, scope: "project", projectId }]) {
      expect(invitationCreateSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("reserves a rotated token on the same ID and reports delivery failure without granting", async () => {
    const db = client();
    const result = await resendInvitation(db, "actor-resend", id, "https://vosio.test", async () => false);
    expect(db.rpc).toHaveBeenCalledWith("resend_recording_invitation_v1", expect.objectContaining({ p_invitation_id: id, p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(result).toEqual({ id, delivery: "failed" });
    expect(db.rpc.mock.calls.some(([name]) => name === "accept_recording_invitation_v1")).toBe(false);
  });

  it("keeps ambiguous mail and stale settlement pending", async () => {
    const db = client();
    expect(await createInvitation(db, "actor-ambiguous", input, "https://vosio.test", async () => { throw new Error("provider secret"); })).toEqual({ id, delivery: "pending" });
    expect(db.rpc.mock.calls.some(([name]) => name === "settle_recording_invitation_delivery_v1")).toBe(false);
    db.rpc.mockImplementation(async (name: string) => ({ data: name === "create_recording_invitation_v1" ? id : name === "settle_recording_invitation_delivery_v1" ? false : name === "list_recording_access_v1" ? emptyAccess : receipt, error: null }));
    expect(await createInvitation(db, "actor-stale", { ...input, email: "other@example.test" }, "https://vosio.test", async () => true)).toEqual({ id, delivery: "pending" });
  });

  it("maps exhausted/cooldown retry to 429 before delivery", async () => {
    const db = client(); db.rpc.mockImplementation(async (name: string) => ({ data: receipt, error: name === "resend_recording_invitation_v1" ? { code: "55000" } : null }));
    const deliver = vi.fn();
    await expect(resendInvitation(db, "actor-limited", id, "https://vosio.test", deliver)).rejects.toMatchObject({ status: 429 });
    expect(deliver).not.toHaveBeenCalled();
  });

  it.each(["wrong-email", "unverified-email", "expired", "old-hash", "revoked", "scope-changed"])("passes %s denial through without a second grant path", async () => {
    const db = client(); db.rpc.mockResolvedValue({ data: null as never, error: { code: "42501" } });
    await expect(acceptInvitation(db, token)).rejects.toMatchObject({ status: 403 });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("accept_recording_invitation_v1", { p_token_hash: hashInvitationToken(token) });
  });

  it("retries accept through the same idempotent RPC and uses narrow revoke", async () => {
    const db = client();
    expect(await acceptInvitation(db, token)).toEqual({ id });
    expect(await acceptInvitation(db, token)).toEqual({ id });
    await revokeInvitation(db, id);
    expect(db.rpc).toHaveBeenLastCalledWith("revoke_recording_invitation_v1", { p_invitation_id: id });
  });

  it("preview only returns allowlisted fields and never redeems", async () => {
    const db = client(); db.rpc.mockResolvedValue({ data: { ...receipt, recordingCount: 1, token_hash: "secret", title: "private" } as never, error: null });
    expect(await previewInvitation(db, token)).toEqual({ id, role: "reader", scope: "recordings", expiresAt: receipt.expiresAt, recordingCount: 1 });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("preview_recording_invitation_v1", { p_token_hash: hashInvitationToken(token) });
  });

  it("lists safe access and revokes project membership / standalone grants via their narrow RPCs", async () => {
    const db = client(); db.rpc.mockResolvedValue({ data: { members: [{ userId: id, role: "reader", secret: "private" }], grants: [], invitations: [], secret: "private" }, error: null });
    expect(await listAccess(db, { projectId, recordingId: null })).toEqual({ members: [{ userId: id, role: "reader" }], grants: [], invitations: [] });
    await revokeAccess(db, { kind: "member", projectId, userId: id });
    expect(db.rpc).toHaveBeenLastCalledWith("revoke_project_member_v1", { p_project_id: projectId, p_user_id: id });
    await revokeAccess(db, { kind: "grant", recordingId, userId: id });
    expect(db.rpc).toHaveBeenLastCalledWith("revoke_recording_grant_v1", { p_recording_id: recordingId, p_user_id: id });
  });

  it.each([["22023", 400], ["XX000", 500]] as const)("sanitizes backend %s", async (code, status) => {
    const db = client(); db.rpc.mockResolvedValue({ data: null, error: { code } });
    await expect(acceptInvitation(db, token)).rejects.toMatchObject({ status });
  });

  it("stops repeated recipient requests across different actors before another reservation", async () => {
    const db = client();
    for (let i = 0; i < 5; i++) await createInvitation(db, `budget-actor-${i}`, input, "https://vosio.test", async () => true);
    const reservations = db.rpc.mock.calls.filter(([name]) => name === "create_recording_invitation_v1").length;
    await expect(createInvitation(db, "another-actor", input, "https://vosio.test", async () => true)).rejects.toMatchObject({ status: 429 });
    expect(db.rpc).toHaveBeenLastCalledWith("list_recording_access_v1", { p_project_id: null, p_recording_id: recordingId });
    expect(db.rpc.mock.calls.filter(([name]) => name === "create_recording_invitation_v1")).toHaveLength(reservations);
  });

  it("stops an actor spreading invitations across different recipients", async () => {
    const db = client();
    for (let i = 0; i < 20; i++) await createInvitation(db, "one-actor", { ...input, email: `actor-limit-${i}@example.test` }, "https://vosio.test", async () => true);
    await expect(createInvitation(db, "one-actor", { ...input, email: "actor-limit-next@example.test" }, "https://vosio.test", async () => true)).rejects.toMatchObject({ status: 429 });
  });

  it("stops a scope spreading invitations across different actors/recipients", async () => {
    const db = client();
    for (let i = 0; i < 30; i++) await createInvitation(db, `scope-actor-${i}`, { ...input, email: `scope-limit-${i}@example.test` }, "https://vosio.test", async () => true);
    await expect(createInvitation(db, "scope-actor-next", { ...input, email: "scope-limit-next@example.test" }, "https://vosio.test", async () => true)).rejects.toMatchObject({ status: 429 });
  });

  it.each([5, 31])("does not let %s denied managers consume scope/recipient shared budgets", async (attempts) => {
    const denied = client(); denied.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    for (let index = 0; index < attempts; index++) {
      await expect(createInvitation(denied, `denied-${index}`, input, "https://vosio.test", async () => true)).rejects.toMatchObject({ status: 403 });
    }
    expect(denied.rpc.mock.calls.every(([name]) => name === "list_recording_access_v1")).toBe(true);
    await expect(createInvitation(client(), "authorized", input, "https://vosio.test", async () => true)).resolves.toEqual({ id, delivery: "sent" });
  });

  it("preflights every exact standalone item and stops on any manager denial", async () => {
    const db = client(); const original = db.rpc.getMockImplementation()!;
    db.rpc.mockImplementation(async (name, args) => args.p_recording_id === projectId ? { data: null, error: { code: "42501" } } : original(name, args));
    await expect(createInvitation(db, "mixed-owner", { ...input, recordingIds: [recordingId, projectId] }, "https://vosio.test", async () => true)).rejects.toMatchObject({ status: 403 });
    expect(db.rpc).toHaveBeenCalledWith("list_recording_access_v1", { p_project_id: null, p_recording_id: recordingId });
    expect(db.rpc).toHaveBeenCalledWith("list_recording_access_v1", { p_project_id: null, p_recording_id: projectId });
    expect(db.rpc.mock.calls.some(([name]) => name === "create_recording_invitation_v1")).toBe(false);
    await expect(createInvitation(client(), "authorized-after-mixed", input, "https://vosio.test", async () => true)).resolves.toMatchObject({ id });
  });

  it.each(["project", "project-selected"] as const)("preflights founder authority for %s before create", async (scope) => {
    const db = client();
    await createInvitation(db, `preflight-${scope}`, invitationCreateSchema.parse({ scope, projectId, email: receipt.email, role: "reader", ...(scope === "project-selected" ? { recordingIds: [recordingId] } : {}) }), "https://vosio.test", async () => true);
    expect(db.rpc.mock.calls[0]).toEqual(["list_recording_access_v1", { p_project_id: projectId, p_recording_id: null }]);
  });

  it("keeps DB create authoritative when authority changes after preflight", async () => {
    const db = client(); const original = db.rpc.getMockImplementation()!; const deliver = vi.fn();
    db.rpc.mockImplementation(async (name, args) => name === "create_recording_invitation_v1" ? { data: null, error: { code: "42501" } } : original(name, args));
    await expect(createInvitation(db, "changed-manager", input, "https://vosio.test", deliver)).rejects.toMatchObject({ status: 403 });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("preserves the actual remaining rate-limit window", async () => {
    const db = client();
    for (let index = 0; index < 5; index++) await createInvitation(db, `window-${index}`, input, "https://vosio.test", async () => true);
    vi.spyOn(Date, "now").mockReturnValue(now + 90_000);
    await expect(createInvitation(db, "window-next", input, "https://vosio.test", async () => true)).rejects.toMatchObject({ status: 429, code: "rate_limited", retryAfterSeconds: 3510 });
  });

  it.each([true, false])("returns strict revoke receipt for changed=%s without removing grants", async (changed) => {
    const db = client(); db.rpc.mockResolvedValue({ data: changed, error: null });
    await expect(revokeInvitation(db, id)).resolves.toEqual({ revoked: true, changed });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("revoke_recording_invitation_v1", { p_invitation_id: id });
  });

  it.each([null, undefined, "true", { changed: true }])("rejects malformed revoke receipt %j", async (data) => {
    const db = client(); db.rpc.mockResolvedValue({ data, error: null });
    await expect(revokeInvitation(db, id)).rejects.toMatchObject({ status: 500 });
  });

  it("maps accepted-first revoke to conflict, never revoked success", async () => {
    const db = client(); db.rpc.mockResolvedValue({ data: null, error: { code: "55000" } });
    await expect(revokeInvitation(db, id)).rejects.toMatchObject({ status: 409, code: "invitation_not_pending" });
  });

  it("keeps revoke-first acceptance denied without a fallback grant path", async () => {
    const db = client(); db.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(revokeInvitation(db, id)).resolves.toEqual({ revoked: true, changed: true });
    await expect(acceptInvitation(db, token)).rejects.toMatchObject({ status: 403 });
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });

  it("distinguishes terminal delivery exhaustion from cooldown without sending", async () => {
    const db = client(); const deliver = vi.fn();
    db.rpc.mockResolvedValue({ data: { ...receipt, attemptCount: 5 }, error: null });
    await expect(resendInvitation(db, "exhausted", id, "https://vosio.test", deliver)).rejects.toMatchObject({ status: 409, code: "invitation_attempts_exhausted" });
    expect(deliver).not.toHaveBeenCalled();
    db.rpc.mockResolvedValue({ data: { ...receipt, nextAttemptAt: new Date(now + 42_001).toISOString() }, error: null });
    await expect(resendInvitation(db, "cooldown", id, "https://vosio.test", deliver)).rejects.toMatchObject({ status: 429, code: "invitation_cooldown", retryAfterSeconds: 43 });
    expect(db.rpc.mock.calls.some(([name]) => name === "resend_recording_invitation_v1")).toBe(false);
  });

  it("refreshes the authorized receipt after a concurrent resend reaches its terminal attempt", async () => {
    const db = client(); const deliver = vi.fn();
    db.rpc.mockResolvedValueOnce({ data: { ...receipt, attemptCount: 4 }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "55000" } })
      .mockResolvedValueOnce({ data: { ...receipt, attemptCount: 5 }, error: null });
    await expect(resendInvitation(db, "racing-resend", id, "https://vosio.test", deliver)).rejects.toMatchObject({ status: 409, code: "invitation_attempts_exhausted" });
    expect(deliver).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.filter(([name]) => name === "get_recording_invitation_delivery_v1")).toHaveLength(2);
  });

  it("classifies a concurrent cooldown from its current receipt without guessing sixty seconds", async () => {
    const db = client();
    db.rpc.mockResolvedValueOnce({ data: receipt, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "55000" } })
      .mockResolvedValueOnce({ data: { ...receipt, nextAttemptAt: new Date(now + 17_001).toISOString() }, error: null });
    await expect(resendInvitation(db, "racing-cooldown", id, "https://vosio.test", async () => true)).rejects.toMatchObject({ status: 429, code: "invitation_cooldown", retryAfterSeconds: 18 });
  });

  it.each(["invalid-date", "accepted", "revoked"])("fails closed on unusable resend receipt %s", async (state) => {
    const db = client();
    db.rpc.mockResolvedValue({ data: { ...receipt, ...(state === "invalid-date" ? { nextAttemptAt: "invalid" } : state === "accepted" ? { acceptedAt: "2026-01-01" } : { revokedAt: "2026-01-01" }) }, error: null });
    await expect(resendInvitation(db, `invalid-${state}`, id, "https://vosio.test", async () => true)).rejects.toMatchObject({ status: state === "invalid-date" ? 500 : 403 });
    expect(db.rpc).toHaveBeenCalledOnce();
  });
});

describe("Auth delivery", () => {
  it("uses a server invite and sends the app token only in a URL fragment", async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ error: null });
    mocks.admin.mockReturnValue({ auth: { admin: { inviteUserByEmail } } });
    expect(await deliverInvitation(receipt.email, token, "https://vosio.test")).toBe(true);
    const url = new URL(inviteUserByEmail.mock.calls[0]![1].redirectTo);
    expect(url.search).toBe(""); expect(url.hash).toContain(token);
    expect(mocks.anonymous).not.toHaveBeenCalled();
  });

  it("falls back for an existing account using OTP with account creation disabled", async () => {
    mocks.admin.mockReturnValue({ auth: { admin: { inviteUserByEmail: vi.fn().mockResolvedValue({ error: { code: "email_exists" } }) } } });
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.anonymous.mockReturnValue({ auth: { signInWithOtp } });
    expect(await deliverInvitation(receipt.email, token, "https://vosio.test")).toBe(true);
    expect(signInWithOtp).toHaveBeenCalledWith({ email: receipt.email, options: { shouldCreateUser: false, emailRedirectTo: expect.stringContaining("#token=") } });
  });

  it("does not turn other Auth errors into an account lookup or signup", async () => {
    mocks.anonymous.mockClear();
    mocks.admin.mockReturnValue({ auth: { admin: { inviteUserByEmail: vi.fn().mockResolvedValue({ error: { code: "over_email_send_rate_limit" } }) } } });
    expect(await deliverInvitation(receipt.email, token, "https://vosio.test")).toBe(false);
    expect(mocks.anonymous).not.toHaveBeenCalled();
  });

  it("reports failed existing-account OTP without exposing provider text", async () => {
    mocks.admin.mockReturnValue({ auth: { admin: { inviteUserByEmail: vi.fn().mockResolvedValue({ error: { code: "user_already_exists" } }) } } });
    mocks.anonymous.mockReturnValue({ auth: { signInWithOtp: vi.fn().mockResolvedValue({ error: { code: "over_email_send_rate_limit" } }) } });
    expect(await deliverInvitation(receipt.email, token, "https://vosio.test")).toBe(false);
  });
});
