// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineContent } from "@/components/transcript-tabs/timeline-content";

const run = vi.fn();
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

  it("starts timeline_chapters with the default model in the current tab", async () => {
    await act(async () => root.render(
      <TimelineContent
        activeTranscript={transcript}
        aiOutputs={[]}
        defaultAiModel="gpt-5.6-terra"
        markers={[]}
        onOpenMarker={vi.fn()}
        structuredItems={{ chapters: [], decisions: [], risks: [], tasks: [] }}
      />
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
