import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260922220000_add_shared_recording_trash.sql";
const sql = existsSync(path) ? readFileSync(path, "utf8") : "";

describe("shared Trash SQL source boundaries (not runtime authorization proof)", () => {
  it("separates session permission from receipt-bound service cleanup", () => {
    expect(sql).toContain("create table public.recording_purge_operations");
    expect(sql).toContain("public.can_manage_recording(p_recording_id)");
    expect(sql).toContain("public.recording_sharing_lock_v1()");
    for (const name of ["trash_recording_v1", "restore_shared_recording_v1", "prepare_recording_purge_v1", "start_recording_purge_v1", "release_recording_purge_v1"]) {
      expect(sql).toContain("create function public." + name + "(");
    }
    expect(sql).toContain("create function public.acquire_recording_purge_work_v1(");
    expect(sql).toContain("create function public.finalize_recording_purge_work_v1(");
    expect(sql).toContain("create function public.delete_managed_transcript_task_group_v1(");
    expect(sql).toContain("create function public.delete_managed_ai_output_v1(");
    expect(sql).not.toMatch(/grant\s+(select|update|delete|all).*on.*recordings.*to authenticated/i);
  });

  it("retains upload/claim fences, prior status and irreversible cleanup state", () => {
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain("deleted_from_status");
    expect(sql).toContain("v_op.phase <> 'prepared'");
    expect(sql).toContain("v_phase := 'started'");
    expect(sql).toContain("from storage.objects");
    expect(sql).not.toMatch(/delete from storage\.objects/i);
  });

  it("fences all legacy auto worker functions away from active manual receipts", () => {
    for (const name of ["claim_due_recording_purges_v1", "refresh_recording_purge_claim_v1", "release_recording_purge_claim_v1", "finalize_recording_purge_v1"]) {
      const body = sql.split("create or replace function public." + name + "(")[1]?.split("$auto$;")[0];
      expect(body, name).toBeDefined();
      expect(body, name).toContain("public.recording_sharing_lock_v1()");
      expect(body, name).toContain("o.phase in ('prepared','started')");
    }
    expect(sql).toContain("r.purge_after <= statement_timestamp()");
    expect(sql).toContain("r.purge_attempt_count < 5");
  });

  it("keeps accepted cleanup independent of later actor authority while child delete requires active management", () => {
    const accepted = sql.split("$accepted$")[1];
    expect(accepted).toContain("v_record.purge_claim_id is distinct from v_op.claim_id");
    expect(accepted).not.toMatch(/auth\.uid|can_manage_recording/);
    const task = sql.split("$task$")[1];
    expect(task).toContain("public.lock_managed_trash_recording_v1(v_recording_id)");
    expect(task).toContain("v_record.status='deleted'");
    expect(task).toContain("v_updated_at<>p_expected_updated_at");
    const output = sql.split("$output$")[1];
    expect(output).toContain("for update");
    expect(output).not.toContain("updated_at");
  });

  it("bounds raw task groups before dedup and deletes only a complete same-recording locked set", () => {
    const task = sql.split("$task$")[1];
    expect(task).toContain("cardinality(p_task_ids) not between 1 and 1000");
    expect(task).toContain("array_ndims(p_task_ids) is distinct from 1");
    expect(task.indexOf("cardinality(p_task_ids)")).toBeLessThan(task.indexOf("unnest(p_task_ids)"));
    expect(task).toContain("p_task_id=any(v_ids)");
    expect(task).toContain("order by x.id for update");
    expect(task).toContain("v_matching_count<>cardinality(v_ids)");
    expect(task).toContain("t.recording_id=v_record.id");
    expect(task).toContain("get diagnostics v_deleted = row_count");
    expect(task).toContain("'deletedCount',v_deleted");
    expect(sql).not.toContain("create function public.delete_managed_transcript_task_v1(");
  });

  it("enriches only bounded managed Trash IDs without exposing worker identities", () => {
    const metadata = sql.split("$metadata$")[1];
    expect(metadata).toContain("cardinality(p_recording_ids),0)>100");
    expect(metadata).toContain("r.id=any(p_recording_ids)");
    expect(metadata).toContain("r.status='deleted' and public.can_manage_recording(r.id)");
    const projection = sql.split("create function public.get_managed_recording_trash_v1")[1]?.split("language plpgsql")[0];
    expect(projection).toContain("purge_phase text");
    expect(projection).not.toMatch(/claim_id|user_id|storage_path|actor_id/);
  });

  it("ships runtime role and interleaving artifacts, without claiming source matching proves RLS", () => {
    const runtime = readFileSync("supabase/tests/shared_recording_trash.sql", "utf8");
    expect(runtime).toContain("Authority loss BEFORE start denies cleanup");
    expect(runtime).toContain("Accepted exact receipt completes AFTER authority loss");
    expect(runtime).toContain("Legacy release cannot reopen receipt");
    expect(runtime).not.toContain("public.recording_visibility");
    for (const assertion of runtime.split("\n").filter((line) => line.startsWith("select throws_ok"))) {
      expect(assertion.match(/\$\$/g), assertion).toHaveLength(2);
    }
    const races = readFileSync("supabase/tests/shared_recording_trash_concurrency.spec", "utf8");
    expect(races.match(/^permutation /gm)).toHaveLength(11);
  });

  it("recovers only accepted leases with bounded attempts, fencing and durable completion", () => {
    const discovery = sql.split("$discover$")[1];
    expect(discovery).toContain("o.phase='started' and o.work_attempt_count<5");
    expect(discovery).toContain("for update of r skip locked");
    expect(discovery).toContain("least(greatest(coalesce(p_limit,5),0),5)");
    const finalizer = sql.split("$finalize$")[1];
    expect(finalizer).toContain("p_claim_id is distinct from v_op.claim_id");
    expect(finalizer).toContain("completed_at=statement_timestamp()");
    expect(sql.split("create table public.recording_purge_operations")[1]?.split(");")[0]).not.toContain("references");
  });

  it("carries the accepted worker attempt budget across session receipt replacement", () => {
    const prepare = sql.split("$prepare$")[1];
    expect(prepare).toContain("v_attempts := v_old.work_attempt_count");
    expect(prepare).toContain("v_old.work_attempt_count>=5");
    expect(prepare).toContain("v_record.deleted_at,v_phase,v_attempts");
  });

  it("indexes each output projection probe and FK cascade without adding read grants", () => {
    for (const table of ["transcript_tasks", "transcript_chapters", "transcript_decisions", "transcript_risks"]) {
      expect(sql).toContain(`create index if not exists ${table}_output_transcript_idx on public.${table}(ai_output_id,transcript_id)`);
    }
  });

  it("rejects every output descendant with a different job before cascading deletion", () => {
    const output = sql.split("$output$")[1];
    for (const table of ["transcript_tasks", "transcript_chapters", "transcript_decisions", "transcript_risks"]) {
      expect(output).toContain(`from public.${table} x where x.ai_output_id=v_output.id and (x.transcript_id<>v_output.transcript_id or x.processing_job_id is distinct from v_output.processing_job_id)`);
    }
  });

  it("recovers own existing receipts before current authority without renewing their state", () => {
    const prepare = sql.split("$prepare$")[1];
    const lookup = prepare.indexOf("where actor_id=auth.uid() and request_id=p_request_id;");
    const gate = prepare.indexOf("v_record := public.lock_managed_trash_recording_v1(p_recording_id)");
    expect(lookup).toBeGreaterThan(-1);
    expect(lookup).toBeLessThan(gate);
    const recovery = prepare.slice(lookup, gate);
    expect(recovery).toContain("where id=v_op.recording_id for update");
    expect(recovery).toContain("actor_id=auth.uid() and request_id=p_request_id for update");
    expect(recovery).toContain("return jsonb_build_object('operationId',v_op.id,'phase',v_op.phase)");
    expect(recovery).not.toMatch(/update public\.|insert into|work_attempt_count\s*:=/);
  });
});
