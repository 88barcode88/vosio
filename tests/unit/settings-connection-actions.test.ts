import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { listOwnConnectionsAction, revokeOwnConnectionAction } from "@/lib/settings/connection-actions";

const GRANT_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => rpc.mockReset());

describe("listOwnConnectionsAction", () => {
  it("returns the validated own connections from the RPC", async () => {
    rpc.mockResolvedValue({ data: [{ clientName: "Claude", createdAt: "2026-11-06T09:30:00Z", extensionId: null, id: GRANT_ID, scopes: ["vosio:read"] }], error: null });

    const result = await listOwnConnectionsAction();

    expect(rpc).toHaveBeenCalledWith("mcp_list_own_connections_v1");
    expect(result).toMatchObject({ connections: [{ id: GRANT_ID }], ok: true });
  });

  it("treats an installation without the MCP function as an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    expect(await listOwnConnectionsAction()).toEqual({ connections: [], ok: true });
  });

  it("fails on other errors and on unexpected payloads", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect(await listOwnConnectionsAction()).toEqual({ ok: false });
    rpc.mockResolvedValueOnce({ data: [{ id: "bad" }], error: null });
    expect(await listOwnConnectionsAction()).toEqual({ ok: false });
  });
});

describe("revokeOwnConnectionAction", () => {
  it("revokes through the RPC and reports success only for a true result", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await revokeOwnConnectionAction(GRANT_ID)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("mcp_revoke_own_connection_v1", { p_grant_id: GRANT_ID });

    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await revokeOwnConnectionAction(GRANT_ID)).toEqual({ ok: false });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect(await revokeOwnConnectionAction(GRANT_ID)).toEqual({ ok: false });
  });

  it("rejects a malformed grant ID without calling the database", async () => {
    expect(await revokeOwnConnectionAction("nope")).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});
