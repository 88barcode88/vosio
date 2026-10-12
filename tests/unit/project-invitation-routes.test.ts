import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), create: vi.fn(), preview: vi.fn(), accept: vi.fn(), resend: vi.fn(), revoke: vi.fn(), revokeAccess: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/recording-sharing/invitations.server", async (original) => ({ ...await original<object>(), createInvitation: mocks.create, previewInvitation: mocks.preview, acceptInvitation: mocks.accept, resendInvitation: mocks.resend, revokeInvitation: mocks.revoke, revokeAccess: mocks.revokeAccess, listAccess: mocks.list }));
import { GET, POST, DELETE as revokeAccessRoute } from "../../app/api/recording-invitations/route";
import { InvitationError } from "@/lib/recording-sharing/invitations.server";
import { POST as accept } from "../../app/api/recording-invitations/accept/route";
import { PATCH, DELETE } from "../../app/api/recording-invitations/[invitationId]/route";
import { GET as callback } from "../../app/auth/callback/route";
import { verifyInvitationIdentityAction } from "@/lib/auth/actions";
const id = "10000000-0000-4000-8000-000000000001";
const token = "x".repeat(43);

// request creates an explicit same-origin browser mutation with a bounded JSON body.
function request(path: string, method = "POST", body: unknown = { token }, origin = "https://vosio.test") {
  return new NextRequest(`https://vosio.test${path}`, { method, headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
}

describe("invitation HTTP boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id, email_confirmed_at: "2026-01-01" } }, error: null }) } });
    mocks.create.mockResolvedValue({ id, delivery: "sent" }); mocks.preview.mockResolvedValue({ id, role: "reader" }); mocks.accept.mockResolvedValue({ id });
    mocks.revoke.mockResolvedValue({ revoked: true, changed: true });
    mocks.revokeAccess.mockResolvedValue({ revoked: true });
  });
  it("rejects cross-origin and missing-origin mutation before auth", async () => {
    for (const origin of ["https://evil.test", "null", ""]) {
      expect((await POST(request("/api/recording-invitations", "POST", {}, origin))).status).toBe(403);
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("requires a verified session for all preview and acceptance", async () => {
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } });
    expect((await accept(request("/api/recording-invitations/accept"))).status).toBe(401);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("rejects an unverified session and Auth errors before any RPC", async () => {
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id } }, error: null }) } });
    expect((await accept(request("/api/recording-invitations/accept"))).status).toBe(403);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("keeps preview tokens out of URLs and GET/prefetch never grants", async () => {
    const req = new NextRequest("https://vosio.test/api/recording-invitations", { headers: { "x-invitation-token": token, purpose: "prefetch" } });
    const response = await GET(req);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.preview).toHaveBeenCalled(); expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("accepts only explicit POST and rejects malformed payload", async () => {
    expect((await accept(request("/api/recording-invitations/accept"))).status).toBe(200);
    expect((await accept(request("/api/recording-invitations/accept", "POST", { token: "short" }))).status).toBe(400);
  });
  it("creates and resends without returning account existence or token", async () => {
    const body = { scope: "project", projectId: id, email: "recipient@example.test", role: "reader" };
    expect(await (await POST(request("/api/recording-invitations", "POST", body))).json()).toEqual({ id, delivery: "sent" });
    mocks.resend.mockResolvedValue({ id, delivery: "failed" });
    expect(await (await PATCH(request(`/api/recording-invitations/${id}`, "PATCH", {}), { params: Promise.resolve({ invitationId: id }) })).json()).toEqual({ id, delivery: "failed" });
  });
  it("validates route IDs and uses explicit DELETE for revoke", async () => {
    expect((await DELETE(request("/api/recording-invitations/invalid", "DELETE"), { params: Promise.resolve({ invitationId: "invalid" }) })).status).toBe(400);
    expect((await DELETE(request(`/api/recording-invitations/${id}`, "DELETE"), { params: Promise.resolve({ invitationId: id }) })).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalled();
  });
  it("sanitizes unexpected failures", async () => {
    mocks.accept.mockRejectedValue(new Error(`secret ${token}`));
    const response = await accept(request("/api/recording-invitations/accept"));
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain(token);
  });
  it("rejects oversized, invalid JSON and wrong content type", async () => {
    expect((await accept(request("/api/recording-invitations/accept", "POST", { token: "x".repeat(20_000) }))).status).toBe(413);
    const invalid = new NextRequest("https://vosio.test/api/recording-invitations/accept", { method: "POST", headers: { origin: "https://vosio.test", "content-type": "application/json" }, body: "{" });
    expect((await accept(invalid)).status).toBe(400);
    const wrongType = new NextRequest("https://vosio.test/api/recording-invitations/accept", { method: "POST", headers: { origin: "https://vosio.test", "content-type": "text/plain" }, body: "{}" });
    expect((await accept(wrongType)).status).toBe(400);
  });
  it("lists exactly one safe scope and rejects token query parameters", async () => {
    mocks.list.mockResolvedValue({ members: [], grants: [], invitations: [] });
    expect((await GET(new NextRequest(`https://vosio.test/api/recording-invitations?projectId=${id}`))).status).toBe(200);
    expect((await GET(new NextRequest(`https://vosio.test/api/recording-invitations?projectId=${id}&recordingId=${id}`))).status).toBe(400);
    expect((await GET(new NextRequest(`https://vosio.test/api/recording-invitations?token=${token}`))).status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("failed callback exchange never redirects to accepted content or grants", async () => {
    mocks.createClient.mockResolvedValue({ auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: new Error("secret") }) } });
    const response = await callback(new NextRequest("https://vosio.test/auth/callback?code=bad&next=/invitations/accept"));
    expect(response.headers.get("location")).toContain("/login?error=");
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("rejects invalid OTP callback types without verifying", async () => {
    const response = await callback(new NextRequest("https://vosio.test/auth/callback?token_hash=hash&type=signup"));
    expect(response.headers.get("location")).toContain("/login?error=");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("verifies a supported callback type and allowlists its destination without accepting", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { verifyOtp } });
    const response = await callback(new NextRequest("https://vosio.test/auth/callback?token_hash=hash&type=invite&next=/invitations/accept"));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash", type: "invite" });
    expect(response.headers.get("location")).toBe("https://vosio.test/invitations/accept");
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("requires a verified invitation before initial password setup and never grants during onboarding", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { verifyOtp, updateUser, getUser: vi.fn().mockResolvedValue({ data: { user: { id, email_confirmed_at: "2026-01-01" } }, error: null }) } });
    const input = { token, type: "invite", email: "recipient@example.test", code: "123456", password: "safe-test-password", confirmation: "safe-test-password" };
    expect(await verifyInvitationIdentityAction(input)).toMatchObject({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({ password: input.password });
    expect(mocks.preview.mock.invocationCallOrder[0]).toBeLessThan(updateUser.mock.invocationCallOrder[0]!);
    expect(mocks.accept).not.toHaveBeenCalled();
    updateUser.mockClear(); mocks.preview.mockRejectedValue(new Error("wrong email"));
    expect(await verifyInvitationIdentityAction(input)).toMatchObject({ ok: false });
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("does not accept invalid OTP types or failed Auth verification", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: new Error("secret") });
    mocks.createClient.mockResolvedValue({ auth: { verifyOtp } });
    const input = { token, type: "email", email: "recipient@example.test", code: "123456" };
    expect(await verifyInvitationIdentityAction({ ...input, type: "signup" })).toMatchObject({ ok: false });
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(await verifyInvitationIdentityAction(input)).toMatchObject({ ok: false });
    expect(mocks.accept).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  });

  it.each([true, false])("preserves invitation revoke changed=%s in its 200 receipt", async (changed) => {
    mocks.revoke.mockResolvedValue({ revoked: true, changed });
    const response = await DELETE(request(`/api/recording-invitations/${id}`, "DELETE"), { params: Promise.resolve({ invitationId: id }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ revoked: true, changed });
    expect(mocks.revokeAccess).not.toHaveBeenCalled();
  });

  it("reports accepted-first revoke as invitation_not_pending without a retry promise", async () => {
    mocks.revoke.mockRejectedValue(new InvitationError(409, { code: "invitation_not_pending" }));
    const response = await DELETE(request(`/api/recording-invitations/${id}`, "DELETE"), { params: Promise.resolve({ invitationId: id }) });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "invitation_not_pending" });
    expect(response.headers.get("retry-after")).toBeNull(); expect(mocks.revokeAccess).not.toHaveBeenCalled();
  });

  it("returns actual local retry seconds and no Retry-After for terminal exhaustion", async () => {
    mocks.resend.mockRejectedValue(new InvitationError(429, { code: "rate_limited", retryAfterSeconds: 3510 }));
    const context = { params: Promise.resolve({ invitationId: id }) };
    const limited = await PATCH(request(`/api/recording-invitations/${id}`, "PATCH"), context);
    expect(limited.headers.get("retry-after")).toBe("3510");
    expect(await limited.json()).toMatchObject({ code: "rate_limited", retryAfterSeconds: 3510 });
    mocks.resend.mockRejectedValue(new InvitationError(409, { code: "invitation_attempts_exhausted" }));
    const exhausted = await PATCH(request(`/api/recording-invitations/${id}`, "PATCH"), context);
    expect(exhausted.status).toBe(409); expect(exhausted.headers.get("retry-after")).toBeNull();
    expect(await exhausted.json()).toMatchObject({ code: "invitation_attempts_exhausted" });
  });

  it("protects root DELETE origin, bounded body and session before removing active access", async () => {
    const body = { kind: "grant", recordingId: id, userId: id };
    expect((await revokeAccessRoute(request("/api/recording-invitations", "DELETE", body, "https://evil.test"))).status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect((await revokeAccessRoute(request("/api/recording-invitations", "DELETE", { ...body, admin: true }))).status).toBe(400);
    expect((await revokeAccessRoute(request("/api/recording-invitations", "DELETE", { payload: "x".repeat(20_000) }))).status).toBe(413);
    expect(mocks.revokeAccess).not.toHaveBeenCalled();
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } });
    expect((await revokeAccessRoute(request("/api/recording-invitations", "DELETE", body))).status).toBe(401);
    expect(mocks.revokeAccess).not.toHaveBeenCalled();
  });

  it.each(["member", "grant"])("keeps root DELETE %s distinct from pending-invitation revoke", async (kind) => {
    const body = kind === "member" ? { kind, projectId: id, userId: id } : { kind, recordingId: id, userId: id };
    const response = await revokeAccessRoute(request("/api/recording-invitations", "DELETE", body));
    expect(response.status).toBe(200); expect(mocks.revokeAccess).toHaveBeenCalledWith(expect.anything(), body);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it.each(["", "?code=a&token_hash=b&type=invite", "?token_hash=a&type=signup", "?code=bad", "?code=throws"])("protects callback failure headers for %s", async (query) => {
    mocks.createClient.mockResolvedValue({ auth: { exchangeCodeForSession: query.includes("throws") ? vi.fn().mockRejectedValue(new Error("private")) : vi.fn().mockResolvedValue({ error: new Error("private") }) } });
    const response = await callback(new NextRequest(`https://vosio.test/auth/callback${query}`));
    expect(response.headers.get("location")).toContain("/login?error=");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
