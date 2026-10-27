import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRecordingOrganizationAction } from "@/lib/recording-organization/load-recording-action";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), capabilities: vi.fn(), recording: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/recording-sharing/resolve-capabilities", () => ({ resolveRecordingCapabilities: mocks.capabilities }));
vi.mock("@/lib/recordings/queries", () => ({ getRecordingById: mocks.recording }));

const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user" } }, error: null }) } });
  mocks.rpc.mockResolvedValue({ data: { id, visibility: "private", client_id: "client", project_id: "project", folder_id: "folder", tag_ids: ["tag"], organization_policy: { personalEditable: true, projectIds: ["project"] } }, error: null });
  mocks.capabilities.mockResolvedValue({ manageAccess: true });
  mocks.recording.mockResolvedValue({ id, visibility: "private", client_id: "client", project_id: "project",
    folder_id: "folder", tag_ids: ["tag"], storage_path: "private-object", user_id: "owner" });
});

describe("lazy row organization read", () => {
  it("preserves all assignment ids without serializing private ownership or storage", async () => {
    expect(await loadRecordingOrganizationAction(id)).toEqual((await mocks.rpc()).data);
  });
  it("rejects missing authority before reading the recording", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await loadRecordingOrganizationAction(id)).toBeNull();
    expect(mocks.recording).not.toHaveBeenCalled();
  });
  it.each(["selected", "project"])("loads %s only through the current manager contract", async (visibility) => {
    const data = { ...(await mocks.rpc()).data, visibility };
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await loadRecordingOrganizationAction(id)).toEqual(data);
    expect(mocks.rpc).toHaveBeenCalledWith("recording_organization_context_v1", { p_recording_id: id });
    expect(mocks.recording).not.toHaveBeenCalled();
  });
  it("rejects expired sessions and invalid ids", async () => {
    expect(await loadRecordingOrganizationAction("bad-id")).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } });
    expect(await loadRecordingOrganizationAction(id)).toBeNull();
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });
});
