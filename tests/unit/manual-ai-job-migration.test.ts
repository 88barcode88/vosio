import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  "supabase/migrations/20260904140126_harden_manual_ai_job_recovery.sql",
  "utf8"
);
const sql = migrationSource.toLowerCase();
const recoveryRunbook = readFileSync("supabase/README.md", "utf8");
const reviewedMigrationSha256 = "048829215E3D80AA9AEAAA513FE39E5B1C2BCCD9CB4A42F934C9F2B611E3126D";

describe("manual AI recovery migration", () => {
  it("pins the approval-only runbook to the reviewed migration source hash", () => {
    const migrationSha256 = createHash("sha256").update(migrationSource).digest("hex").toUpperCase();

    expect(migrationSha256).toBe(reviewedMigrationSha256);
    expect(recoveryRunbook).toContain(`source SHA256 \`${migrationSha256}\``);
  });

  it("adds constrained safe failures without destructive data changes", () => {
    expect(sql).toContain("add column failure_code text");
    expect(sql).toContain("add column retry_after_at timestamptz");
    for (const code of ["insufficient_credit_or_quota", "rate_limited", "invalid_model", "provider_unavailable", "provider_configuration", "execution_interrupted", "persistence_failed", "unknown"]) {
      expect(sql).toContain(`'${code}'`);
    }
    expect(sql).not.toMatch(/\bdelete\s+from\b|\bdrop\s+(table|column)\b/);
  });

  it("keeps failure metadata on failed rows and allows an optional rate-limit deadline", () => {
    expect(sql).toMatch(/ai_processing_jobs_failure_state_check[\s\S]*status\s*=\s*'failed'[\s\S]*failure_code\s+is\s+null[\s\S]*retry_after_at\s+is\s+null/);
    expect(sql).toMatch(/retry_after_at\s+is\s+null\s+or\s+failure_code\s*=\s*'rate_limited'/);
    expect(sql).not.toMatch(/failure_code\s*=\s*'rate_limited'\s+and\s+retry_after_at\s+is\s+not\s+null/);
    expect(sql).toMatch(/p_retry_after_at\s+is\s+not\s+null[\s\S]*p_failure_code\s*<>\s*'rate_limited'/);
  });

  it("uses short row locks, exact owner identity, a 480 second claim and exact-token settlement", () => {
    expect(sql).toMatch(/claim_manual_ai_job_v1[\s\S]*execution_mode\s*=\s*'manual'[\s\S]*for update/);
    expect(sql).toMatch(/lease_expires_at\s*=\s*p_now\s*\+\s*make_interval\(secs\s*=>\s*480\)/);
    expect(sql).toMatch(/settle_manual_ai_job_v1[\s\S]*lease_token\s*=\s*p_lease_token/);
    expect(sql).toMatch(/j\.id\s*=\s*p_job_id[\s\S]*j\.transcript_id\s*=\s*p_transcript_id[\s\S]*j\.user_id\s*=\s*p_user_id/);
    const claim = sql.slice(sql.indexOf("create function public.claim_manual_ai_job_v1"), sql.indexOf("create function public.settle_manual_ai_job_v1"));
    expect(claim).not.toContain("lease_expires_at <= p_now");
  });

  it("leaves terminal and fresh-running rows unchanged before considering durable output", () => {
    const reconcile = sql.slice(sql.indexOf("create function public.reconcile_manual_ai_job_v1"));
    const terminalGate = reconcile.indexOf("if v_job.status in ('done', 'failed', 'cancelled')");
    const runningGate = reconcile.indexOf("if v_job.status = 'running'");
    const busyGate = reconcile.indexOf("v_job.lease_expires_at > p_now", runningGate);
    const outputLookup = reconcile.indexOf("from public.ai_outputs", runningGate);
    expect(terminalGate).toBeGreaterThan(-1);
    expect(terminalGate).toBeLessThan(outputLookup);
    expect(runningGate).toBeLessThan(busyGate);
    expect(busyGate).toBeLessThan(outputLookup);
    expect(reconcile.slice(terminalGate, runningGate)).toContain("'terminal'::text");
    expect(reconcile.slice(runningGate, outputLookup)).toContain("'busy'::text");
  });

  it("repairs only stale running output and interrupts stale running without output", () => {
    const reconcile = sql.slice(sql.indexOf("create function public.reconcile_manual_ai_job_v1"));
    const outputLookup = reconcile.indexOf("from public.ai_outputs");
    const outputGate = reconcile.indexOf("if v_has_output", outputLookup);
    const doneUpdate = reconcile.indexOf("status = 'done'", outputGate);
    const interruptedUpdate = reconcile.indexOf("failure_code = 'execution_interrupted'", doneUpdate);
    expect(outputLookup).toBeGreaterThan(-1);
    expect(outputGate).toBeGreaterThan(outputLookup);
    expect(doneUpdate).toBeGreaterThan(outputGate);
    expect(interruptedUpdate).toBeGreaterThan(doneUpdate);
    expect(reconcile.slice(outputGate, interruptedUpdate)).toContain("'done'::text");
    expect(reconcile.slice(interruptedUpdate)).toContain("'interrupted'::text");
  });

  it("never reclaims running work and locks down every invoker RPC", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = ''");
    for (const name of ["claim_manual_ai_job_v1", "settle_manual_ai_job_v1", "reconcile_manual_ai_job_v1"]) {
      expect(sql).toContain(`revoke all on function public.${name}`);
      expect(sql).toContain("from public, anon, authenticated");
      expect(sql).toContain("to service_role");
    }
  });
});
