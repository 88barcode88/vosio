import { describe, expect, it, vi, beforeEach } from "vitest";
import TeamPage from "@/../app/team/page";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), resolve: vi.fn(), load: vi.fn(), client: { auth: { getUser: vi.fn() } } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); }, redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/lib/team/queries.server", () => ({ resolveTeamRole: mocks.resolve, loadTeamWorkspace: mocks.load }));
vi.mock("@/components/vosio-workspace", () => ({ VosioWorkspace: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.auth.getUser.mockResolvedValue({ data: { user: { id: "user", email: "owner@example.test" } } });
  mocks.resolve.mockResolvedValue("project_founder");
  mocks.load.mockResolvedValue({ role: "project_founder", people: [], invitations: [], scopes: [] });
});

describe("Team server route authority", () => {
  it("redirects signed-out users before any Team authority or projection request", async () => {
    mocks.client.auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(TeamPage()).rejects.toThrow("redirect:/login?next=/team");
    expect(mocks.resolve).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("does not load management data for ordinary or removed roles", async () => {
    mocks.resolve.mockResolvedValue(null);
    await expect(TeamPage()).rejects.toThrow("not-found");
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each(["installation_admin", "project_founder"])("uses a fresh session role before projection for %s", async role => {
    mocks.resolve.mockResolvedValue(role);
    const result = await TeamPage();
    expect(mocks.resolve).toHaveBeenCalledWith(mocks.client);
    expect(mocks.load).toHaveBeenCalledWith(mocks.client);
    expect(mocks.resolve.mock.invocationCallOrder[0]).toBeLessThan(mocks.load.mock.invocationCallOrder[0]);
    expect(result.props.canManageTeam).toBe(true);
    expect(result.props.view).toBe("team");
  });
});
