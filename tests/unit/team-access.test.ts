import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
import { GET } from "../../app/api/team/route";
import { POST, DELETE } from "../../app/api/team/access/route";
import { resolveTeamRole } from "@/lib/team/queries.server";
import { teamAccessMutationSchema } from "@/lib/team/types";
const actor = "10000000-0000-4000-8000-000000000001";
const project = "10000000-0000-4000-8000-000000000002";
const recipient = "10000000-0000-4000-8000-000000000003";
const identity = { scopeKind: "project", scopeId: project, projectId: project, userId: recipient };

// request constructs a real bounded same-origin route request without a provider or live session.
function request(method: string, body: unknown, origin = "https://vosio.test") {
  return new NextRequest("https://vosio.test/api/team/access", { method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("team session RPC boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.mockResolvedValue({ rpc: mocks.rpc, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: actor, email_confirmed_at: "2026-01-01" } }, error: null }) } });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });
  it.each(["installation_admin", "project_founder"])("validates the %s workspace projection", async (role) => {
    const workspace = { role, people: [], invitations: [], scopes: [] };
    mocks.rpc.mockResolvedValue({ data: workspace, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(workspace);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("team_workspace_v1", {});
  });
  it("preserves database denial for member, foreign founder and removed administrator", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private backend data" } });
    expect((await GET()).status).toBe(403);
    expect((await POST(request("POST", { ...identity, role: "editor" }))).status).toBe(403);
    expect((await DELETE(request("DELETE", identity))).status).toBe(403);
  });
  it("sends the exact target through the session RPC rather than trusting a browser role", async () => {
    expect((await POST(request("POST", { ...identity, role: "reader" }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("set_team_access_v1", { p_scope_kind: "project", p_scope_id: project, p_project_id: project, p_user_id: recipient, p_role: "reader" });
    expect((await DELETE(request("DELETE", identity))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("revoke_team_access_v1", { p_scope_kind: "project", p_scope_id: project, p_project_id: project, p_user_id: recipient });
    expect(teamAccessMutationSchema.safeParse({ ...identity, role: "reader", isAdmin: true }).success).toBe(false);
  });
  it("denies unauthenticated and unverified sessions before RPC", async () => {
    for (const user of [null, { id: actor }]) {
      mocks.client.mockResolvedValue({ rpc: mocks.rpc, auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) } });
      expect((await GET()).status).toBe(user ? 403 : 401);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("denies cross-site writes, malformed and oversized payloads before mutation", async () => {
    expect((await POST(request("POST", { ...identity, role: "reader" }, "https://other.test"))).status).toBe(403);
    expect((await POST(request("POST", { ...identity, role: "administrator" }))).status).toBe(400);
    expect((await DELETE(request("DELETE", { ...identity, role: "editor" }))).status).toBe(400);
    expect((await POST(request("POST", { padding: "x".repeat(17_000) }))).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails navigation authority closed when absent, malformed, removed or unavailable", async () => {
    for (const data of [null, "service_role", { role: "installation_admin" }, false]) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect(await resolveTeamRole({ rpc: mocks.rpc })).toBeNull();
    }
    mocks.rpc.mockRejectedValue(new Error("unavailable"));
    expect(await resolveTeamRole({ rpc: mocks.rpc })).toBeNull();
    mocks.rpc.mockResolvedValue({ data: "installation_admin", error: null });
    expect(await resolveTeamRole({ rpc: mocks.rpc })).toBe("installation_admin");
  });
  it("sanitizes backend failures and rejects malformed read projections", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret" } });
    const response = await GET();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
    mocks.rpc.mockResolvedValue({ data: { role: "installation_admin", people: [{ email: "secret" }] }, error: null });
    expect((await GET()).status).toBe(500);
  });
});
