import { afterEach, expect, it, vi } from "vitest";
import { createCaptureAttempt } from "@/lib/recordings/capture";
import { sendLiveCapture } from "@/lib/recordings/live-capture-client";
import { completeLiveRecordingUpload, completeLiveRecordingWithoutAudio } from "@/lib/recordings/upload";
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ rpc: m.rpc }) }));
const id = "00000000-0000-4000-8000-000000000001";
afterEach(() => vi.unstubAllGlobals());

it.each(["audio", "text"] as const)("waits for a delayed autosave before %s stop completion reads its CAS revision", async (mode) => {
  let revision = 0;
  let finishDraft!: () => void;
  const delayed = new Promise<void>((resolve) => { finishDraft = resolve; });
  const fetch = vi.fn(async () => { await delayed; revision = 1; return new Response(JSON.stringify({ recordingId: id, captureRevision: 1, status: "uploading", transcriptId: id, jobId: null, warnings: ["transcript_search_index_incomplete"] })); });
  vi.stubGlobal("fetch", fetch);
  m.rpc.mockReset().mockImplementation(async (name, args) => {
    if (name === "get_recording_capture_state_v1") return { data: { recordingId: id, captureRevision: revision, status: "uploading" }, error: null };
    expect(args.p_expected_capture_revision).toBe(1);
    return { data: { recordingId: id, captureRevision: 2, status: "uploaded", transcriptId: id, jobId: null }, error: null };
  });
  const recording = { id, userId: id, storagePrefix: id, capture: createCaptureAttempt() };
  const draft = sendLiveCapture(recording, "live_draft", { rawText: "retained", segments: [] });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const stop = mode === "audio" ? completeLiveRecordingUpload({ recording, storagePath: "audio", contentType: "audio/webm", totalBytes: 10, durationSeconds: 1 }) : completeLiveRecordingWithoutAudio({ recording, durationSeconds: 1 });
  await Promise.resolve();
  expect(m.rpc).toHaveBeenCalledTimes(1);
  finishDraft();
  expect((await draft).warnings).toEqual(["transcript_search_index_incomplete"]);
  await stop;
  expect(recording.capture.captureRevision).toBe(2);
});
