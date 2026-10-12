import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync("supabase/migrations/20261002060000_integrate_dev_capture_features.sql", "utf8");
describe("current-dev capture compatibility SQL source, not runtime DB proof", () => {
  it("parenthesizes the IF temperature CASE while preserving numeric range admission", () => {
    expect(sql).toContain("if v_settings ? 'aiTemperature' and not (case when jsonb_typeof(v_settings->'aiTemperature')='number'\n    then (v_settings->>'aiTemperature')::numeric between 0 and 2 else false end) then return new; end if;");
    expect(sql).not.toMatch(/\bif[^;]*\bnot\s+case\b/i);
  });

  it("requires trusted ownership and retains private immutable snapshots for all six types", () => {
    expect(sql).toContain("r.rolsuper or r.rolbypassrls");
    for (const type of ["summary", "action_items", "meeting_minutes", "crm_note", "follow_up_email", "timeline_chapters"]) expect(sql).toContain(`'${type}'`);
    expect(sql).toContain("on conflict(transcript_id) do nothing");
    expect(sql).toContain("v_snapshot->>'completion_generation_key' is distinct from v_transcript.completion_generation_key");
    expect(sql).not.toMatch(/delete from public\.(ai_processing_jobs|ai_outputs|automatic_timeline_intents)/i);
    const trigger = sql.split("$snapshot$;")[0]!;
    expect(trigger).not.toContain("insert into public.ai_processing_jobs");
    expect(trigger).not.toContain("insert into public.automatic_timeline_intents");
  });
  it("consumes stored prompt/config only under current personal authority and opt-in", () => {
    expect(sql).toContain("not public.can_manage_recording(v_record.id)");
    expect(sql).toContain("v_record.user_id<>auth.uid()");
    expect(sql).toContain("v_output->'provider_config'");
    expect(sql).toContain("ai_processing_jobs_guard_personal_admission before insert");
    expect(sql).toContain("p.user_id=new.user_id");
  });
  it("binds bounded immutable deterministic parts rather than broad prefixes or arbitrary MIME", () => {
    expect(sql).toContain("p_part_index not between 0 and 999");
    expect(sql).toContain("least(coalesce(v_limit,5368709120),5368709120)");
    expect(sql).toContain("lpad(p_part_index::text,6,'0')");
    expect(sql).toContain("v_part.mime_type<>p_mime_type or v_part.file_size_bytes<>p_file_size_bytes");
    expect(sql).toContain("p.capture_request_id=r.capture_request_id");
    expect(sql).toContain("public.can_write_recording_capture_v1(v_id)");
    expect(sql).toContain("s.metadata->>'mimetype'=p.mime_type");
    expect(sql).toContain("p.part_index>=v_count");
    expect(sql).toContain("metadata->>'size' ~ '^[1-9][0-9]*$'");
  });
  it("rejects null CAS, holds reservations and permits only complete absent-main fallback", () => {
    expect(sql.match(/p_expected_capture_revision is null or p_expected_capture_revision<0/g)?.length).toBe(3);
    expect(sql).toContain("v_record.status in ('created','failed')");
    expect(sql).toContain("perform public.assert_live_capture_idle_v1(v_record.id)");
    expect(sql).toContain("phase in ('prepared','started','accepted','uncertain')");
    expect(sql).toContain("status in ('queued','running')");
    expect(sql).toContain("transition='parts_fallback' returning recording_id into v_permitted");
    expect(sql).toContain("not exists(select 1 from storage.objects where bucket_id='recordings' and name=old.storage_path)");
    expect(sql).toContain("perform public.get_registered_live_parts_manifest_v1(v_record.id)");
  });
  it("locks exact actor management before legacy destructive job locks without changing accepted continuation", () => {
    const repair = readFileSync("supabase/migrations/20261002070000_guard_manual_ai_destructive_admission.sql", "utf8");
    expect(repair.match(/perform public.assert_current_personal_ai_manager_v1\(p_transcript_id,p_user_id\)/g)?.length).toBe(2);
    expect(repair).toContain("v_record:=public.lock_recording_capture_v1(v_id)");
    expect(repair).toContain("v_record.user_id is distinct from p_actor_id");
    expect(repair).toContain("p.user_id=p_actor_id");
    expect(repair).not.toMatch(/create (?:or replace )?function public\.(?:claim|settle|publish|enqueue)/);
    expect(repair).toContain("to service_role");
    expect(repair).not.toContain("to authenticated");
  });
  it("denies manifest traversal/mixed sequences and preserves recovery receipt indexing", () => {
    expect(sql).toContain("'^part-[0-9]{6}\\.(webm|m4a)$'");
    expect(sql).toContain("count(distinct substring(name");
    expect(sql).toContain("'transcriptId',v_transcript");
    expect(sql).toContain("completion_generation_key=coalesce(completion_generation_key");
    expect(sql).not.toMatch(/^\/\//m);
  });
});
