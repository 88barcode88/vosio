import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath =
  "supabase/migrations/20260815073029_harden_prompt_override_privileges.sql";
const sql = readFileSync(migrationPath, "utf8")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

describe("prompt override privilege hardening", () => {
  it("replaces inherited authenticated table privileges with the narrow API contract", () => {
    const revoke =
      "revoke all privileges on table public.prompt_template_overrides from authenticated";
    const grant =
      "grant select, insert, update on table public.prompt_template_overrides to authenticated";

    expect(sql).toContain(revoke);
    expect(sql).toContain(grant);
    expect(sql.indexOf(revoke)).toBeLessThan(sql.indexOf(grant));
    expect(sql).not.toContain(
      "grant all on table public.prompt_template_overrides to authenticated",
    );
  });

  it("removes direct browser-role execution from the trigger-only validator", () => {
    expect(sql).toContain(
      "revoke execute on function public.validate_prompt_template_override_base_v1() from public, anon, authenticated",
    );
  });

  it("indexes the reverse system-prompt foreign-key lookup without duplicating the jobs index", () => {
    expect(sql).toContain(
      "create index if not exists prompt_template_overrides_system_prompt_id_idx on public.prompt_template_overrides(system_prompt_id)",
    );
    expect(sql).not.toContain("ai_processing_jobs_override_user_idx");
    expect(sql).not.toContain("drop index");
  });
});
