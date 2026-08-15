import { beforeEach, describe, expect, it, vi } from "vitest";
import RecordingPage from "../../app/recordings/page";
import { RECORDING_SEARCH_MAX_PAGE } from "@/lib/recordings/search";

const mocks = vi.hoisted(() => ({
  countDeleted: vi.fn(),
  countStatuses: vi.fn(),
  createClient: vi.fn(),
  listOptions: vi.fn(),
  listRecordings: vi.fn(),
  redirect: vi.fn(),
  searchOwnRecordings: vi.fn()
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/recording-organization/queries", () => ({
  listRecordingOrganizationOptions: mocks.listOptions
}));
vi.mock("@/lib/recordings/queries", () => ({
  countDeletedRecordings: mocks.countDeleted,
  countOwnRecordingStatuses: mocks.countStatuses,
  listRecordings: mocks.listRecordings
}));
vi.mock("@/lib/recordings/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/recordings/search")>()),
  searchOwnRecordings: mocks.searchOwnRecordings
}));

const clientId = "00000000-0000-4000-8000-000000000301";
const projectId = "00000000-0000-4000-8000-000000000302";
const folderId = "00000000-0000-4000-8000-000000000303";
const tagA = "00000000-0000-4000-8000-000000000304";
const tagB = "00000000-0000-4000-8000-000000000305";
const options = {
  clients: [{ color: null, id: clientId, name: "Acme" }],
  folders: [{ id: folderId, name: "Calls" }],
  projects: [{ client_id: clientId, id: projectId, name: "CRM" }],
  tags: [
    { color: null, id: tagA, name: "A" },
    { color: null, id: tagB, name: "B" }
  ]
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({
      data: { user: { email: "user@example.test", id: "user-1", user_metadata: {} } }
    }) }
  });
  mocks.listOptions.mockResolvedValue(options);
  mocks.listRecordings.mockResolvedValue([]);
  mocks.countDeleted.mockResolvedValue(2);
  mocks.countStatuses.mockResolvedValue({
    completed: 5,
    created: 1,
    deleted: 0,
    failed: 3,
    transcribing: 4,
    uploaded: 6,
    uploading: 7
  });
  mocks.searchOwnRecordings.mockResolvedValue({
    page: 2,
    pageSize: 25,
    results: [{ id: "recording-1" }],
    totalCount: 51
  });
});

describe("recordings search page routing", () => {
  it("forwards canonical page and organization filters only to indexed search", async () => {
    const element = await RecordingPage({
      searchParams: Promise.resolve({
        client: clientId,
        folder: folderId,
        page: "2",
        project: projectId,
        q: "Lucern CRM",
        status: "failed",
        tag: [tagA, tagB]
      })
    });

    expect(mocks.searchOwnRecordings).toHaveBeenCalledWith(expect.anything(), {
      organizationFilters: {
        clientId,
        folderId,
        projectId,
        tagIds: [tagA, tagB]
      },
      page: 2,
      searchQuery: "Lucern CRM",
      status: "failed"
    });
    expect(mocks.listRecordings).not.toHaveBeenCalled();
    expect(element.props.recordingSearchPage).toMatchObject({ page: 2, totalCount: 51 });
    expect(element.props.recordingStatus).toBe("failed");
    expect(element.props.recordingStatusCounts).toMatchObject({ failed: 3, deleted: 2 });
    expect(element.props.recordingsSearchParams).toContain("status=failed");
    const previous = new URL(element.props.recordingSearchPreviousHref, "https://vosio.local");
    const next = new URL(element.props.recordingSearchNextHref, "https://vosio.local");
    expect(previous.searchParams.get("page")).toBeNull();
    expect(next.searchParams.get("page")).toBe("3");
    expect(next.searchParams.get("q")).toBe("Lucern CRM");
    expect(next.searchParams.getAll("tag")).toEqual([tagA, tagB]);
  });

  it("keeps an empty query on the ordinary keyset organization list", async () => {
    const rows = [{ id: "ordinary-recording" }];
    mocks.listRecordings.mockResolvedValue(rows);

    const element = await RecordingPage({ searchParams: Promise.resolve({ client: clientId }) });

    expect(mocks.listRecordings).toHaveBeenCalledWith(expect.anything(), {
      organizationFilters: { clientId, folderId: null, projectId: null, tagIds: [] },
      status: null
    });
    expect(mocks.searchOwnRecordings).not.toHaveBeenCalled();
    expect(element.props.recordings).toBe(rows);
    expect(element.props.recordingSearchPage).toBeNull();
  });

  it("settles an RPC failure as an accessible manager error without falling back to fetch-all", async () => {
    mocks.searchOwnRecordings.mockRejectedValue(new Error("private provider detail"));

    const element = await RecordingPage({
      searchParams: Promise.resolve({ q: "Lucern" })
    });

    expect(mocks.listRecordings).not.toHaveBeenCalled();
    expect(element.props.recordingSearchError).toBe(
      "Hledání se nepodařilo načíst. Zkuste to znovu."
    );
    expect(JSON.stringify(element.props)).not.toContain("private provider detail");
  });

  it("redirects a stale empty page to page one while preserving all query filters", async () => {
    mocks.searchOwnRecordings.mockResolvedValue({
      page: 3,
      pageSize: 25,
      results: [],
      totalCount: 0
    });
    mocks.redirect.mockImplementationOnce((href: string) => {
      throw new Error(`redirect:${href}`);
    });

    await expect(RecordingPage({
      searchParams: Promise.resolve({
        client: clientId,
        mode: "compact",
        page: "3",
        q: "Lucern",
        tag: [tagA, tagB],
        view: ["one", "two"]
      })
    })).rejects.toThrow("redirect:");
    const target = mocks.redirect.mock.calls[0]?.[0] as string;
    const targetUrl = new URL(target, "https://vosio.local");
    expect(targetUrl.pathname).toBe("/recordings");
    expect(targetUrl.searchParams.get("page")).toBeNull();
    expect(targetUrl.searchParams.get("q")).toBe("Lucern");
    expect(targetUrl.searchParams.get("client")).toBe(clientId);
    expect(targetUrl.searchParams.getAll("tag")).toEqual([tagA, tagB]);
    expect(targetUrl.searchParams.get("mode")).toBe("compact");
    expect(targetUrl.searchParams.getAll("view")).toEqual(["one", "two"]);
  });

  it("does not redirect-loop when the genuine first search page is empty", async () => {
    mocks.searchOwnRecordings.mockResolvedValue({
      page: 1,
      pageSize: 25,
      results: [],
      totalCount: 0
    });

    const element = await RecordingPage({ searchParams: Promise.resolve({ q: "missing" }) });

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(element.props.recordingSearchPage).toMatchObject({ page: 1, results: [], totalCount: 0 });
  });

  it("never creates a next-page link beyond the derived PostgreSQL offset maximum", async () => {
    mocks.searchOwnRecordings.mockResolvedValue({
      page: RECORDING_SEARCH_MAX_PAGE,
      pageSize: 25,
      results: [{ id: "last-recording" }],
      totalCount: Number.MAX_SAFE_INTEGER
    });

    const element = await RecordingPage({
      searchParams: Promise.resolve({
        page: String(RECORDING_SEARCH_MAX_PAGE),
        q: "Lucern"
      })
    });

    expect(element.props.recordingSearchNextHref).toBeNull();
    expect(element.props.recordingSearchPreviousHref).toContain(
      `page=${RECORDING_SEARCH_MAX_PAGE - 1}`
    );
  });
});
