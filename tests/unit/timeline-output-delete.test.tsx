// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TimelineContent } from "@/components/transcript-tabs/timeline-content";
import { RecordingCapabilityProvider } from "@/components/recording-capability-context";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";
import type { ManualAiOutputMetadata } from "@/lib/ai/manual-job-state";
import type { TranscriptRow } from "@/lib/transcripts/types";

const deleted = vi.hoisted(() => vi.fn(async (form: FormData) => ({ removed_output_ids: form.getAll("outputIds") as string[] })));
vi.mock("@/lib/ai/actions", () => ({ deleteAiOutputAction: deleted }));
vi.mock("next/navigation", () => ({ usePathname: () => "/recordings/fixture" }));
vi.mock("@/components/transcript-tabs/use-ai-processing-run", () => ({ useAiProcessingRun: () => ({ isRunning: () => false, run: vi.fn() }) }));
const transcript = { id: "00000000-0000-4000-8000-000000000001" } as TranscriptRow;
const outputs: ManualAiOutputMetadata[] = [2, 3].map((index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`,
  processing_job_id: `job-${index}`, transcript_id: transcript.id, processing_type: "timeline_chapters", created_at: "2026-10-03", body_loaded: false }));

// TimelineDeleteFixture applies exact quiet removal while retaining the timeline tab and older generation.
function TimelineDeleteFixture() {
  const [metadata, setMetadata] = useState(outputs);
  return <RecordingCapabilityProvider capabilities={{ ...NO_RECORDING_CAPABILITIES, read: true, delete: true }}>
    <TimelineContent activeTranscript={transcript} aiOutputs={[]} defaultAiModel="gpt-6.1-sol" markers={[]}
      outputMetadata={metadata} onOutputsRemoved={(ids) => setMetadata((previous) => previous.filter((item) => !ids.includes(item.id)))}
      onOpenMarker={vi.fn()} structuredItems={{ tasks: [], chapters: [], decisions: [], risks: [] }} />
  </RecordingCapabilityProvider>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); deleted.mockClear(); });
it("can delete two timeline generations consecutively without remounting the tab or loading their bodies", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<TimelineDeleteFixture />));
    const timeline = container.querySelector(".timeline-list");
    await act(async () => container.querySelector<HTMLButtonElement>('.ai-output-delete-form button')!.click());
    expect(container.querySelector('input[name="outputIds"]')?.getAttribute("value")).toBe(outputs[1]!.id);
    const nextButton = container.querySelector<HTMLButtonElement>('.ai-output-delete-form button')!;
    expect(nextButton.disabled).toBe(false);
    await act(async () => nextButton.click());
    expect(deleted).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".timeline-list")).toBe(timeline);
    expect(container.querySelector(".ai-output-delete-form")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
