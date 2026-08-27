import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const restoreMigration = "20260810005550_restore_recordings_from_trash.sql";
const statusMigration = "20260813000000_add_recording_status_filters.sql";
const promptMigration = "20260813090000_add_prompt_overrides_and_job_snapshots.sql";
const hardeningMigration = "20260815073029_harden_prompt_override_privileges.sql";
const automaticTimelineMigration = "20260827094435_add_automatic_timeline_idempotency.sql";
const trashRetentionMigration = "20260827100000_add_trash_retention_deadlines.sql";

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
      expect(content, path).toContain(automaticTimelineMigration);
      expect(content, path).toContain(trashRetentionMigration);
    }
  });

  it("keeps the self-hosted retention worker disabled-first and out of token history", () => {
    const readme = readFileSync("supabase/README.md", "utf8");

    expect(readme).toContain("read -r -s");
    expect(readme).toContain("Read-Host -AsSecureString");
    expect(readme).toContain("TRASH_RETENTION_SCHEDULER_TOKEN");
    expect(readme).toContain("unset TRASH_RETENTION_SCHEDULER_TOKEN");
    expect(readme).toContain("Remove-Item Env:\\TRASH_RETENTION_SCHEDULER_TOKEN");
    expect(readme).toContain("TRASH_RETENTION_ENABLED=false");
    expect(readme).toContain("TRASH_RETENTION_ENABLED=true");
    expect(readme).toContain("trash-retention-scheduler-token");
    expect(readme).toContain("cron.unschedule(<exact-trash-retention-job-id>)");
    expect(readme).toContain("POST without Authorization");
    expect(readme).toContain("405`, `401`, `401`, then `200");
    expect(readme).toContain("no target-only retry mode");
    expect(readme).toContain("for update;");
    expect(readme).toContain("purge_attempt_count >= 5");
    expect(readme).toContain("set local role service_role;");
    expect(readme).toContain("purge_claim_id = null");
    expect(readme).toContain("finalize_recording_purge_v1");
    expect(readme).toContain("with eligible as");
    expect(readme).toContain("from eligible;");
    expect(readme).toContain("Zero eligible rows means the RPC was not called");
    expect(readme).toContain("purge_started_at <= statement_timestamp() - interval '15 minutes'");
    expect(readme).toContain("explicitly enter `commit;`");
    expect(readme).toContain("otherwise enter `rollback;`");
    expect(readme).toContain("expected-current-purge-claim-id-or-empty");
    expect(readme).toContain("expected-storage-path-or-empty");
    expect(readme).toContain("partially deleted, restore is forbidden");
  });

  it("keeps the public repository target-neutral about migration deployment", () => {
    const readme = readFileSync("supabase/README.md", "utf8");

    expect(readme).toMatch(/every forward migration[^\n]*unverified/iu);
    expect(readme).not.toContain("Private Vosio");
  });
});
