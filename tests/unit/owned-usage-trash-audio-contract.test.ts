import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = "supabase/migrations/20260922230000_add_owned_usage_and_trash_audio.sql";
const sql = existsSync(migration) ? readFileSync(migration, "utf8") : "";

describe("owner usage and Trash audio SQL source contracts (not runtime RLS proof)", () => {
  it("aggregates only technical-owned rows with exact nullable sums and bounded half-open time", () => {
    const summary = sql.split("$usage$")[1] ?? "";
    expect(summary).toContain("r.user_id=auth.uid()");
    expect(summary).not.toContain("can_read_recording");
    expect(summary).toContain("interval '32 days'");
    expect(summary).toContain("r.created_at>=p_created_from and r.created_at<p_created_before");
    expect(summary).toContain("sum(r.duration_seconds),sum(r.file_size_bytes)");
    expect(summary).not.toMatch(/coalesce\s*\(\s*sum/i);
  });

  it("keeps duration lookup owner-only after revoke and bounds raw arrays", () => {
    const durations = sql.split("$durations$")[1] ?? "";
    expect(durations).toContain("cardinality(p_recording_ids)>1000");
    expect(durations).toContain("array_ndims(p_recording_ids) is distinct from 1");
    expect(durations).toContain("select r.id,r.duration_seconds");
    expect(durations).toContain("r.user_id=auth.uid() and r.id=any(p_recording_ids)");
    expect(durations).not.toContain("can_read_recording");
  });

  it("adds v2 without rewriting v1, returning only canonical audio shape to managers", () => {
    const audio = sql.split("$audio$")[1] ?? "";
    expect(sql).toContain("create function public.get_managed_recording_trash_v2(");
    expect(sql).not.toContain("create or replace");
    expect(audio).toContain("cardinality(p_recording_ids)>100");
    expect(audio).toContain("r.status='deleted' and public.can_manage_recording(r.id)");
    expect(audio).toContain("r.storage_path=p.prefix||'live/' then 'segmented'");
    expect(audio).toContain("part in ('','.','..')");
    expect(audio).not.toContain("storage.objects");
    const projection = sql.split("create function public.get_managed_recording_trash_v2")[1]?.split("language plpgsql")[0] ?? "";
    expect(projection).toContain("audio_availability text");
    expect(projection).not.toMatch(/storage_path|user_id|claim_id|actor_id/);
  });

  it("uses fixed trusted definers and grants only narrow authenticated execution", () => {
    expect(sql.match(/stable security definer set search_path = ''/g)).toHaveLength(3);
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).toContain("owner to %I");
    expect(sql).not.toMatch(/grant\s+(select|all|update).*on.*to authenticated/i);
  });
});
