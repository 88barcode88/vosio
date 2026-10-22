// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineContent } from "@/components/transcript-tabs/timeline-content";
import type { ManualAiJobSummary } from "@/lib/ai/manual-job-state";
import { RecordingCapabilityProvider } from "@/components/recording-capability-context";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";

const run = vi.fn();
vi.mock("@/components/delete-ai-output-form", () => ({ DeleteAiOutputForm: ({ outputId }: { outputId: string }) => <button data-output-id={outputId}>Smazat výstup</button> }));
const processingState: { message: string | null; running: boolean } = {
  message: null,
  running: false
};

vi.mock("@/components/transcript-tabs/use-ai-processing-run", () => ({
  useAiProcessingRun: () => ({
    activeRuns: [],
    isRunning: () => processingState.running,
    message: processingState.message,
    run
  })
}));

const transcript = {
  created_at: "2026-08-13T10:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
  language: "cs",
  raw_text: "Hotový přepis",
  recording_id: "22222222-2222-4222-8222-222222222222",
  segments: [],
  speakers: [],
  transcription_job_id: null,
  user_id: "33333333-3333-4333-8333-333333333333"
};

const marker = {
  client_marker_id: "44444444-4444-4444-8444-444444444444",
  created_at: "2026-08-13T10:02:00.000Z",
  id: "55555555-5555-4555-8555-555555555555",
  marker_type: "important" as const,
  note: "Důležitý bod",
  offset_ms: 120000,
  recording_id: transcript.recording_id,
  updated_at: "2026-08-13T10:02:00.000Z",
  user_id: transcript.user_id
};

// timelineJob represents a persisted job returned by the transcript-scoped shared state.
function timelineJob(status: ManualAiJobSummary["status"]): ManualAiJobSummary {
  return { attempt_count: 1, completed_at: null, created_at: new Date().toISOString(), failure_code: null,
    id: "timeline-job", lease_expires_at: null, max_attempts: 1, model: "gpt-6.1-sol", processing_type: "timeline_chapters",
    retry_after_at: null, started_at: status === "running" ? new Date().toISOString() : null, status };
}

describe("TimelineContent direct generation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    run.mockReset().mockResolvedValue(true);
    processingState.message = null;
    processingState.running = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each(["queued", "running"] as const)("restores server %s state on opening and remount without submitting", async (status) => {
    const props = { activeTranscript: transcript, aiOutputs: [], defaultAiModel: "gpt-6.1-sol", jobs: [timelineJob(status)],
      classifications: [{ job_id: "timeline-job", poll_eligible: true, actions: [], cleanup_reason: "active_or_slow" as const }],
      markers: [marker], onOpenMarker: vi.fn(), structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] } };
    await act(async () => root.render(<TimelineContent {...props} />));
    expect(container.textContent).toContain("Časová osa se připravuje");
    expect(container.textContent).toContain("zpracovává na serveru");
    expect(container.textContent).not.toContain("Vytvořte obsahovou časovou osu");
    expect(container.querySelector<HTMLButtonElement>(".secondary-inline-action")?.disabled).toBe(true);
    await act(async () => root.render(null));
    await act(async () => root.render(<TimelineContent {...props} />));
    expect(container.textContent).toContain("zpracovává na serveru");
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["queued", "running"] as const)("routes stale %s jobs to existing AI recovery without submitting", async (status) => {
    const onOpenAi = vi.fn();
    const expired = new Date(Date.now() - 600_000).toISOString();
    const job = { ...timelineJob(status), created_at: expired, started_at: status === "running" ? expired : null,
      lease_expires_at: status === "running" ? new Date(Date.now() - 1_000).toISOString() : null };
    const props = { activeTranscript: transcript, aiOutputs: [], defaultAiModel: "gpt-6.1-sol", jobs: [job], onOpenAi,
      classifications: [{ job_id: job.id, poll_eligible: false, actions: ["reconcile" as const], cleanup_reason: "eligible_stale_unclaimed" as const }],
      markers: [marker], onOpenMarker: vi.fn(), structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] } };
    await act(async () => root.render(<TimelineContent {...props} />));
    expect(container.textContent).not.toContain("zpracovává na serveru");
    expect(container.textContent).toContain("vyžaduje kontrolu");
    const recovery = container.querySelector<HTMLButtonElement>(".secondary-inline-action")!;
    expect(recovery.textContent).toContain("Otevřít stav AI");
    expect(recovery.disabled).toBe(false);
    await act(async () => recovery.click());
    expect(onOpenAi).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it("uses the shared stalled helper when classification is absent", async () => {
    await act(async () => root.render(<TimelineContent activeTranscript={transcript} aiOutputs={[]} defaultAiModel="gpt-6.1-sol"
      jobs={[{ ...timelineJob("queued"), created_at: new Date(Date.now() - 600_000).toISOString() }]}
      markers={[]} onOpenMarker={vi.fn()} onOpenAi={vi.fn()} structuredItems={{ chapters: [], tasks: [], decisions: [], risks: [] }} />));
    expect(container.textContent).toContain("vyžaduje kontrolu");
    expect(container.textContent).not.toContain("zpracovává na serveru");
    expect(run).not.toHaveBeenCalled();
  });

  it("respects server non-pollable classification even before the display age limit", async () => {
    const job = { ...timelineJob("running"), lease_expires_at: new Date(Date.now() - 1_000).toISOString() };
    await act(async () => root.render(<TimelineContent activeTranscript={transcript} aiOutputs={[]} defaultAiModel="gpt-6.1-sol"
      jobs={[job]} classifications={[{ job_id: job.id, poll_eligible: false, actions: ["reconcile"], cleanup_reason: "eligible_stale_unclaimed" }]}
      markers={[]} onOpenMarker={vi.fn()} onOpenAi={vi.fn()} structuredItems={{ chapters: [], tasks: [], decisions: [], risks: [] }} />));
    expect(container.textContent).toContain("vyžaduje kontrolu");
    expect(container.textContent).not.toContain("zpracovává na serveru");
  });

  it("reflects terminal failure and resets persisted state for another transcript without submitting", async () => {
    const props = { activeTranscript: transcript, aiOutputs: [], defaultAiModel: "gpt-6.1-sol",
      markers: [], onOpenMarker: vi.fn(), structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] } };
    await act(async () => root.render(<TimelineContent {...props} jobs={[timelineJob("running")]} />));
    await act(async () => root.render(<TimelineContent {...props} jobs={[timelineJob("failed")]} />));
    expect(container.textContent).toContain("AI zpracování selhalo");
    expect(container.textContent).not.toContain("zpracovává na serveru");
    await act(async () => root.render(<TimelineContent {...props} activeTranscript={{ ...transcript, id: "other-transcript" }} jobs={[]} />));
    expect(container.textContent).not.toContain("AI zpracování selhalo");
    expect(run).not.toHaveBeenCalled();
  });

  it("preserves historical chapters while shared jobs run, stall and complete", async () => {
    const onOpenAi = vi.fn();
    const props = { activeTranscript: transcript, aiOutputs: [], defaultAiModel: "gpt-6.1-sol", markers: [marker], onOpenMarker: vi.fn(), onOpenAi,
      structuredItems: { chapters: [{ id: "chapter", title: "Uložená kapitola", start_time: "00:00", end_time: "00:01", summary: "Obsah", position: 1,
        ai_output_id: "output", processing_job_id: "old-job", transcript_id: transcript.id, user_id: transcript.user_id,
        confidence: null, dominant_roles: [], raw_item: {}, source_type: "explicit" as const, speakers: [], topics: [] }], tasks: [], decisions: [], risks: [] } };
    await act(async () => root.render(<TimelineContent {...props} jobs={[timelineJob("running")]} />));
    const chapter = container.querySelector(".timeline-chapter");
    expect(container.textContent).toContain("zpracovává na serveru");
    await act(async () => root.render(<TimelineContent {...props} jobs={[{ ...timelineJob("running"), started_at: new Date(Date.now() - 600_000).toISOString() }]} />));
    expect(container.querySelector(".timeline-chapter")).toBe(chapter);
    expect(container.textContent).toContain("vyžaduje kontrolu");
    await act(async () => container.querySelector<HTMLButtonElement>(".ai-state button")!.click());
    expect(onOpenAi).toHaveBeenCalledOnce();
    await act(async () => root.render(<TimelineContent {...props} jobs={[timelineJob("done")]} />));
    expect(container.querySelector(".timeline-chapter")).toBe(chapter);
    expect(container.textContent).toContain("Uložená kapitola");
    expect(container.textContent).toContain("je dokončené");
    expect(container.textContent).toContain("Důležitý bod");
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps cached chapters mounted on background failure and offers a read retry", async () => {
    const reload = vi.fn();
    const props = { activeTranscript: transcript, aiOutputs: [], defaultAiModel: "gpt-6.1-sol", markers: [], onOpenMarker: vi.fn(), onReload: reload,
      structuredItems: { chapters: [{ id: "chapter", title: "Uložená kapitola", start_time: "00:00", end_time: "00:01", summary: "Obsah", position: 1,
        ai_output_id: "output", processing_job_id: "job", transcript_id: transcript.id, user_id: transcript.user_id,
        confidence: null, dominant_roles: [], raw_item: {}, source_type: "explicit" as const, speakers: [], topics: [] }], tasks: [], decisions: [], risks: [] } };
    await act(async () => root.render(<TimelineContent {...props} />));
    const chapter = container.querySelector(".timeline-chapter");
    await act(async () => root.render(<TimelineContent {...props} stateError="Stav se nepodařilo načíst." />));
    expect(container.querySelector(".timeline-chapter")).toBe(chapter);
    expect(container.textContent).toContain("Uložená kapitola");
    await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')?.click());
    expect(reload).toHaveBeenCalledOnce();
  });

  it("starts timeline_chapters with the default model in the current tab", async () => {
    await act(async () => root.render(
      <RecordingCapabilityProvider capabilities={{ ...NO_RECORDING_CAPABILITIES, read: true, runPersonalAi: true }}><TimelineContent
        activeTranscript={transcript}
        aiOutputs={[]}
        defaultAiModel="gpt-5.6-terra"
        markers={[]}
        onOpenMarker={vi.fn()}
        structuredItems={{ chapters: [], decisions: [], risks: [], tasks: [] }}
      /></RecordingCapabilityProvider>
    ));

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Vytvořit časovou osu")
    );
    await act(async () => button?.click());

    expect(run).toHaveBeenCalledWith({
      model: "gpt-5.6-terra",
      processingType: "timeline_chapters"
    });
    expect(container.textContent).not.toContain("Otevřít AI zpracování");
  });

  it("keeps saved markers visible while generation is pending and after failure", async () => {
    processingState.running = true;
    processingState.message = "AI generuje výstup…";
    await act(async () => root.render(
      <TimelineContent
        activeTranscript={transcript}
        aiOutputs={[]}
        defaultAiModel="gpt-5.6-terra"
        markers={[marker]}
        onOpenMarker={vi.fn()}
        structuredItems={{ chapters: [], decisions: [], risks: [], tasks: [] }}
      />
    ));

    expect(container.textContent).toContain("Označené momenty");
    expect(container.textContent).toContain("Důležitý bod");
    expect(container.textContent).toContain("AI generuje výstup…");
    expect(Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Vytvářím časovou osu")
    )?.disabled).toBe(true);
    const pendingButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Vytvářím časovou osu")
    );
    await act(async () => {
      pendingButton?.click();
      pendingButton?.click();
    });
    expect(run).not.toHaveBeenCalled();

    processingState.running = false;
    processingState.message = "AI zpracování selhalo.";
    await act(async () => root.render(
      <TimelineContent
        activeTranscript={transcript}
        aiOutputs={[]}
        defaultAiModel="gpt-5.6-terra"
        markers={[marker]}
        onOpenMarker={vi.fn()}
        structuredItems={{ chapters: [], decisions: [], risks: [], tasks: [] }}
      />
    ));

    expect(container.textContent).toContain("Označené momenty");
    expect(container.textContent).toContain("Důležitý bod");
    expect(container.textContent).toContain("AI zpracování selhalo.");
  });
});
