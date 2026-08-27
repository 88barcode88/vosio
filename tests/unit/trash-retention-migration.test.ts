import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = readdirSync(join(process.cwd(), "supabase", "migrations"))
  .find((name) => name.endsWith("_add_trash_retention_deadlines.sql"));
const migration = migrationName
  ? readFileSync(join(process.cwd(), "supabase", "migrations", migrationName), "utf8")
  : "";
const normalized = migration.toLowerCase().replace(/\s+/g, " ");

describe("Trash retention migration", () => {
  it("adds exact immutable retention snapshots and a truthful thirty-day backfill", () => {
    expect(migrationName).toBeTruthy();
    expect(normalized).toContain("add column trash_retention_hours smallint");
    expect(normalized).toContain("add column purge_after timestamptz");
    expect(normalized).toMatch(/trash_retention_hours\s+in\s*\(24,\s*168,\s*720\)/u);
    expect(normalized).toContain("trash_retention_hours = 720");
    expect(normalized).toMatch(/purge_after\s*=\s*recordings\.deleted_at\s*\+\s*interval\s*'30 days'/u);
    expect(normalized).not.toMatch(/deleted_at\s*=\s*(?:now|statement_timestamp)\s*\(/u);
  });

  it("captures, preserves, clears and recomputes the snapshot across Trash transitions", () => {
    expect(normalized).toContain("new.trash_retention_hours := 720");
    expect(normalized).toContain("new.purge_after := new.deleted_at + make_interval(hours => new.trash_retention_hours)");
    expect(normalized).toContain("new.trash_retention_hours := old.trash_retention_hours");
    expect(normalized).toContain("new.purge_after := old.purge_after");
    expect(normalized).toContain("new.trash_retention_hours := null");
    expect(normalized).toContain("new.purge_after := null");
  });

  it("creates one stable due index and finite service-role-only lease RPCs", () => {
    expect(normalized).toMatch(/create index recordings_due_purge_idx on public\.recordings \(purge_after, id\) where status = 'deleted'/u);
    expect(normalized).toContain("for update skip locked");
    expect(normalized).toContain("order by recordings.purge_after, recordings.id");
    expect(normalized).toContain("purge_attempt_count < 5");
    expect(normalized).toContain("statement_timestamp() - interval '15 minutes'");
    expect(normalized).not.toContain("statement_timestamp() - interval '5 minutes'");
    expect(normalized).toContain("least(greatest(coalesce(p_limit, 20), 0), 20)");
    for (const functionName of [
      "claim_due_recording_purges_v1",
      "refresh_recording_purge_claim_v1",
      "finalize_recording_purge_v1",
      "release_recording_purge_claim_v1"
    ]) {
      expect(normalized).toContain(`create or replace function public.${functionName}`);
      expect(normalized).toMatch(new RegExp(`public\\.${functionName}[\\s\\S]*?security invoker[\\s\\S]*?set search_path = ''`, "u"));
      expect(normalized).toContain(`revoke all on function public.${functionName}`);
      expect(normalized).toContain(`grant execute on function public.${functionName}`);
    }
    expect(normalized).toContain("from public.recordings");
    expect(normalized).not.toContain("security definer");
  });

  it("keeps restore blocked while any purge lease remains owned", () => {
    expect(normalized).toMatch(/if old\.purge_started_at is not null or old\.purge_claim_id is not null then raise exception 'recording purge is already in progress'/u);
    expect(normalized).toContain("new.purge_started_at := old.purge_started_at");
    expect(normalized).toContain("new.purge_claim_id := old.purge_claim_id");
  });

  it("keeps browser roles and scheduling outside the destructive contract", () => {
    expect(normalized).toMatch(/revoke all on function public\.recordings_manage_trash_metadata\(\)\s+from public, anon, authenticated/u);
    expect(normalized).toMatch(/grant execute on function public\.recordings_manage_trash_metadata\(\)\s+to service_role/u);
    expect(normalized).toMatch(/revoke all on function public\.claim_due_recording_purges_v1[\s\S]*from public, anon, authenticated/u);
    expect(normalized).toMatch(/grant execute on function public\.claim_due_recording_purges_v1[\s\S]*to service_role/u);
    expect(normalized).not.toMatch(/delete\s+from\s+storage\./u);
    expect(normalized).not.toMatch(/pg_cron|pg_net|cron\.schedule|create\s+extension/u);
  });
});
