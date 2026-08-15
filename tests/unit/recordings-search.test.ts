import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  RECORDING_SEARCH_MAX_PAGE,
  RECORDING_SEARCH_MAX_START_MS,
  RECORDING_SEARCH_PAGE_SIZE,
  buildRecordingSearchPageHref,
  buildRecordingSearchResultHref,
  canonicalizeRecordingSearchParams,
  mapRecordingSearchRow,
  normalizeRecordingSearchQuery,
  parseRecordingSearchPage,
  searchOwnRecordings
} from "@/lib/recordings/search";

const filters = {
  clientId: "00000000-0000-4000-8000-000000000011",
  folderId: "00000000-0000-4000-8000-000000000012",
  projectId: "00000000-0000-4000-8000-000000000013",
  tagIds: [
    "00000000-0000-4000-8000-000000000014",
    "00000000-0000-4000-8000-000000000015"
  ]
};

// createSearchRow builds one complete RPC row with controllable extras and totals.
function createSearchRow(id: string, totalCount: number | string = 27) {
  return {
    client_id: filters.clientId,
    created_at: "2026-08-05T10:00:00.000Z",
    duration_seconds: 65,
    file_size_bytes: "2048",
    folder_id: filters.folderId,
    match_end_ms: 4200,
    match_start_ms: 1200,
    matched_excerpt: "Řešíme [[H]]Lucern[[/H]] CRM.",
    mime_type: "audio/webm",
    private_secret: "must-not-leak",
    project_id: filters.projectId,
    recording_id: id,
    source_type: "upload",
    status: "completed",
    storage_path: "private/storage/object.webm",
    title: "Lucern CRM call",
    total_count: totalCount,
    updated_at: "2026-08-05T10:05:00.000Z",
    user_id: "private-user"
  };
}

describe("recordings indexed search", () => {
  it("normalizes bounded queries and strictly canonicalizes one positive page", () => {
    const normalized = normalizeRecordingSearchQuery(`  Lucern\n\nCRM   ${"x".repeat(200)}`);

    expect(normalized).toHaveLength(120);
    expect(normalized.startsWith("Lucern CRM")).toBe(true);
    expect(parseRecordingSearchPage("2")).toBe(2);
    expect(parseRecordingSearchPage(["2"])).toBe(2);
    expect(parseRecordingSearchPage(["2", "3"])).toBe(1);
    expect(parseRecordingSearchPage("02")).toBe(1);
    expect(parseRecordingSearchPage("0")).toBe(1);
    expect(parseRecordingSearchPage(String(RECORDING_SEARCH_MAX_PAGE))).toBe(RECORDING_SEARCH_MAX_PAGE);
    expect(parseRecordingSearchPage(String(RECORDING_SEARCH_MAX_PAGE + 1)))
      .toBe(RECORDING_SEARCH_MAX_PAGE);

    const canonical = canonicalizeRecordingSearchParams(
      new URLSearchParams("q=%20Lucern%20%20CRM%20&page=02&tag=a&tag=b"),
      "Lucern CRM"
    );
    expect(canonical).toMatchObject({ changed: true, page: 1 });
    expect(canonical.searchParams.getAll("tag")).toEqual(["a", "b"]);
    expect(canonical.searchParams.get("q")).toBe("Lucern CRM");
    expect(canonical.searchParams.has("page")).toBe(false);

    const capped = canonicalizeRecordingSearchParams(
      new URLSearchParams(`q=Lucern&page=${RECORDING_SEARCH_MAX_PAGE + 1}`),
      "Lucern"
    );
    expect(capped).toMatchObject({ changed: true, page: RECORDING_SEARCH_MAX_PAGE });
    expect(capped.searchParams.get("page")).toBe(String(RECORDING_SEARCH_MAX_PAGE));
  });

  it("calls exactly the authenticated search RPC with filters, page size and offset", async () => {
    const rows = [createSearchRow("recording-1"), createSearchRow("recording-2")];
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });

    await expect(searchOwnRecordings({ rpc } as never, {
      organizationFilters: filters,
      page: 2,
      searchQuery: "  Lucern   CRM ",
      status: "completed"
    })).resolves.toMatchObject({
      page: 2,
      pageSize: 25,
      results: [{ id: "recording-1" }, { id: "recording-2" }],
      totalCount: 27
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("search_own_recordings_v2", {
      p_client_id: filters.clientId,
      p_folder_id: filters.folderId,
      p_limit: RECORDING_SEARCH_PAGE_SIZE,
      p_offset: 25,
      p_project_id: filters.projectId,
      p_query: "Lucern CRM",
      p_status: "completed",
      p_tag_ids: filters.tagIds
    });
    const source = readFileSync(join(process.cwd(), "src/lib/recordings/search.ts"), "utf8");
    expect(source).not.toContain("supabase/admin");
    expect(source).not.toContain("createAdminClient");
  });

  it("projects explicit safe columns and drops every private or unknown RPC field", () => {
    const result = mapRecordingSearchRow(createSearchRow("recording-safe"));
    const serialized = JSON.stringify(result);

    expect(Object.keys(result).sort()).toEqual([
      "clientId",
      "createdAt",
      "durationSeconds",
      "fileSizeBytes",
      "folderId",
      "id",
      "matchEndMs",
      "matchStartMs",
      "matchedExcerpt",
      "mimeType",
      "projectId",
      "sourceType",
      "status",
      "title",
      "updatedAt"
    ].sort());
    expect(serialized).not.toContain("private_secret");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("storage_path");
    expect(serialized).not.toContain("private/storage");
    expect(serialized).not.toContain("user_id");
  });

  it("rejects inconsistent totals, malformed rows and provider failures", async () => {
    const inconsistentRpc = vi.fn().mockResolvedValue({
      data: [createSearchRow("recording-1", 27), createSearchRow("recording-2", 28)],
      error: null
    });
    await expect(searchOwnRecordings({ rpc: inconsistentRpc } as never, {
      organizationFilters: filters,
      page: 1,
      searchQuery: "Lucern"
    })).rejects.toThrow("inconsistent total count");

    expect(() => mapRecordingSearchRow({ ...createSearchRow("recording-1"), status: "secret" }))
      .toThrow("invalid response");
    await expect(searchOwnRecordings({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "private detail" } })
    } as never, {
      organizationFilters: filters,
      page: 1,
      searchQuery: "Lucern"
    })).rejects.toThrow("Unable to search recordings");
  });

  it("preserves q and duplicate filters across pagination and adds only safe transcript targets", () => {
    const params = new URLSearchParams("q=Lucern+CRM&client=c1&tag=t1&tag=t2&page=2");
    const nextHref = buildRecordingSearchPageHref(params, 3);
    const nextParams = new URL(nextHref, "https://vosio.local").searchParams;

    expect(nextParams.get("q")).toBe("Lucern CRM");
    expect(nextParams.get("client")).toBe("c1");
    expect(nextParams.getAll("tag")).toEqual(["t1", "t2"]);
    expect(nextParams.get("page")).toBe("3");
    expect(buildRecordingSearchResultHref({ id: "recording-1", matchStartMs: 1200 }, " Lucern  CRM "))
      .toBe("/recordings/recording-1?tab=transcript&at=1200&highlight=Lucern+CRM");
    expect(buildRecordingSearchResultHref({ id: "recording-1", matchStartMs: null }, "Lucern"))
      .toBe("/recordings/recording-1?tab=transcript&highlight=Lucern");
    expect(buildRecordingSearchResultHref({ id: "recording-1", matchStartMs: -1 }, "Lucern"))
      .toBe("/recordings/recording-1?tab=transcript&highlight=Lucern");
    expect(buildRecordingSearchResultHref({ id: "recording-1", matchStartMs: 0 }, "Lucern"))
      .toBe("/recordings/recording-1?tab=transcript&at=0&highlight=Lucern");
    expect(buildRecordingSearchResultHref({
      id: "recording-1",
      matchStartMs: RECORDING_SEARCH_MAX_START_MS
    }, "Lucern")).toBe(
      `/recordings/recording-1?tab=transcript&at=${RECORDING_SEARCH_MAX_START_MS}&highlight=Lucern`
    );
    expect(buildRecordingSearchResultHref({
      id: "recording-1",
      matchStartMs: RECORDING_SEARCH_MAX_START_MS + 1
    }, "Lucern")).toBe("/recordings/recording-1?tab=transcript&highlight=Lucern");
    expect(buildRecordingSearchResultHref({
      id: "recording-1",
      matchStartMs: Number.MAX_SAFE_INTEGER + 1
    }, "Lucern")).toBe("/recordings/recording-1?tab=transcript&highlight=Lucern");
    expect(() => buildRecordingSearchPageHref(params, RECORDING_SEARCH_MAX_PAGE + 1))
      .toThrow("invalid page");
  });

  it("keeps the maximum page offset inside the PostgreSQL integer contract", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    await searchOwnRecordings({ rpc } as never, {
      organizationFilters: filters,
      page: RECORDING_SEARCH_MAX_PAGE,
      searchQuery: "Lucern"
    });

    const offset = rpc.mock.calls[0]?.[1]?.p_offset as number;
    expect(offset).toBe((RECORDING_SEARCH_MAX_PAGE - 1) * RECORDING_SEARCH_PAGE_SIZE);
    expect(offset).toBeLessThanOrEqual(2_147_483_647);
  });
});
