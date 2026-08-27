import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
const migrationName = readdirSync(migrationsDirectory)
  .find((name) => name.endsWith("_add_automatic_timeline_idempotency.sql"));

describe("automatic timeline source migration", () => {
  it("adds automatic job identity, bounded leases and a unique output guard", () => {
    expect(migrationName).toBeTruthy();
    const path = join(migrationsDirectory, migrationName ?? "missing.sql");
    expect(existsSync(path)).toBe(true);
    const sql = readFileSync(path, "utf8");

    expect(sql).toMatch(/execution_mode\s+text\s+not null\s+default\s+'manual'/iu);
    expect(sql).toMatch(/automatic_idempotency_key\s+text/iu);
    expect(sql).toMatch(/attempt_count\s+integer\s+not null\s+default\s+0/iu);
    expect(sql).toMatch(/max_attempts\s+integer\s+not null\s+default\s+3/iu);
    expect(sql).toMatch(/lease_token\s+uuid/iu);
    expect(sql).toMatch(/lease_expires_at\s+timestamptz/iu);
    expect(sql).toMatch(/create\s+unique\s+index[\s\S]*automatic_idempotency_key[\s\S]*where\s+automatic_idempotency_key\s+is\s+not\s+null/iu);
    expect(sql).toMatch(/on\s+conflict\s*\(automatic_idempotency_key\)[\s\S]*do\s+nothing/iu);
    expect(sql).toMatch(/create\s+unique\s+index[\s\S]*ai_outputs\s*\(processing_job_id\)/iu);
  });

  it("stores a durable completion-time consent snapshot before recoverable enqueue", () => {
    const sql = readFileSync(join(migrationsDirectory, migrationName ?? "missing.sql"), "utf8");

    expect(sql).toMatch(/create\s+table\s+public\.automatic_timeline_intents/iu);
    expect(sql).toMatch(/consent_snapshot\s+boolean\s+not null[\s\S]*check\s*\(consent_snapshot\s*=\s*true\)/iu);
    expect(sql).toMatch(/automatic_idempotency_key\s+text\s+not null\s+unique/iu);
    expect(sql).toMatch(/foreign\s+key\s*\(transcript_id,\s*user_id\)[\s\S]*references\s+public\.transcripts/iu);
    expect(sql).toMatch(/alter\s+table\s+public\.automatic_timeline_intents\s+force\s+row\s+level\s+security/iu);
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+public\.automatic_timeline_intents\s+from\s+public,\s*anon,\s*authenticated/iu);
    expect(sql).toMatch(/create\s+index\s+automatic_timeline_intents_owner_transcript_idx[\s\S]*\(transcript_id,\s*user_id,\s*created_at\s+desc\)/iu);
    expect(sql).toMatch(/create\s+index\s+automatic_timeline_intents_user_idx[\s\S]*\(user_id\)/iu);
    expect(sql).toMatch(/alter\s+table\s+public\.transcripts[\s\S]*completion_generation_key\s+text/iu);
  });

  it("arbitrates generation completion, prompt snapshot and cleanup in one locked transition", () => {
    const sql = readFileSync(join(migrationsDirectory, migrationName ?? "missing.sql"), "utf8");
    const transitionStart = sql.indexOf("create function public.complete_transcript_generation_v1");
    const transitionEnd = sql.indexOf(
      "revoke all on function public.complete_transcript_generation_v1",
      transitionStart
    );
    const transition = sql.slice(transitionStart, transitionEnd);

    expect(transitionStart).toBeGreaterThan(-1);
    expect(transition).toMatch(/from\s+public\.transcripts[\s\S]*for\s+update/iu);
    expect(transition).toMatch(/completion_generation_key\s+is\s+distinct\s+from\s+p_completion_generation_key/iu);
    expect(transition).toMatch(/from\s+public\.prompt_templates[\s\S]*for\s+share/iu);
    expect(transition).toMatch(/from\s+public\.prompt_template_overrides[\s\S]*for\s+share/iu);
    expect(transition).toMatch(/insert\s+into\s+public\.automatic_timeline_intents/iu);
    expect(transition).toMatch(/delete\s+from\s+public\.ai_processing_jobs/iu);
    expect(transition).toMatch(/update\s+public\.transcripts[\s\S]*completion_generation_key\s*=\s*p_completion_generation_key/iu);
    expect(transition).toMatch(/update\s+public\.recordings[\s\S]*status\s*=\s*'completed'/iu);
    expect(transition.indexOf("insert into public.automatic_timeline_intents")).toBeLessThan(
      transition.indexOf("update public.transcripts")
    );
    expect(transition.indexOf("update public.transcripts")).toBeLessThan(
      transition.indexOf("update public.recordings")
    );
    expect(transition).not.toMatch(/exception\s+when/iu);
  });

  it("fails closed before the output uniqueness guard when historical duplicates need lineage review", () => {
    const sql = readFileSync(join(migrationsDirectory, migrationName ?? "missing.sql"), "utf8");
    const preflightIndex = sql.indexOf("automatic timeline output uniqueness preflight failed");
    const uniqueIndex = sql.indexOf("create unique index ai_outputs_processing_job_unique_idx");

    expect(preflightIndex).toBeGreaterThan(-1);
    expect(preflightIndex).toBeLessThan(uniqueIndex);
    expect(sql).toMatch(/from\s+public\.ai_outputs[\s\S]*group\s+by\s+processing_job_id[\s\S]*having\s+count\(\*\)\s*>\s*1/iu);
    expect(sql).toMatch(/raise\s+exception[\s\S]*lineage review/iu);
    expect(sql).not.toMatch(/delete\s+from\s+public\.ai_outputs/iu);
  });

  it("documents the exact read-only duplicate preflight and blocks blind rollout in every operator surface", () => {
    for (const path of [
      "docs/api/supabase-schema.md",
      "docs/gotchas.md",
      "docs/requirements/release-checklist.md"
    ]) {
      const document = readFileSync(join(process.cwd(), path), "utf8");

      expect(document).toMatch(/select[\s\S]*processing_job_id,[\s\S]*count\(\*\) as output_count,[\s\S]*array_agg\(id order by created_at, id\) as ai_output_ids[\s\S]*from public\.ai_outputs[\s\S]*group by processing_job_id[\s\S]*having count\(\*\) > 1[\s\S]*order by processing_job_id;/iu);
      expect(document).toMatch(/live apply blocked pending preflight/iu);
      expect(document).toMatch(/lineage review/iu);
      expect(document).toMatch(/blind dedup/iu);
    }
  });

  it("keeps completion, enqueue, claim and settlement service-role-only", () => {
    const sql = readFileSync(join(migrationsDirectory, migrationName ?? "missing.sql"), "utf8");

    for (const name of [
      "complete_transcript_generation_v1",
      "enqueue_automatic_timeline_job_v1",
      "claim_automatic_timeline_job_v1",
      "settle_automatic_timeline_job_v1"
    ]) {
      expect(sql).toMatch(new RegExp(`create\\s+function\\s+public\\.${name}[\\s\\S]*security\\s+invoker`, "iu"));
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*from\\s+public,\\s*anon,\\s*authenticated`, "iu"));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*to\\s+service_role`, "iu"));
    }

    expect(sql).toMatch(/status\s*=\s*'running'[\s\S]*lease_expires_at\s*<=\s*p_now/iu);
    expect(sql).toMatch(/attempt_count\s*<\s*max_attempts/iu);
    expect(sql).not.toContain("persist_automatic_timeline_intent_v1");
    expect(sql).not.toContain("delete_ai_data_for_transcript_replacement_v1");
    expect(sql).not.toMatch(/pg_cron|cron\.schedule|vercel/iu);
  });
});
