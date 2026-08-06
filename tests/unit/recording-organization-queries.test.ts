import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getRecordingOrganization,
  listRecordingOrganizationOptions
} from "@/lib/recording-organization/queries";
import type { RecordingRow } from "@/lib/recordings/types";

const userId = "00000000-0000-4000-8000-000000000001";
const recordingId = "00000000-0000-4000-8000-000000000002";

// createListQuery builds one explicit-select Supabase list query.
function createListQuery(data: unknown[] = [], error: { message: string } | null = null) {
  const query = {
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    returns: vi.fn(),
    select: vi.fn()
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockReturnValue(query);
  query.returns.mockResolvedValue({ data, error });
  return query;
}

// createMaybeSingleQuery builds one owner-filtered lookup query.
function createMaybeSingleQuery(data: unknown = null, error: { message: string } | null = null) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    select: vi.fn()
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

const unclassifiedRecording: RecordingRow = {
  client_id: null,
  created_at: "2026-08-04T10:00:00.000Z",
  duration_seconds: null,
  error_message: null,
  file_size_bytes: null,
  folder_id: null,
  id: recordingId,
  mime_type: null,
  project_id: null,
  source_type: "realtime",
  status: "completed",
  storage_path: null,
  title: "Bez zařazení",
  updated_at: "2026-08-04T10:00:00.000Z",
  user_id: userId
};

describe("recording organization queries", () => {
  it("loads explicit organization option allowlists in stable order", async () => {
    const queries = new Map([
      ["recording_clients", createListQuery([{ id: "client-1", name: "Acme" }])],
      ["recording_projects", createListQuery([])],
      ["recording_folders", createListQuery([])],
      ["recording_tags", createListQuery([])]
    ]);
    const from = vi.fn((table: string) => queries.get(table));

    await expect(listRecordingOrganizationOptions({ from } as never)).resolves.toMatchObject({
      clients: [{ id: "client-1", name: "Acme" }],
      folders: [],
      projects: [],
      tags: []
    });

    for (const [table, query] of queries) {
      expect(from).toHaveBeenCalledWith(table);
      const selection = query.select.mock.calls[0]?.[0] as string;
      expect(selection).not.toContain("*");
      expect(selection).toContain("id");
      expect(selection).toContain("user_id");
      expect(query.order).toHaveBeenNthCalledWith(1, "name", { ascending: true });
      expect(query.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
    }
  });

  it("keeps an unclassified recording usable without issuing nullable lookup queries", async () => {
    const linksQuery = createListQuery([]);
    const from = vi.fn((table: string) => {
      if (table !== "recording_tag_links") {
        throw new Error(`unexpected table ${table}`);
      }
      return linksQuery;
    });

    await expect(
      getRecordingOrganization({ from } as never, unclassifiedRecording)
    ).resolves.toEqual({ client: null, folder: null, project: null, tags: [] });
    expect(from).toHaveBeenCalledTimes(1);
    expect(linksQuery.select.mock.calls[0]?.[0]).not.toContain("*");
  });

  it("maps owned lookup rows and tags into a separate projection", async () => {
    const clientQuery = createMaybeSingleQuery({ color: "#112233", id: "client-1", name: "Acme" });
    const projectQuery = createMaybeSingleQuery({ id: "project-1", name: "Web" });
    const folderQuery = createMaybeSingleQuery({ id: "folder-1", name: "Calls" });
    const linksQuery = createListQuery([
      { recording_tags: { color: null, id: "tag-2", name: "B" }, tag_id: "tag-2" },
      { recording_tags: { color: "#ABCDEF", id: "tag-1", name: "A" }, tag_id: "tag-1" }
    ]);
    const from = vi.fn((table: string) => ({
      recording_clients: clientQuery,
      recording_folders: folderQuery,
      recording_projects: projectQuery,
      recording_tag_links: linksQuery
    })[table as "recording_clients"]);
    const recording = {
      ...unclassifiedRecording,
      client_id: "client-1",
      folder_id: "folder-1",
      project_id: "project-1"
    };

    await expect(getRecordingOrganization({ from } as never, recording)).resolves.toEqual({
      client: { color: "#112233", id: "client-1", name: "Acme" },
      folder: { id: "folder-1", name: "Calls" },
      project: { id: "project-1", name: "Web" },
      tags: [
        { color: "#ABCDEF", id: "tag-1", name: "A" },
        { color: null, id: "tag-2", name: "B" }
      ]
    });
    for (const query of [clientQuery, projectQuery, folderQuery]) {
      expect(query.eq).toHaveBeenCalledWith("user_id", userId);
    }
  });

  it("throws a clear table-specific error without exposing a select-star fallback", async () => {
    const queries = new Map([
      ["recording_clients", createListQuery([], { message: "permission denied" })],
      ["recording_projects", createListQuery([])],
      ["recording_folders", createListQuery([])],
      ["recording_tags", createListQuery([])]
    ]);
    const from = vi.fn((table: string) => queries.get(table));

    await expect(listRecordingOrganizationOptions({ from } as never)).rejects.toThrow(
      "Unable to load recording clients: permission denied"
    );
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "recording-organization", "queries.ts"),
      "utf8"
    );
    expect(source).not.toContain('select("*")');
    expect(source).not.toContain("supabase/admin");
  });
});
