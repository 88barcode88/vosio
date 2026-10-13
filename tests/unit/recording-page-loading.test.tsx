import { beforeEach, describe, expect, it, vi } from "vitest";
import RecordingsPage from "../../app/recordings/page";
import RecordingDetailPage from "../../app/recordings/[recordingId]/page";

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  countStatuses: vi.fn(),
  createClient: vi.fn(),
  getRecording: vi.fn(),
  listMarkers: vi.fn(),
  listOptions: vi.fn(),
  listRecordings: vi.fn(),
  listTranscripts: vi.fn(),
  organization: vi.fn(),
  search: vi.fn()
}));

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not-found"); },
  redirect: (href: string) => { throw new Error(`redirect:${href}`); }
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/recording-sharing/resolve-capabilities", () => ({ resolveRecordingCapabilities: mocks.capabilities }));
vi.mock("@/lib/recordings/queries", () => ({
  getRecordingById: mocks.getRecording,
  listRecordings: mocks.listRecordings,
  countOwnRecordingStatuses: mocks.countStatuses
}));
vi.mock("@/lib/recordings/search", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/recordings/search")>(),
  searchOwnRecordings: mocks.search
}));
vi.mock("@/lib/recording-organization/queries", () => ({
  getRecordingOrganization: mocks.organization,
  listRecordingOrganizationOptions: mocks.listOptions
}));
vi.mock("@/lib/recording-markers/queries", () => ({ listRecordingMarkers: mocks.listMarkers }));
vi.mock("@/lib/transcripts/queries", () => ({ listTranscriptsForRecording: mocks.listTranscripts }));
vi.mock("@/lib/recordings/audio-locator.server", () => ({ getAuthorizedAudioLocator: async () => null }));

const options = { clients: [], projects: [], folders: [], tags: [] };
const organization = { client: null, project: null, folder: null, tags: [] };
const capabilities = { read: true, editTitle: true };

// deferred holds a database response until the test checks which other reads started.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  const threadQuery = { select: vi.fn(), eq: vi.fn(), limit: vi.fn() };
  threadQuery.select.mockReturnValue(threadQuery);
  threadQuery.eq.mockReturnValue(threadQuery);
  threadQuery.limit.mockResolvedValue({ data: [], error: null });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1", user_metadata: {} } } }) },
    from: () => threadQuery
  });
  mocks.capabilities.mockResolvedValue(capabilities);
  mocks.countStatuses.mockResolvedValue({ deleted: 0 });
  mocks.listOptions.mockResolvedValue(options);
  mocks.listRecordings.mockResolvedValue([{ id: "recording-1" }]);
  mocks.search.mockResolvedValue({ page: 1, pageSize: 25, results: [{ id: "recording-1" }], totalCount: 1 });
  mocks.getRecording.mockResolvedValue({ id: "recording-1" });
  mocks.listMarkers.mockResolvedValue([]);
  mocks.listTranscripts.mockResolvedValue([]);
  mocks.organization.mockResolvedValue(organization);
});

describe("recording page read scheduling", () => {
  it.each([false, true])("resolves row authority while options are pending (search=%s)", async (search) => {
    const pendingOptions = deferred<typeof options>();
    const pendingCapabilities = deferred<typeof capabilities>();
    mocks.listOptions.mockReturnValue(pendingOptions.promise);
    mocks.capabilities.mockReturnValue(pendingCapabilities.promise);
    let rendered = false;
    const page = RecordingsPage({ searchParams: Promise.resolve(search ? { q: "call" } : {}) })
      .then((element) => { rendered = true; return element; });

    try {
      await vi.waitFor(() => expect(mocks.capabilities).toHaveBeenCalledWith(expect.anything(), "recording-1"));
      pendingOptions.resolve(options);
      await Promise.resolve();
      expect(rendered).toBe(false);
      pendingCapabilities.resolve(capabilities);
      const element = await page;
      const rows = search ? element.props.recordingSearchPage.results : element.props.recordings;
      expect(rows[0].capabilities).toBe(capabilities);
      expect(mocks.capabilities).toHaveBeenCalledOnce();
    } finally {
      pendingOptions.resolve(options);
      pendingCapabilities.resolve(capabilities);
      await page;
    }
  });

  it("loads assignment after the authorized row without waiting for transcripts", async () => {
    const pendingTranscript = deferred<never[]>();
    mocks.listTranscripts.mockReturnValue(pendingTranscript.promise);
    const page = RecordingDetailPage({
      params: Promise.resolve({ recordingId: "recording-1" }), searchParams: Promise.resolve({})
    });
    try {
      await vi.waitFor(() => expect(mocks.organization).toHaveBeenCalledWith(expect.anything(), { id: "recording-1" }));
      pendingTranscript.resolve([]);
      const element = await page;
      expect(element.props.recordingOrganization).toBe(organization);
      expect(mocks.organization).toHaveBeenCalledOnce();
    } finally {
      pendingTranscript.resolve([]);
      await page;
    }
  });

  it("denies detail access before starting content or organization reads", async () => {
    mocks.capabilities.mockResolvedValue({ read: false });
    await expect(RecordingDetailPage({
      params: Promise.resolve({ recordingId: "recording-1" }), searchParams: Promise.resolve({})
    })).rejects.toThrow("not-found");
    for (const read of [mocks.getRecording, mocks.listMarkers, mocks.listTranscripts, mocks.listOptions, mocks.organization]) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("does not load organization for a missing authorized row", async () => {
    mocks.getRecording.mockResolvedValue(null);
    await expect(RecordingDetailPage({
      params: Promise.resolve({ recordingId: "recording-1" }), searchParams: Promise.resolve({})
    })).rejects.toThrow("not-found");
    expect(mocks.organization).not.toHaveBeenCalled();
  });
});
