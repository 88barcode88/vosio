import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const restoreMigration = "20260810005550_restore_recordings_from_trash.sql";
const statusMigration = "20260813000000_add_recording_status_filters.sql";
const promptMigration = "20260813090000_add_prompt_overrides_and_job_snapshots.sql";
const hardeningMigration = "20260815073029_harden_prompt_override_privileges.sql";

describe("migration documentation contract", () => {
  it("lists every current forward migration in the canonical chain documents", () => {
    for (const path of [
      "supabase/README.md",
      "docs/requirements/real-workspace.md",
      "docs/api/supabase-schema.md",
      "docs/gotchas.md",
      "docs/architecture.md"
    ]) {
      const content = readFileSync(path, "utf8");

      expect(content, path).toContain(restoreMigration);
      expect(content, path).toContain(statusMigration);
      expect(content, path).toContain(promptMigration);
      expect(content, path).toContain(hardeningMigration);
    }
  });

  it("keeps the public repository target-neutral about migration deployment", () => {
    const readme = readFileSync("supabase/README.md", "utf8");

    expect(readme).toMatch(/every forward migration[^\n]*unverified/iu);
    expect(readme).not.toContain("Private Vosio");
  });
});
