import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const snapshot = readFileSync("supabase/migrations/20261002010000_capture_personal_intents_and_contacts.sql", "utf8");
describe("capture automatic timeline authorization boundary", () => {
  it("stores a bounded immutable completion snapshot privately without jobs or providers", () => {
    expect(snapshot).toContain("force row level security");
    expect(snapshot).toContain("revoke all on table public.capture_timeline_snapshots");
    expect(snapshot).toContain("on conflict(transcript_id) do nothing");
    expect(snapshot).toContain("gpt-5.6-sol");
    expect(snapshot).not.toContain("insert into public.automatic_timeline_jobs");
    expect(snapshot).not.toContain("delete from");
  });
  it("creates an intent only from stored snapshot after current personal owner/read/manage and consent", () => {
    const schedule = snapshot.slice(snapshot.indexOf("create function public.schedule_capture_timeline_intent_v1"), snapshot.indexOf("-- Return only contacts"));
    expect(schedule).toContain("r.user_id=auth.uid()");
    expect(schedule).toContain("public.can_read_recording(v_recording)");
    expect(schedule).toContain("public.can_manage_recording(v_recording)");
    expect(schedule).toContain("from public.capture_timeline_snapshots");
    expect(schedule).not.toContain("p_model");
    expect(schedule).not.toContain("p_provider_config");
  });
  it.each(["app/api/recordings/[recordingId]/transcription/route.ts","app/api/recordings/import-transcript/route.ts","src/lib/recordings/capture-route.server.ts","src/lib/recordings/transcription-worker.server.ts"])("capture completion %s never starts personal AI or destructive legacy completion", (path) => {
    const source = readFileSync(path,"utf8");
    expect(source).not.toContain("persistTranscriptCompletionTransition");
    expect(source).not.toContain("reconcileAutomaticTimeline");
    expect(source).not.toContain("complete_transcript_generation_v1");
  });
});
