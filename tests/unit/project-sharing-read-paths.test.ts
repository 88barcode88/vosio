import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveRecordingCapabilities, NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";
import { listRecordings, listDeletedRecordings, getRecordingById, countOwnRecordingStatuses } from "@/lib/recordings/queries";
import { listStructuredAiItemsForTranscripts } from "@/lib/ai/structured-queries";

describe("sharing session read callers", () => {
  it("enriches Trash IDs in bounded manager-only batches without protected reads or page filtering", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: `r-${i}`, status: "deleted" }));
    const rpc = vi.fn(async (name: string, args: { p_recording_ids?: string[] }) => ({ data: name === "list_accessible_recordings_v1" ? rows : name === "get_managed_recording_trash_v2" ? args.p_recording_ids!.map((id) => ({ recording_id: id, deleted_at: "2026-09-20T00:00:00Z", trash_retention_hours: 168, purge_after: "2026-09-27T00:00:00Z", purge_phase: "none", audio_availability: "single" })) : { ...NO_RECORDING_CAPABILITIES, read: true, restore: true, purge: true }, error: null }));
    const result = await listDeletedRecordings({ rpc } as never);
    expect(result).toHaveLength(101);
    expect(result[0]).toMatchObject({ deleted_at: "2026-09-20T00:00:00Z", purge_phase: "none", capabilities: { restore: true } });
    expect(rpc.mock.calls.filter(([name]) => name === "get_managed_recording_trash_v2").map(([, args]) => args.p_recording_ids?.length)).toEqual([100, 1]);
  });
  it.each([
    [], [{ recording_id: "foreign", audio_availability: "single" }],
    [{ recording_id: "r", audio_availability: "single" }, { recording_id: "r", audio_availability: "single" }],
    [{ recording_id: "r", audio_availability: "invalid" }], [{ recording_id: "r" }], null
  ].map((metadata) => ({ metadata })))("rejects missing, duplicate, foreign or malformed Trash metadata $metadata", async ({ metadata }) => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "list_accessible_recordings_v1" ? [{ id: "r", status: "deleted" }] : name === "get_managed_recording_trash_v2" ? metadata : NO_RECORDING_CAPABILITIES, error: null }));
    await expect(listDeletedRecordings({ rpc } as never)).rejects.toThrow();
  });
  it("reads all shared structured tasks using explicit safe RLS pages", async () => {
    const selects: string[] = [];
    const ranges: number[] = [];
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `task-${i}`, title: `Task ${i}`, transcript_id: "transcript", position: i, owner_category: "Moje práce", deadline: null, deadline_normalized: null, status: "new" }));
    const from = vi.fn((table: string) => {
      let offset = 0;
      const query = { select: vi.fn((columns: string) => { selects.push(columns); return query; }), in: vi.fn(() => query), order: vi.fn(() => query), range: vi.fn((start: number) => { offset = start; if (table === "transcript_tasks") ranges.push(start); return query; }), returns: vi.fn(async () => ({ data: table === "transcript_tasks" ? rows.slice(offset, offset + 1000) : [], error: null })) };
      return query;
    });
    const result = await listStructuredAiItemsForTranscripts({ from } as never, ["transcript"]);
    expect(result.tasks).toHaveLength(1001);
    expect(ranges).toEqual([0, 1000]);
    expect(selects.every((columns) => !columns.includes("*") && !columns.includes("user_id"))).toBe(true);
  });
  it.each([null, {}, { read: true }, { read: "true" }])("fails closed on malformed capabilities %j", async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    expect(await resolveRecordingCapabilities({ rpc } as unknown as SupabaseClient, "recording-id")).toEqual(NO_RECORDING_CAPABILITIES);
    expect(rpc).toHaveBeenCalledWith("recording_capabilities_v1", { p_recording_id: "recording-id" });
  });
  it("uses exact server capabilities for an editor and denies a failed lookup", async () => {
    const editor = { ...NO_RECORDING_CAPABILITIES, read: true, editTitle: true, editSpeakers: true, editTaskStatus: true };
    const rpc = vi.fn().mockResolvedValueOnce({ data: editor, error: null }).mockRejectedValueOnce(new Error("offline"));
    const client = { rpc } as unknown as SupabaseClient;
    expect(await resolveRecordingCapabilities(client, "E")).toEqual(editor);
    expect(await resolveRecordingCapabilities(client, "revoked")).toEqual(NO_RECORDING_CAPABILITIES);
  });
  it("uses accessible list/detail/facets without direct table or owner predicates", async () => {
    const row = { id: "shared", created_at: "2026-09-22T00:00:00Z", status: "completed" };
    const rpc = vi.fn().mockResolvedValueOnce({ data: [row], error: null })
      .mockResolvedValueOnce({ data: [row], error: null })
      .mockResolvedValueOnce({ data: [{ status: "completed", total_count: 1 }, { status: "deleted", total_count: 2 }], error: null });
    const client = { rpc } as unknown as SupabaseClient;
    expect(await listRecordings(client)).toEqual([row]);
    expect(await getRecordingById(client, "shared")).toEqual(row);
    const counts = await countOwnRecordingStatuses(client, { organizationFilters: { clientId: null, projectId: null, folderId: null, tagIds: [] }, searchQuery: "" });
    expect(counts.completed).toBe(1);
    expect(counts.deleted).toBe(2);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["list_accessible_recordings_v1", "get_accessible_recording_v1", "count_accessible_recording_statuses_v1"]);
  });
});

const migration = readFileSync("supabase/migrations/20260922200000_add_project_sharing_read_paths.sql", "utf8");
const fixture = readFileSync("supabase/tests/project_sharing_read_paths.sql", "utf8");

// Read this fixture's simple literal tuples; this is not a PostgreSQL parser or RLS proof.
function fixtureRows(table: string): string[][] {
  const block = fixture.split(`insert into public.${table}(`)[1]?.split(" values")[1]?.split(";")[0];
  expect(block, `Missing seed block for ${table}`).toBeTruthy();
  return [...block!.matchAll(/\(([^()]*(?:now\(\)[^()]*)?)\)/g)]
    .map((match) => match[1].split(",").map((value) => value.trim().replace(/^'|'$/g, "")));
}

describe("sharing read paths source contracts (not runtime RLS evidence)", () => {
  it("seeds only exact selected grants accepted by the T1 scope trigger", () => {
    const recordings = new Map(fixtureRows("recordings").map((row) => [row[0], row]));
    const grants = fixtureRows("recording_access_grants");
    expect(recordings.size).toBe(9);
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      const recording = recordings.get(grant[0]);
      expect(recording, grant[0]).toBeDefined();
      expect(recording![6], grant[0]).toBe("selected");
      expect(recording![5], grant[0]).toBe(grant[3]);
    }
  });

  it("closes direct project and author columns without exposing author identity in RPC rows", () => {
    expect(migration).toMatch(/revoke select\s*\(project_id,\s*created_by\) on public\.recordings from authenticated/i);
    const composite = migration.split("create type public.accessible_recording_row_v1 as (")[1].split(");")[0];
    expect(composite).not.toContain("created_by");
    expect(migration).not.toContain("(w.recording).created_by");
  });

  it("places exact ID, status, keyset and limit within the private SQL scan boundary", () => {
    const rowsBody = migration.split("$rows$")[1];
    expect(rowsBody).toContain("(p_recording_id is null or r.id=p_recording_id)");
    expect(rowsBody).toContain("(p_status is null or r.status=p_status)");
    expect(rowsBody).toContain("(r.created_at,r.id)<(p_before_created_at,p_before_id)");
    expect(rowsBody).toContain("limit p_limit");
    const searchBody = migration.split("$winners$")[1];
    expect(searchBody).toContain("candidate_ids as");
    expect(searchBody).toContain("c.id,p_status,false,null,null,1");
  });

  it("closes the legacy whole-row JSON path as well as direct columns", () => {
    expect(migration).toMatch(/revoke execute on function public\.get_personal_recording_metadata_v1\(uuid\)\s+from authenticated/i);
  });

  it("authorizes IDs before reading searchable content and fences each content scan to one authorized ID", () => {
    const searchBody = migration.split("$winners$")[1];
    const authorization = searchBody.split("authorized_ids as materialized (")[1]?.split("), candidate_ids as materialized (")[0];
    expect(authorization).toBeDefined();
    expect(authorization).toContain("select r.id");
    expect(authorization).toContain("public.can_read_recording(r.id)");
    expect(authorization).not.toMatch(/\.title|\.text|metadata_search_vector/);
    const candidates = searchBody.split("candidate_ids as materialized (")[1]?.split("), eligible as materialized (")[0];
    expect(candidates).toContain("from authorized_ids a");
    expect(candidates).toContain("cross join lateral");
    expect(candidates).toContain("original.id=a.id");
    expect(candidates).toContain("offset 0");
    expect(migration).toMatch(/create index recordings_shared_title_search_idx\s+on public\.recordings using gin \(to_tsvector\('simple'::regconfig,coalesce\(title,''\)\)\)/);
  });
});
