import { describe, expect, it, vi } from "vitest";
import { loadCurrentMonthUsageState, loadCurrentMonthUsageSummary, type TranscriptionUsageRow } from "@/lib/usage/summary";

const empty = { count: 0, deleted_count: 0, total_duration_seconds: null, total_file_size_bytes: null, with_duration_count: 0, with_file_size_count: 0 };

// Builds owner-job queries and independently scoped owner RPC responses, never accessible-recording accounting.
function fixture(summary: unknown = [empty], jobs: TranscriptionUsageRow[] = [], durations: unknown = []) {
  const rpc = vi.fn(async (name: string, _args: unknown) => ({ data: name === "get_owned_job_usage_v1" ? { ai: [], soniox: jobs } : name === "get_owned_recording_usage_summary_v1" ? summary : durations, error: null as null | { message: string } }));
  const from = vi.fn((table: string) => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), gte: vi.fn(() => query), lt: vi.fn(() => query), order: vi.fn(() => query), returns: vi.fn(async () => ({ data: table === "transcription_jobs" ? jobs : table === "recordings" ? [{ id: "shared-foreign", duration_seconds: 999, file_size_bytes: 999, status: "done" }] : [], error: null })) };
    return query;
  });
  return { rpc, from, client: { rpc, from } as never };
}

// Makes an owner-only completed Soniox job independently of current content access.
function job(recordingId: string): TranscriptionUsageRow {
  return { recording_id: recordingId, created_at: "2026-09-01T00:00:00Z", provider: "soniox", mode: "async", status: "done" };
}

describe("owner-scoped usage RPC adoption", () => {
  it.each([NaN, Infinity, -1, 1.5, "2", 9007199254740992])("rejects malformed token accounting %s", async (tokens) => {
    const f = fixture();
    f.rpc.mockImplementation(async (name) => ({ data: name === "get_owned_job_usage_v1" ? { ai: [{ created_at: "2026-09-01", model: "gpt-5.6-sol", status: "done", input_token_count: tokens, output_token_count: 1 }], soniox: [] } : [empty], error: null }));
    await expect(loadCurrentMonthUsageSummary(f.client)).rejects.toThrow();
  });
  it("does not count a shared-only recipient recording and preserves empty NULL sums", async () => {
    const f = fixture();
    expect((await loadCurrentMonthUsageSummary(f.client)).recordings).toEqual({ count: 0, deletedCount: 0, totalDurationSeconds: null, totalFileSizeBytes: null, withDurationCount: 0, withFileSizeCount: 0 });
    expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(f.rpc).toHaveBeenCalledWith("get_owned_recording_usage_summary_v1", { p_created_from: expect.stringMatching(/T00:00:00.000Z$/), p_created_before: expect.stringMatching(/T00:00:00.000Z$/) });
  });
  it("parses exact numeric strings, retains zero and deleted counts", async () => {
    const f = fixture([{ count: "2", deleted_count: "1", total_duration_seconds: "0", total_file_size_bytes: "9007199254740991", with_duration_count: "1", with_file_size_count: "2" }]);
    expect((await loadCurrentMonthUsageSummary(f.client)).recordings).toEqual({ count: 2, deletedCount: 1, totalDurationSeconds: 0, totalFileSizeBytes: Number.MAX_SAFE_INTEGER, withDurationCount: 1, withFileSizeCount: 2 });
  });
  it("keeps revoked technical-owner duration and treats omitted foreign/missing rows as unknown", async () => {
    const f = fixture([empty], [job("revoked-owner"), job("foreign"), job("unknown")], [{ recording_id: "revoked-owner", duration_seconds: 3600 }, { recording_id: "unknown", duration_seconds: null }]);
    const result = await loadCurrentMonthUsageSummary(f.client);
    expect(result.soniox).toMatchObject({ billableDurationSeconds: 3600, jobsWithDurationCount: 1, jobsMissingDurationCount: 2 });
    expect(f.from.mock.calls.some(([name]) => name === "recordings")).toBe(false);
  });
  it("bounds RAW payloads to 1000 IDs after stable dedup of mixed job IDs", async () => {
    const ids = Array.from({ length: 1003 }, (_, i) => `r-${i}`);
    const f = fixture([empty], [...ids.slice(0, 900), ...ids, ...ids.slice(990)].map(job));
    f.rpc.mockImplementation(async (name, args) => ({ data: name === "get_owned_job_usage_v1" ? { ai: [], soniox: [...ids.slice(0, 900), ...ids, ...ids.slice(990)].map(job) } : name === "get_owned_recording_usage_summary_v1" ? [empty] : (args as { p_recording_ids: string[] }).p_recording_ids.filter((id) => id !== "r-1002").map((id) => ({ recording_id: id, duration_seconds: 1 })), error: null }));
    const result = await loadCurrentMonthUsageSummary(f.client);
    const chunks = f.rpc.mock.calls.filter(([name]) => name === "get_owned_recording_durations_v1").map(([, args]) => (args as { p_recording_ids: string[] }).p_recording_ids);
    expect(chunks.map((chunk) => chunk.length)).toEqual([1000, 3]);
    expect(chunks.flat()).toEqual(ids);
    expect(result.soniox.jobsMissingDurationCount).toBe(2);
  });
  it.each([null, [], [empty, empty], [{}], [{ ...empty, count: -1 }], [{ ...empty, count: "" }], [{ ...empty, count: "1.5" }], [{ ...empty, count: "NaN" }], [{ ...empty, count: Infinity }], [{ ...empty, count: "9007199254740993" }], [{ ...empty, count: 9007199254740992 }], [{ ...empty, count: "1e3" }], [{ ...empty, total_file_size_bytes: "9007199254740993" }], [{ ...empty, deleted_count: 1 }], [{ ...empty, total_duration_seconds: 0 }]].map((shape) => ({ shape })))("rejects invalid or imprecise aggregate $shape", async ({ shape }) => {
    await expect(loadCurrentMonthUsageSummary(fixture(shape).client)).rejects.toThrow();
  });
  it.each([null, [{ recording_id: "foreign", duration_seconds: 1 }], [{ recording_id: "r", duration_seconds: 1 }, { recording_id: "r", duration_seconds: 1 }], [{ recording_id: "r", duration_seconds: -1 }], [{ recording_id: "r", duration_seconds: 1.5 }], [{ recording_id: "r", duration_seconds: "1" }], [{ recording_id: "r" }]].map((shape) => ({ shape })))("rejects malformed, foreign or duplicate duration rows $shape", async ({ shape }) => {
    await expect(loadCurrentMonthUsageSummary(fixture([empty], [job("r")], shape).client)).rejects.toThrow();
  });
  it.each(["get_owned_job_usage_v1", "get_owned_recording_usage_summary_v1", "get_owned_recording_durations_v1"])("fails closed on %s errors", async (failedName) => {
    const f = fixture([empty], [job("r")]);
    f.rpc.mockImplementation(async (name) => ({ data: name === "get_owned_job_usage_v1" ? { ai: [], soniox: [job("r")] } : name === "get_owned_recording_usage_summary_v1" ? [empty] : [], error: name === failedName ? { message: "denied" } : null }));
    expect(await loadCurrentMonthUsageState(f.client)).toEqual({ error: "Usage se teď nepodařilo načíst.", summary: null });
  });
});
