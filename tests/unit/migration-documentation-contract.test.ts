import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const restoreMigration = "20260810005550_restore_recordings_from_trash.sql";
const statusFilterMigration = "20260813000000_add_recording_status_filters.sql";
const promptOverrideMigration = "20260813090000_add_prompt_overrides_and_job_snapshots.sql";
const promptHardeningMigration = "20260815073029_harden_prompt_override_privileges.sql";
const automaticTimelineMigration = "20260827094435_add_automatic_timeline_idempotency.sql";
const trashRetentionMigration = "20260827100000_add_trash_retention_deadlines.sql";

describe("migration documentation contract", () => {
  it("lists the C7 restore migration in every current canonical chain document", () => {
    for (const path of [
      "supabase/README.md",
      "docs/requirements/real-workspace.md",
      "docs/api/supabase-schema.md",
      "docs/gotchas.md",
      "docs/decisions/0004-private-vosio-manual-forward-migrations.md"
    ]) {
      expect(readFileSync(path, "utf8"), path).toContain(restoreMigration);
    }
  });

  it("lists the prompt privilege hardening migration in every current canonical chain document", () => {
    for (const path of [
      "supabase/README.md",
      "docs/architecture.md",
      "docs/requirements/real-workspace.md",
      "docs/api/supabase-schema.md",
      "docs/gotchas.md",
      "docs/decisions/0004-private-vosio-manual-forward-migrations.md",
    ]) {
      expect(readFileSync(path, "utf8"), path).toContain(promptHardeningMigration);
    }
  });

  it("lists automatic timeline and Trash retention in the current canonical chain documents", () => {
    for (const path of [
      "supabase/README.md",
      "docs/architecture.md",
      "docs/requirements/real-workspace.md",
      "docs/api/supabase-schema.md",
      "docs/gotchas.md"
    ]) {
      const document = readFileSync(path, "utf8");
      expect(document, path).toContain(automaticTimelineMigration);
      expect(document, path).toContain(trashRetentionMigration);
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
    expect(readme).toContain("no `trash-retention-scheduler-token` secret");
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

  it("separates published source from an external target's migration state", () => {
    const readme = readFileSync("supabase/README.md", "utf8");

    expect(readme).toContain(restoreMigration);
    expect(readme).toContain("not a deployment ledger");
    expect(readme).toContain("Every forward migration is treated as unverified on a target");
    expect(readme).toContain("supabase_migrations.schema_migrations");
    expect(readme).toContain("Schema parity and migration-history parity are separate facts");
  });

  it("requires target-specific schema and ledger inspection before existing-target upgrades", () => {
    for (const path of [
      "supabase/README.md",
      "docs/decisions/0004-private-vosio-manual-forward-migrations.md",
    ]) {
      const document = readFileSync(path, "utf8");

      expect(document, path).toContain(statusFilterMigration);
      expect(document, path).toContain(promptOverrideMigration);
      expect(document, path).toContain(promptHardeningMigration);
      expect(document, path).toContain("supabase_migrations.schema_migrations");
      expect(document, path).toMatch(/(Schema parity and migration-history parity are separate facts|shodné schéma ještě neznamená shodnou historii)/iu);
      expect(document, path).toMatch(/(Never delete history rows|neprovádí se tichá oprava ledgeru)/iu);
    }

    expect(readFileSync("docs/decisions/0004-private-vosio-manual-forward-migrations.md", "utf8")).toContain("zálohu");
  });

  it("requires a compatible web and worker rollout and separate runtime verification", () => {
    const adr = readFileSync("docs/decisions/0004-private-vosio-manual-forward-migrations.md", "utf8");

    expect(adr).toContain("kompatibilní web a workery");
    expect(adr).toContain("prompt_id");
    expect(adr).toContain("BEFORE INSERT");
    expect(adr).toMatch(/Static checks are not runtime verification/iu);
    expect(adr).toContain("rollback rehearsal");
    expect(adr).toContain("pouhý návrat starého webu nemusí být bezpečný");
  });
});
