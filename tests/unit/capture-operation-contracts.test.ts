import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260923010000_add_capture_operation_contracts.sql";
const sql = existsSync(path) ? readFileSync(path, "utf8") : "";

describe("capture/provider operation SQL source contracts (not runtime proof)", () => {
  it("implements whitelisted atomic capture transitions with revisions and request receipts", () => {
    expect(sql).toContain("apply_recording_capture_transition_v1");
    expect(sql).toContain("capture_revision");
    expect(sql).toContain("p_expected_capture_revision");
    expect(sql).toContain("recording_capture_receipts");
    for (const transition of ["upload_complete", "capture_failed", "text_only", "live_draft", "live_final", "import_final", "recover"]) {
      expect(sql).toContain(`'${transition}'`);
    }
  });

  it("keeps irreversible async continuation distinct from realtime browser capture", () => {
    expect(sql).toContain("prepare_recording_transcription_v1");
    expect(sql).toContain("start_recording_transcription_v1");
    expect(sql).toContain("accept_recording_provider_job_v1");
    expect(sql).toContain("finalize_recording_transcription_v1");
    expect(sql).toContain("'uncertain'");
    expect(sql).toContain("client_reference_id");
    expect(sql).not.toContain("perform public.complete_transcript_generation_v1");
    expect(sql).not.toMatch(/delete from public\.(ai_processing_jobs|ai_outputs|automatic_timeline_intents)/i);
  });

  it("uses exact receipt work fencing and blocks destructive cleanup of irreversible work", () => {
    expect(sql).toContain("claim_recording_transcription_work_v1");
    expect(sql).toContain("p_claim_id");
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain("guard_recording_transcription_delete_v1");
    expect(sql).toContain("resolve_uncertain_recording_job_v1");
    expect(sql).toContain("p_evidence_sha256");
  });

  it("pins trusted definers and keeps internal receipts and capabilities inaccessible directly", () => {
    expect(sql).toContain("force row level security");
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).toContain("owner to %I");
    expect(sql).toContain("security definer set search_path = ''");
    expect(sql).toContain("revoke execute on function public.accept_recording_job_custody_v1");
    expect(sql).not.toMatch(/grant\s+(select|all|update|insert).*on.*to authenticated/i);
  });

  it("rechecks accepted provider custody and refuses partial or oversized recovery manifests", () => {
    expect(sql).toContain("left join public.recording_job_custody c on c.job_id=w.job_id");
    expect(sql).toContain("c.provider_job_id is distinct from w.provider_job_id");
    expect(sql).toContain("c.capture_author is distinct from v_op.capture_author_id");
    expect(sql).toContain("v_invalid_audio");
    expect(sql).toContain("v_count>1000");
    expect(sql).toContain("recording_transcription_operations_recording_idx");
  });

  it("preserves response-loss recovery, current realtime authority, and irreversible async fencing", () => {
    const prepare = sql.split("as $prepare$")[1]?.split("$prepare$;")[0] ?? "";
    expect(prepare.indexOf("actor_id=auth.uid() and request_id=p_request_id")).toBeLessThan(prepare.indexOf("v_record:=public.lock_recording_capture_v1"));
    const capture = sql.split("as $capture$")[1]?.split("$capture$;")[0] ?? "";
    expect(capture.indexOf("has_recording_capture_authority_v1")).toBeLessThan(capture.indexOf("return v_receipt.result"));
    expect(capture).toContain("insert into public.recording_capture_binding_permits");
    expect(sql).toContain("submission_claim_id is distinct from p_claim_id");
    expect(sql).toContain("w.poll_attempt_count<5");
    expect(sql).toContain("interval '7 days'");
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain("next_poll_at=clock_timestamp()+interval '15 seconds'");
    expect(sql).toContain("transcription_jobs_guard_delete");
    expect(sql).toContain("max(created_at)+interval '1 microsecond'");
  });

  it("C1 bounds serialized speakers before any transcript receipt hash", () => {
    expect(sql).toContain("octet_length(p_speakers::text)>33554432");
    expect(sql).toContain("octet_length(p_raw_text)>4000000");
  });

  it("C2 permits only an active DB-approved versioned async model", () => {
    expect(sql).toContain("create table public.recording_transcription_models_v1");
    expect(sql).toContain("'stt-async-v5'");
    expect(sql).toContain("model_config_version");
    expect(sql).toContain("model=p_model and active");
  });

  it("C3 rotates operation selection fairly between eligible manifests", () => {
    expect(sql).toContain("order by o.last_claimed_at nulls first,o.created_at,o.id limit p_limit");
    expect(sql).toContain("set last_claimed_at=clock_timestamp()");
  });

  it("C4 never updates the exact job being deleted by its BEFORE trigger", () => {
    expect(sql).toContain("v_deleting_job:=old.id");
    expect(sql).toContain("w.job_id is distinct from v_deleting_job");
  });

  it("C5 validates the bounded complete live prefix before constructing work", () => {
    expect(sql).toContain("get_recording_live_manifest_v1");
    expect(sql).toContain("invalid live manifest member");
    expect(sql).toContain("cardinality(v_paths)>1000");
    expect(sql.match(/:=public\.get_recording_live_manifest_v1/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("C6 consumes submission and poll claims when an observation is accepted", () => {
    const accept = sql.split("as $accept$")[1]?.split("$accept$;")[0] ?? "";
    const settle = sql.split("as $settle$")[1]?.split("$settle$;")[0] ?? "";
    expect(accept).toContain("claim_id=null,claimed_at=null");
    expect(settle).toContain("claim_id=null,claimed_at=null");
    expect(settle).not.toContain("if v_work.phase in ('done','failed') then");
  });

  it("recovers created durable drafts without widening other capture transitions", () => {
    const capture = sql.split("as $capture$")[1]?.split("$capture$;")[0] ?? "";
    expect(capture).toContain("p_transition='recover' and v_record.status not in ('created','uploading','failed','transcribing')");
    expect(capture).toContain("p_transition in ('live_final','import_final') and v_record.status not in ('created','uploading','uploaded','failed')");
    expect(capture).toContain("if not v_has_text then raise exception 'nothing to recover'");
    expect(capture).toContain("unexpected transcript payload");
    expect(capture).toContain("capture_revision<>p_expected_capture_revision");
  });
});
