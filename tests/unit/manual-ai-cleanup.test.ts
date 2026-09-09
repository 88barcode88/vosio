import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANUAL_AI_CLEANUP_BATCH_LIMIT } from "@/lib/ai/manual-job-cleanup-contract";

const routeMocks = vi.hoisted(() => ({
  cleanupManualAiJobs: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  listManualAiCleanupCandidates: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: routeMocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: routeMocks.createAdminClient }));
vi.mock("@/lib/ai/manual-job-cleanup.server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/manual-job-cleanup.server")>(),
  cleanupManualAiJobs: routeMocks.cleanupManualAiJobs,
  listManualAiCleanupCandidates: routeMocks.listManualAiCleanupCandidates
}));

import { GET, POST } from "../../app/api/transcripts/[transcriptId]/manual-ai/cleanup/route";

const {
  cleanupManualAiJobs,
  getManualAiCleanupState,
  listManualAiCleanupCandidates
} = await vi.importActual<typeof import("@/lib/ai/manual-job-cleanup.server")>(
  "@/lib/ai/manual-job-cleanup.server"
);

const transcriptId = "00000000-0000-4000-8000-000000000951";
const firstJobId = "00000000-0000-4000-8000-000000000952";
const secondJobId = "00000000-0000-4000-8000-000000000953";

// createOwnerClient models only the authenticated owner check used before privileged cleanup work.
function createOwnerClient(ownerId = "user-1", transcript: { id: string } | null = { id: transcriptId }) {
  const query = { eq: vi.fn(), maybeSingle: vi.fn(), select: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: transcript, error: null });
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: ownerId ? { id: ownerId } : null }, error: null }) },
    from: vi.fn(() => query)
  };
}

// postCleanup submits an exact bounded set of durable job identifiers.
function postCleanup(jobIds: unknown) {
  return POST(new NextRequest(`https://vosio.test/api/transcripts/${transcriptId}/manual-ai/cleanup`, {
    body: JSON.stringify({ job_ids: jobIds }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  }), { params: Promise.resolve({ transcriptId }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  routeMocks.createClient.mockResolvedValue(createOwnerClient());
  routeMocks.createAdminClient.mockReturnValue({ rpc: vi.fn() });
});

describe("manual AI cleanup route", () => {
  it.each([
    [],
    ["not-a-uuid"],
    [firstJobId, firstJobId],
    Array.from({ length: MANUAL_AI_CLEANUP_BATCH_LIMIT + 1 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`)
  ])("rejects invalid exact-id batches before creating an admin client", async (jobIds) => {
    const response = await postCleanup(jobIds);

    expect(response.status).toBe(400);
    expect(routeMocks.createAdminClient).not.toHaveBeenCalled();
    expect(routeMocks.cleanupManualAiJobs).not.toHaveBeenCalled();
  });

  it("checks the request session and transcript owner before privileged cleanup", async () => {
    routeMocks.createClient.mockResolvedValueOnce(createOwnerClient("user-1", null));

    const response = await postCleanup([firstJobId]);

    expect(response.status).toBe(404);
    expect(routeMocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns mixed idempotent per-id outcomes without treating absence as deletion", async () => {
    routeMocks.cleanupManualAiJobs.mockResolvedValue({
      changed_jobs: [],
      removed_job_ids: [firstJobId],
      results: [
        { job_id: firstJobId, result: "deleted" },
        { job_id: secondJobId, result: "missing" }
      ]
    });

    const response = await postCleanup([firstJobId, secondJobId]);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      changed_jobs: [],
      removed_job_ids: [firstJobId],
      results: [
        { job_id: firstJobId, result: "deleted" },
        { job_id: secondJobId, result: "missing" }
      ]
    });
    expect(routeMocks.cleanupManualAiJobs).toHaveBeenCalledWith({
      admin: expect.anything(), jobIds: [firstJobId, secondJobId], transcriptId, userId: "user-1"
    });
  });

  it("lists a bounded historical cleanup page with an opaque cursor", async () => {
    routeMocks.listManualAiCleanupCandidates.mockResolvedValue({
      candidates: [{ job_id: firstJobId, cleanup_reason: "eligible_terminal_no_output" }],
      next_cursor: "opaque-owner-bound-cursor"
    });

    const response = await GET(
      new NextRequest(`https://vosio.test/api/transcripts/${transcriptId}/manual-ai/cleanup?cursor=opaque-input`),
      { params: Promise.resolve({ transcriptId }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      candidates: [{ job_id: firstJobId, cleanup_reason: "eligible_terminal_no_output" }],
      next_cursor: "opaque-owner-bound-cursor"
    });
    expect(routeMocks.listManualAiCleanupCandidates).toHaveBeenCalledWith({
      admin: expect.anything(), cursor: "opaque-input", transcriptId, userId: "user-1"
    });
  });
});

// createRpcAdmin returns one awaitable RPC result per function name.
function createRpcAdmin(results: Record<string, { data: unknown; error: unknown }>) {
  return {
    rpc: vi.fn((name: string) => Promise.resolve(results[name] ?? { data: null, error: { code: "missing_mock" } }))
  };
}

describe("manual AI cleanup server contract", () => {
  it("uses a transcript-and-owner-bound keyset cursor and never exposes timestamps", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      actions: index === 0 ? ["delete"] : [],
      cleanup_reason: index === 0 ? "eligible_terminal_no_output" : "active_or_slow",
      created_at: new Date(Date.UTC(2026, 8, 8, 12, 0, 50 - index)).toISOString(),
      eligible_count: 1,
      job_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      poll_eligible: index !== 0
    }));
    const firstAdmin = createRpcAdmin({ list_manual_ai_job_cleanup_v1: { data: rows, error: null } });
    const firstPage = await listManualAiCleanupCandidates({
      admin: firstAdmin as never, cursor: null, transcriptId, userId: "user-1"
    });

    expect(firstPage.candidates).toHaveLength(50);
    expect(firstPage.next_cursor).toBeTruthy();
    expect(JSON.stringify(firstPage)).not.toContain("created_at");

    const secondAdmin = createRpcAdmin({ list_manual_ai_job_cleanup_v1: { data: [], error: null } });
    await listManualAiCleanupCandidates({
      admin: secondAdmin as never, cursor: firstPage.next_cursor, transcriptId, userId: "user-1"
    });
    expect(secondAdmin.rpc).toHaveBeenCalledWith("list_manual_ai_job_cleanup_v1", expect.objectContaining({
      p_before_created_at: rows[49]!.created_at,
      p_before_job_id: rows[49]!.job_id,
      p_limit: 51,
      p_transcript_id: transcriptId,
      p_user_id: "user-1"
    }));

    await expect(listManualAiCleanupCandidates({
      admin: secondAdmin as never, cursor: firstPage.next_cursor, transcriptId: firstJobId, userId: "user-1"
    })).rejects.toThrow("manual_ai_cleanup_invalid_cursor");
    expect(secondAdmin.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns authoritative classifications and global cleanup metadata for ai-state", async () => {
    const admin = createRpcAdmin({
      classify_manual_ai_jobs_v1: {
        data: [{
          actions: ["reconcile", "interrupt"], attempt_count: 1, cleanup_reason: "active_or_slow",
          completed_at: null, created_at: "2026-09-08T12:00:00.000Z", failure_code: null,
          job_id: firstJobId, lease_expires_at: "2026-09-08T12:08:00.000Z", max_attempts: 1,
          model: "gpt-5.6-terra", poll_eligible: true, processing_type: "summary", retry_after_at: null,
          started_at: "2026-09-08T12:00:00.000Z", status: "running"
        }],
        error: null
      },
      list_manual_ai_job_cleanup_v1: {
        data: [{
          actions: ["delete"], cleanup_reason: "eligible_terminal_no_output",
          created_at: "2026-09-07T12:00:00.000Z", eligible_count: 73,
          job_id: secondJobId, poll_eligible: false
        }],
        error: null
      }
    });

    const state = await getManualAiCleanupState({
      admin: admin as never, jobIds: [firstJobId], transcriptId, userId: "user-1"
    });

    expect(state.classifications).toEqual([expect.objectContaining({ job_id: firstJobId, poll_eligible: true })]);
    expect(state.cleanup).toEqual({ eligible_count: 73, next_cursor: null });
  });

  it("keeps deleted evidence separate from reconciled changed summaries", async () => {
    const admin = createRpcAdmin({
      cleanup_manual_ai_jobs_v1: {
        data: [
          { job_id: firstJobId, result: "deleted" },
          { job_id: secondJobId, result: "reconciled" }
        ],
        error: null
      },
      classify_manual_ai_jobs_v1: {
        data: [{
          actions: [], attempt_count: 1, cleanup_reason: "protected_output", completed_at: "2026-09-08T12:10:00.000Z",
          created_at: "2026-09-08T12:00:00.000Z", failure_code: null, job_id: secondJobId,
          lease_expires_at: null, max_attempts: 1, model: "gpt-5.6-terra", poll_eligible: false,
          processing_type: "summary", retry_after_at: null, started_at: "2026-09-08T12:00:00.000Z", status: "done"
        }],
        error: null
      }
    });

    const result = await cleanupManualAiJobs({
      admin: admin as never, jobIds: [firstJobId, secondJobId], transcriptId, userId: "user-1"
    });

    expect(result.removed_job_ids).toEqual([firstJobId]);
    expect(result.changed_jobs).toEqual([expect.objectContaining({ job_id: secondJobId, status: "done" })]);
    expect(result.results).toEqual([
      { job_id: firstJobId, result: "deleted" },
      { job_id: secondJobId, result: "reconciled" }
    ]);
  });
});

describe("manual AI cleanup migration", () => {
  const migration = readFileSync(
    "supabase/migrations/20260908103000_add_manual_ai_job_cleanup.sql",
    "utf8"
  ).toLowerCase();

  it("centralizes every reason, poll decision and allowed action in one SQL classifier", () => {
    for (const reason of [
      "eligible_terminal_no_output", "eligible_stale_unclaimed", "protected_output",
      "protected_projection", "active_or_slow", "ownership_mismatch", "unsupported_legacy"
    ]) expect(migration).toContain(`'${reason}'`);
    for (const action of ["reconcile", "interrupt", "delete"]) {
      expect(migration).toContain(`'${action}'`);
    }
    expect(migration).toContain("classify_manual_ai_job_cleanup_v1");
    expect(migration).toMatch(/p_created_at\s*<=\s*p_now\s*-\s*make_interval\(secs\s*=>\s*480\)/);
    expect(migration).toMatch(/p_status\s*=\s*'running'[\s\S]*p_lease_expires_at\s*<=\s*p_now/);
  });

  it("keeps active legacy rows fail-closed while allowing dependency-free terminal history", () => {
    const classifier = migration.slice(
      migration.indexOf("create function public.classify_manual_ai_job_cleanup_v1"),
      migration.indexOf("create function public.classify_manual_ai_jobs_v1")
    );
    const exactShape = classifier.indexOf("v_exact_shape := p_max_attempts = 1");
    const terminal = classifier.indexOf("p_status in ('done', 'failed', 'cancelled')", exactShape);
    const legacy = classifier.indexOf("if not v_exact_shape", terminal);
    const queuedAge = classifier.indexOf("p_created_at <= p_now - make_interval(secs => 480)", legacy);
    expect(exactShape).toBeGreaterThan(-1);
    expect(terminal).toBeLessThan(legacy);
    expect(legacy).toBeLessThan(queuedAge);
    expect(classifier.slice(legacy, queuedAge)).toContain("'unsupported_legacy'");
  });

  it("locks all parent jobs in UUID order and every dependency in a fixed order before deletion", () => {
    const cleanup = migration.slice(migration.indexOf("create function public.cleanup_manual_ai_jobs_v1"));
    const parent = cleanup.indexOf("order by requested.id");
    const output = cleanup.indexOf("from public.ai_outputs", parent);
    const tasks = cleanup.indexOf("from public.transcript_tasks", output);
    const chapters = cleanup.indexOf("from public.transcript_chapters", tasks);
    const decisions = cleanup.indexOf("from public.transcript_decisions", chapters);
    const risks = cleanup.indexOf("from public.transcript_risks", decisions);
    const deletion = cleanup.indexOf("delete from public.ai_processing_jobs", risks);

    expect(parent).toBeGreaterThan(-1);
    expect(cleanup.slice(parent, output)).toMatch(
      /j\.transcript_id\s*=\s*p_transcript_id[\s\S]*j\.user_id\s*=\s*p_user_id[\s\S]*j\.execution_mode\s*=\s*'manual'[\s\S]*for update/
    );
    expect(output).toBeLessThan(tasks);
    expect(tasks).toBeLessThan(chapters);
    expect(chapters).toBeLessThan(decisions);
    expect(decisions).toBeLessThan(risks);
    expect(risks).toBeLessThan(deletion);
    expect(cleanup).not.toMatch(/delete\s+from\s+public\.(ai_outputs|transcript_tasks|transcript_chapters|transcript_decisions|transcript_risks)/);
  });

  it("makes settlement take the same parent row lock before its status update", () => {
    const settlement = migration.slice(
      migration.indexOf("create or replace function public.settle_manual_ai_job_v1"),
      migration.indexOf("create function public.cleanup_manual_ai_jobs_v1")
    );
    expect(settlement).toMatch(/select j\.\*[\s\S]*from public\.ai_processing_jobs j[\s\S]*for update/);
    expect(settlement.indexOf("for update")).toBeLessThan(settlement.indexOf("update public.ai_processing_jobs"));
    expect(settlement).toContain("v_job.lease_token is distinct from p_lease_token");
  });

  it("keeps the RPCs invoker-only, fully qualified and unavailable to browser roles", () => {
    for (const name of [
      "classify_manual_ai_job_cleanup_v1", "classify_manual_ai_jobs_v1",
      "list_manual_ai_job_cleanup_v1", "cleanup_manual_ai_jobs_v1"
    ]) {
      const definition = migration.slice(migration.indexOf(`create function public.${name}`));
      expect(definition).toContain("security invoker");
      expect(definition).toContain("set search_path = ''");
      expect(migration).toContain(`revoke all on function public.${name}`);
    }
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).not.toMatch(/alter table public\.[a-z_]+ (enable|disable|force|no force) row level security/);
  });

  it("bounds both list and mutation batches and uses descending tuple keyset pagination", () => {
    expect(migration).toContain("p_limit not between 1 and 51");
    expect(migration).toContain("cardinality(p_job_ids) not between 1 and 50");
    expect(migration).toContain("(counted.created_at, counted.job_id) < (p_before_created_at, p_before_job_id)");
    expect(migration).toContain("order by counted.created_at desc, counted.job_id desc");
  });
});

describe("manual AI cleanup PostgreSQL harness", () => {
  const harness = readFileSync("scripts/verify-manual-ai-cleanup-postgres.mjs", "utf8").toLowerCase();

  it("never creates or alters cluster-global roles", () => {
    expect(harness).not.toMatch(/create\s+role\s+(anon|authenticated|service_role)/);
    expect(harness).not.toMatch(/alter\s+role\s+(anon|authenticated|service_role)/);
  });

  it("requires compatible pre-existing browser and service roles", () => {
    expect(harness).toContain("blocked: required pre-existing postgresql role");
    expect(harness).toContain("rolbypassrls");
    expect(harness).toContain("rolsuper");
    expect(harness).toContain("refused: pre-existing postgres role");
  });

  it("coordinates both cleanup races through observed PostgreSQL lock waits", () => {
    const races = harness.slice(
      harness.indexOf("// race 1:"),
      harness.indexOf("const denied = runpsql")
    );
    expect(harness).toContain("function startpsqlsession");
    expect(harness).toContain("function waitforsessionoutput");
    expect(harness).toContain("async function waitforlockwait");
    expect(races.match(/startpsqlsession/g)).toHaveLength(4);
    expect(races).toContain("vosio-cleanup-waits-for-persistence");
    expect(races).toContain("vosio-late-persistence-waits-for-cleanup");
    expect(races.match(/await waitforlockwait/g)).toHaveLength(2);
    expect(races).not.toContain("pg_sleep");
  });

  it("uses one donor output while each output-less projection parent is checked independently", () => {
    const projections = harness.slice(harness.indexOf("-- every structured dependency family"));
    const donor = projections.match(
      /insert into public\.ai_outputs\(id,processing_job_id,transcript_id,user_id,output_text\)\s*values\s*\(\s*'([^']+)'\s*,\s*'([^']+)'/
    );
    const rows = Array.from(projections.matchAll(
      /insert into public\.transcript_(tasks|chapters|decisions|risks)\(ai_output_id,processing_job_id,transcript_id,user_id,position,title\)\s*values\s*\(\s*'([^']+)'\s*,\s*'([^']+)'/g
    ));

    expect(donor).not.toBeNull();
    expect(rows.map((row) => row[1])).toEqual(["tasks", "chapters", "decisions", "risks"]);
    expect(new Set(rows.map((row) => row[3])).size).toBe(4);
    expect(rows.every((row) => row[2] === donor?.[1] && row[3] !== donor?.[2])).toBe(true);
    expect(projections).toContain("foreach v_job in array");
    expect(projections).toContain("output-less projection parent unexpectedly owns output");
    expect(projections).toContain("projection parent was deleted");
  });
});
