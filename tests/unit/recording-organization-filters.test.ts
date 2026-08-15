import { describe, expect, it, vi } from "vitest";
import {
  buildRecordingFilterSearchParams,
  canonicalizeRecordingOrganizationFilters,
  groupRecordingsByClient,
  parseRecordingOrganizationFilters
} from "@/lib/recording-organization/filters";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";
import {
  countDeletedRecordings,
  countOwnRecordingStatuses,
  listRecordings
} from "@/lib/recordings/queries";
import type { RecordingRow } from "@/lib/recordings/types";

const userId = "00000000-0000-4000-8000-000000000001";
const clientA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const projectA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const projectB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const folderA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const tagA = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const tagB = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const foreignTag = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const timestamp = "2026-08-05T10:00:00.000Z";

const options: RecordingOrganizationOptions = {
  clients: [
    { color: null, created_at: timestamp, id: clientA, name: "Acme", updated_at: timestamp, user_id: userId },
    { color: null, created_at: timestamp, id: clientB, name: "Beta", updated_at: timestamp, user_id: userId }
  ],
  folders: [
    { color: null, created_at: timestamp, id: folderA, name: "Calls", updated_at: timestamp, user_id: userId }
  ],
  projects: [
    { client_id: clientA, color: null, created_at: timestamp, id: projectA, name: "Project X", updated_at: timestamp, user_id: userId },
    { client_id: clientB, color: null, created_at: timestamp, id: projectB, name: "Project Y", updated_at: timestamp, user_id: userId }
  ],
  tags: [
    { color: null, created_at: timestamp, id: tagA, name: "Important", updated_at: timestamp, user_id: userId },
    { color: null, created_at: timestamp, id: tagB, name: "Follow-up", updated_at: timestamp, user_id: userId }
  ]
};

// createRecording creates one stable list row for query and grouping tests.
function createRecording(id: string, clientId: string | null, title = id): RecordingRow {
  return {
    client_id: clientId,
    created_at: timestamp,
    duration_seconds: null,
    error_message: null,
    file_size_bytes: null,
    folder_id: null,
    id,
    mime_type: null,
    project_id: null,
    source_type: "realtime",
    status: "completed",
    storage_path: null,
    title,
    updated_at: timestamp,
    user_id: userId
  };
}

// createCursorRecording returns rows in deterministic descending cursor order.
function createCursorRecording(ordinal: number, title?: string): RecordingRow {
  const cursorTimestamp = new Date(Date.parse(timestamp) - ordinal * 1000).toISOString();
  const idSuffix = String(999_999_999_999 - ordinal).padStart(12, "0");
  return {
    ...createRecording(`00000000-0000-4000-8000-${idSuffix}`, clientA, title),
    created_at: cursorTimestamp,
    updated_at: cursorTimestamp
  };
}

describe("recording organization filter URLs", () => {
  it("canonicalizes single IDs and repeatable lower-case deduplicated owned tags", () => {
    const searchParams = new URLSearchParams();
    searchParams.append("q", "  call notes  ");
    searchParams.append("page", "3");
    searchParams.append("client", clientA.toUpperCase());
    searchParams.append("project", projectA.toUpperCase());
    searchParams.append("folder", folderA.toUpperCase());
    searchParams.append("tag", tagB.toUpperCase());
    searchParams.append("tag", tagA);
    searchParams.append("tag", tagB);
    searchParams.append("tag", foreignTag);
    searchParams.append("tag", "not-a-uuid");

    const result = canonicalizeRecordingOrganizationFilters(searchParams, options);

    expect(result.filters).toEqual({
      clientId: clientA,
      folderId: folderA,
      projectId: projectA,
      tagIds: [tagB, tagA]
    });
    expect(result.changed).toBe(true);
    expect(result.searchParams.get("q")).toBe("  call notes  ");
    expect(result.searchParams.get("page")).toBe("3");
    expect(result.searchParams.getAll("tag")).toEqual([tagB, tagA]);
  });

  it("removes repeated or foreign singles and a project outside the selected client", () => {
    const repeatedClient = new URLSearchParams([
      ["client", clientA],
      ["client", clientB],
      ["project", projectA]
    ]);
    expect(parseRecordingOrganizationFilters(repeatedClient, options)).toEqual({
      clientId: null,
      folderId: null,
      projectId: null,
      tagIds: []
    });

    const mismatchedProject = new URLSearchParams({ client: clientA, project: projectB });
    expect(parseRecordingOrganizationFilters(mismatchedProject, options).projectId).toBeNull();
  });

  it("replaces only organization keys while preserving q and unrelated pagination keys", () => {
    const current = new URLSearchParams("q=call&page=2&cursor=next&client=old&tag=old");
    const next = buildRecordingFilterSearchParams(current, {
      clientId: clientA,
      folderId: null,
      projectId: projectA,
      tagIds: [tagA, tagB]
    });

    expect(next.get("q")).toBe("call");
    expect(next.get("page")).toBe("2");
    expect(next.get("cursor")).toBe("next");
    expect(next.getAll("client")).toEqual([clientA]);
    expect(next.getAll("tag")).toEqual([tagA, tagB]);
  });

  it("groups rows for presentation without changing order inside each client", () => {
    const recordings = [
      createRecording("recording-3", clientA),
      createRecording("recording-2", null),
      createRecording("recording-1", clientA)
    ];

    expect(groupRecordingsByClient(recordings, options).map((group) => ({
      ids: group.recordings.map((recording) => recording.id),
      label: group.label
    }))).toEqual([
      { ids: ["recording-3", "recording-1"], label: "Acme" },
      { ids: ["recording-2"], label: "Bez klienta" }
    ]);
  });
});

describe("recording organization list query", () => {
  it("uses a stable keyset across a concurrent insert/delete for the ordinary empty-q list", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) =>
      createCursorRecording(index, `Memo ${index}`)
    );
    // Ordinal 1000 was deleted between requests; a newly inserted newer row cannot shift this cursor page.
    const secondPage = [createCursorRecording(1001, "Needle call")];
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null });

    await expect(listRecordings({ rpc } as never, {
      organizationFilters: { clientId: clientA, folderId: folderA, projectId: projectA, tagIds: [tagA, tagB] },
      status: "failed"
    })).resolves.toEqual([...firstPage, ...secondPage]);

    expect(rpc).toHaveBeenCalledTimes(2);
    const expectedFilters = {
      p_client_id: clientA,
      p_folder_id: folderA,
      p_limit: 1000,
      p_project_id: projectA,
      p_status: "failed",
      p_tag_ids: [tagA, tagB]
    };
    expect(rpc).toHaveBeenNthCalledWith(1, "list_own_recordings_v2", {
      ...expectedFilters,
      p_before_created_at: null,
      p_before_id: null
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "list_own_recordings_v2", {
      ...expectedFilters,
      p_before_created_at: firstPage[999].created_at,
      p_before_id: firstPage[999].id
    });
  });

  it("requests an empty sentinel page after an exact multiple of the page size", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) =>
      createCursorRecording(index)
    );
    const secondPage = Array.from({ length: 1000 }, (_, index) =>
      createCursorRecording(index + 1000)
    );
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const result = await listRecordings({ rpc } as never);
    expect(result).toHaveLength(2000);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[2]?.[1]).toMatchObject({
      p_before_created_at: secondPage[999].created_at,
      p_before_id: secondPage[999].id
    });
  });

  it("deduplicates an overlapping boundary on a short final page without changing first-seen order", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => createCursorRecording(index));
    const finalRow = createCursorRecording(1000);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [firstPage[999], finalRow], error: null });

    const result = await listRecordings({ rpc } as never);
    expect(result).toHaveLength(1001);
    expect(result.slice(-2).map((row) => row.id)).toEqual([firstPage[999].id, finalRow.id]);
  });

  it("propagates a later-page RPC error and rejects a full page with a stalled cursor", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, index) => createCursorRecording(index));
    const laterErrorRpc = vi.fn()
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(listRecordings({ rpc: laterErrorRpc } as never)).rejects.toThrow(
      "Unable to load recordings: permission denied"
    );

    const stalledRpc = vi.fn().mockResolvedValue({ data: fullPage, error: null });
    await expect(listRecordings({ rpc: stalledRpc } as never)).rejects.toThrow(
      "recording pagination cursor did not advance"
    );
    expect(stalledRpc).toHaveBeenCalledTimes(2);
  });

  it("loads exact status facets and the separate RLS-scoped trash count", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { status: "completed", total_count: 7 },
        { status: "failed", total_count: "3" }
      ],
      error: null
    });

    await expect(countOwnRecordingStatuses({ rpc } as never, {
      organizationFilters: { clientId: clientA, folderId: null, projectId: null, tagIds: [tagA] },
      searchQuery: "lucern"
    })).resolves.toMatchObject({ completed: 7, failed: 3, deleted: 0 });
    expect(rpc).toHaveBeenCalledWith("count_own_recording_statuses_v1", {
      p_client_id: clientA,
      p_folder_id: null,
      p_project_id: null,
      p_query: "lucern",
      p_tag_ids: [tagA]
    });

    const eq = vi.fn().mockResolvedValue({ count: 2, error: null });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    await expect(countDeletedRecordings({ from } as never)).resolves.toBe(2);
    expect(from).toHaveBeenCalledWith("recordings");
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(eq).toHaveBeenCalledWith("status", "deleted");
  });

});
