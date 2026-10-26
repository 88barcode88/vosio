import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
import { POST } from "../../app/api/team/access/batch/route";
import { teamAccessBatchMutationSchema } from "@/lib/team/types";

const actor = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const scopeId = "10000000-0000-4000-8000-000000000004";
const input = { requestId, userId, role: "reader", scopes: [{ scopeKind: "client", scopeId, projectId: null }] };

// request exercises the real session/CSRF/body boundary with an inert RPC transport.
function request(body: unknown, origin = "https://vosio.test") {
  return new NextRequest("https://vosio.test/api/team/access/batch", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("atomic team grant command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.mockResolvedValue({ rpc: mocks.rpc, auth: { getUser: vi.fn().mockResolvedValue({
      data: { user: { id: actor, email_confirmed_at: "2026-01-01" } }, error: null,
    }) } });
    mocks.rpc.mockResolvedValue({ data: { saved: true, count: 1 }, error: null });
  });
  it("sends one exact command and validates its receipt without a single-grant loop", async () => {
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true, count: 1 });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("set_team_access_batch_v1", {
      p_request_id: requestId, p_user_id: userId, p_role: "reader", p_scopes: input.scopes,
    });
  });
  it.each([
    { ...input, scopes: [] },
    { ...input, scopes: Array.from({ length: 101 }, () => input.scopes[0]) },
    { ...input, scopes: [input.scopes[0], input.scopes[0]] },
    { ...input, scopes: [{ ...input.scopes[0], visibility: "selected" }] },
    { ...input, role: "founder" },
    { ...input, requestId: "not-a-uuid" },
  ])("rejects malformed and unbounded commands before RPC", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps fixed project boundaries and recording choices distinct", () => {
    expect(teamAccessBatchMutationSchema.safeParse({ ...input, scopes: [
      input.scopes[0], { ...input.scopes[0], projectId: scopeId },
      { scopeKind: "recording", scopeId, projectId: null },
    ] }).success).toBe(true);
  });
  it("rejects same-UUID duplicates regardless of hexadecimal case", () => {
    const alpha = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(teamAccessBatchMutationSchema.safeParse({ ...input, scopes: [
      { ...input.scopes[0], scopeId: alpha }, { ...input.scopes[0], scopeId: alpha.toUpperCase() },
    ] }).success).toBe(false);
  });
  it.each([{ saved: false, count: 1 }, { saved: true, count: 2 }, null])("fails closed for an unconfirmed receipt", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await POST(request(input))).status).toBe(500);
  });
  it("does not leak backend denial details", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private backend details" } });
    const response = await POST(request(input));
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private backend");
  });
  it("rejects cross-site requests before reading session or RPC", async () => {
    expect((await POST(request(input, "https://foreign.test"))).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects an unverified session before RPC", async () => {
    mocks.client.mockResolvedValue({ rpc: mocks.rpc, auth: { getUser: vi.fn().mockResolvedValue({
      data: { user: { id: actor, email_confirmed_at: null } }, error: null,
    }) } });
    expect((await POST(request(input))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
