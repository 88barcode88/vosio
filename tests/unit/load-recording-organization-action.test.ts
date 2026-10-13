import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRecordingOrganizationAction } from "@/lib/recording-organization/load-recording-action";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), capabilities: vi.fn(), recording: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/recording-sharing/resolve-capabilities", () => ({ resolveRecordingCapabilities: mocks.capabilities }));
vi.mock("@/lib/recordings/queries", () => ({ getRecordingById: mocks.recording }));

const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user" } }, error: null }) } });
  mocks.capabilities.mockResolvedValue({ manageAccess: true });
  mocks.recording.mockResolvedValue({ id, visibility: "private", client_id: "client", project_id: "project",
    folder_id: "folder", tag_ids: ["tag"], storage_path: "private-object", user_id: "owner" });
});

describe("lazy row organization read", () => {
  it("preserves all assignment ids without serializing private ownership or storage", async () => {
    expect(await loadRecordingOrganizationAction(id)).toEqual({ id, client_id: "client", project_id: "project",
      folder_id: "folder", tag_ids: ["tag"] });
  });
  it("rejects missing authority before reading the recording", async () => {
    mocks.capabilities.mockResolvedValue({ manageAccess: false });
    expect(await loadRecordingOrganizationAction(id)).toBeNull();
    expect(mocks.recording).not.toHaveBeenCalled();
  });
  it("rejects shared custody even for managers", async () => {
    mocks.recording.mockResolvedValue({ id, visibility: "project" });
    expect(await loadRecordingOrganizationAction(id)).toBeNull();
  });
  it("rejects expired sessions and invalid ids", async () => {
    expect(await loadRecordingOrganizationAction("bad-id")).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } });
    expect(await loadRecordingOrganizationAction(id)).toBeNull();
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });
});
