import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260813000000_add_recording_status_filters.sql"),
  "utf8"
).replace(/\s+/g, " ").toLowerCase();

describe("recording status filter schema", () => {
  it("adds versioned status-aware list and search functions", () => {
    expect(sql).toContain("create or replace function public.list_own_recordings_v2(");
    expect(sql).toContain("create or replace function public.search_own_recordings_v2(");
    expect(sql).toContain("p_status public.recording_status default null");
    expect(sql).toContain("r.user_id = (select auth.uid())");
    expect(sql).toContain("r.status <> 'deleted'");
    expect(sql).toContain("p_status is null or r.status = p_status");
  });

  it("adds status facets without exposing public or anon execution", () => {
    expect(sql).toContain("create or replace function public.count_own_recording_statuses_v1(");
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/revoke all on function public\.count_own_recording_statuses_v1\([^;]+from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.count_own_recording_statuses_v1\([^;]+to authenticated/);
  });
});
