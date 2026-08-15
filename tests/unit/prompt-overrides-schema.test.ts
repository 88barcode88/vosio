import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20260813090000_add_prompt_overrides_and_job_snapshots.sql",
  "utf8",
).replace(/\s+/g, " ").toLowerCase();
const saveFunction = sql.slice(
  sql.indexOf("create function public.save_prompt_template_override_v1"),
  sql.indexOf("-- reset_prompt_template_override_v1"),
);
const resetFunction = sql.slice(
  sql.indexOf("create function public.reset_prompt_template_override_v1"),
  sql.indexOf("-- resolve_effective_prompt_template_v1"),
);
const compatibilityFunction = sql.slice(
  sql.indexOf("create function public.fill_legacy_ai_processing_job_prompt_snapshot_v1"),
  sql.indexOf("create trigger ai_processing_jobs_fill_legacy_prompt_snapshot"),
);

describe("prompt override schema", () => {
  it("creates one owner-scoped override per authoritative system prompt", () => {
    expect(sql).toContain("create table public.prompt_template_overrides");
    expect(sql).toContain("unique (user_id, system_prompt_id)");
    expect(sql).toContain("check (revision > 0)");
    expect(sql).toContain("alter table public.prompt_template_overrides force row level security");
    expect(sql).toContain("using ((select auth.uid()) = user_id)");
    expect(sql).toContain("with check ((select auth.uid()) = user_id)");
    expect(sql).toContain("revoke all on table public.prompt_template_overrides from anon");
    const overrideTable = sql.slice(
      sql.indexOf("create table public.prompt_template_overrides"),
      sql.indexOf("create trigger prompt_template_overrides_set_updated_at"),
    );
    expect(overrideTable).not.toContain("output_schema");
  });

  it("keeps writes authoritative and rejects stale revisions", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("save_prompt_template_override_v1");
    expect(sql).toContain(
      "save_prompt_template_override_v1( p_system_prompt_id uuid, p_prompt_text text, p_expected_revision integer",
    );
    expect(sql).not.toContain("p_output_schema");
    expect(sql).toContain("reset_prompt_template_override_v1");
    expect(sql).toContain("resolve_effective_prompt_template_v1");
    expect(sql).toContain("raise exception 'prompt override conflict' using errcode = '40001'");
    expect(sql).toContain("v_current.is_active = false and p_expected_revision = 0");
    expect(sql).toContain("new.revision <> old.revision + 1");
    expect(sql).toContain("for update");
  });

  it("rejects null and out-of-range expected revisions before save or reset locking", () => {
    expect(saveFunction).toContain("p_expected_revision is null or p_expected_revision < 0");
    expect(resetFunction).toContain("p_expected_revision is null or p_expected_revision <= 0");
    expect(saveFunction).toContain("raise exception 'invalid expected prompt override revision' using errcode = '22023'");
    expect(resetFunction).toContain("raise exception 'invalid expected prompt reset revision' using errcode = '22023'");
    expect(saveFunction.indexOf("p_expected_revision is null")).toBeLessThan(saveFunction.indexOf("for update"));
    expect(resetFunction.indexOf("p_expected_revision is null")).toBeLessThan(resetFunction.indexOf("for update"));
  });

  it("preserves first-save zero while serializing stale and concurrent writers", () => {
    expect(saveFunction).toContain("if p_expected_revision <> 0 then raise exception 'prompt override conflict'");
    expect(saveFunction).toContain("v_current.is_active = false and p_expected_revision = 0");
    expect(saveFunction).toContain("if v_current.revision <> p_expected_revision then raise exception 'prompt override conflict'");
    expect(resetFunction).toContain("v_current.revision <> p_expected_revision");
    expect(saveFunction).toContain("for update");
    expect(resetFunction).toContain("for update");
    expect(saveFunction).toContain("when unique_violation then raise exception 'prompt override conflict'");
  });

  it("snapshots new jobs and marks historical reconstruction as inexact", () => {
    for (const column of [
      "prompt_override_id",
      "prompt_source",
      "prompt_name_snapshot",
      "prompt_text_snapshot",
      "prompt_output_schema_snapshot",
      "prompt_revision_snapshot",
      "prompt_snapshot_exact",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("prompt_snapshot_exact = false");
    expect(sql).toContain("legacy_user_template");
    expect(sql).toContain("unknown");
  });

  it("expands legacy job inserts into exact authoritative snapshots before constraints run", () => {
    const compatibilityTrigger = "create trigger ai_processing_jobs_fill_legacy_prompt_snapshot before insert on public.ai_processing_jobs";
    const notNullConstraint = "alter column prompt_source set not null";
    const exactSnapshotConstraint = "add constraint ai_processing_jobs_exact_snapshot_check";

    expect(compatibilityFunction).toContain("returns trigger");
    expect(compatibilityFunction).toContain("security invoker");
    expect(compatibilityFunction).toContain("set search_path = ''");
    expect(compatibilityFunction).toContain("from public.prompt_templates p");
    expect(compatibilityFunction).toContain("where p.id = new.prompt_id");
    expect(compatibilityFunction).toContain("case when v_prompt.is_system then 'system' else 'legacy_user_template' end");
    expect(compatibilityFunction).toContain("new.prompt_snapshot_exact := true");
    expect(compatibilityFunction).toContain("new.prompt_source := 'unknown'");
    expect(compatibilityFunction).toContain("new.prompt_snapshot_exact := false");
    expect(sql).toContain(compatibilityTrigger);
    expect(sql.indexOf(compatibilityTrigger)).toBeLessThan(sql.indexOf(notNullConstraint));
    expect(sql.indexOf(compatibilityTrigger)).toBeLessThan(sql.indexOf(exactSnapshotConstraint));
  });

  it("preserves complete new-build snapshots and keeps the trigger helper private", () => {
    expect(compatibilityFunction).toContain(
      "if new.prompt_source is null and new.prompt_name_snapshot is null and new.prompt_text_snapshot is null and new.prompt_output_schema_snapshot is null then",
    );
    expect(compatibilityFunction).toContain("new.prompt_override_id := null");
    expect(compatibilityFunction).toContain("new.prompt_revision_snapshot := null");
    expect(compatibilityFunction).not.toContain("security definer");
    expect(sql).toContain(
      "revoke execute on function public.fill_legacy_ai_processing_job_prompt_snapshot_v1() from public, anon, authenticated",
    );
    expect(sql).not.toContain(
      "grant execute on function public.fill_legacy_ai_processing_job_prompt_snapshot_v1() to service_role",
    );
  });
});
