// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptTabs } from "@/components/transcript-tabs";
import type {
  StructuredAiItems,
  StructuredDecisionRow,
  StructuredRiskRow,
  StructuredTaskRow
} from "@/lib/ai/structured-types";
import type { RecordingClientView } from "@/lib/recordings/client-view";
import { defaultUserSettings } from "@/lib/settings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

const audioPlayerMocks = vi.hoisted(() => ({
  seekToMs: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/components/transcript-tabs/recording-audio-player", async () => {
  const React = await import("react");

  // MockRecordingAudioPlayer exposes the production imperative contract without loading media.
  const MockRecordingAudioPlayer = React.forwardRef(function MockRecordingAudioPlayer(
    props: { activeRecording: RecordingClientView | null },
    ref
  ) {
    React.useImperativeHandle(ref, () => ({ seekToMs: audioPlayerMocks.seekToMs }));
    return props.activeRecording?.audioAvailability === "single"
      ? React.createElement("div", { "data-testid": "recording-audio-player" })
      : null;
  });

  return { RecordingAudioPlayer: MockRecordingAudioPlayer };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/recordings/evidence",
  useRouter: () => ({ refresh: vi.fn() })
}));

vi.mock("@/lib/transcripts/actions", () => ({
  updateTranscriptSpeakerAction: vi.fn(async () => undefined)
}));

let container: HTMLDivElement | null;
let root: Root | null;

// createTranscript provides one speaker block containing all three evidence quotes.
function createTranscript(): TranscriptRow {
  return {
    created_at: "2026-08-05T10:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    language: "cs",
    raw_text: "Ukol dukaz. Rozhodnuti dukaz. Riziko dukaz.",
    recording_id: "00000000-0000-4000-8000-000000000002",
    segments: [
      { end_ms: 1_500, speaker: 1, start_ms: 1_000, text: "Ukol dukaz." },
      { end_ms: 2_500, speaker: 1, start_ms: 1_600, text: " Rozhodnuti dukaz." },
      { end_ms: 3_500, speaker: 1, start_ms: 2_600, text: " Riziko dukaz." }
    ],
    speakers: [],
    transcription_job_id: null,
    user_id: "00000000-0000-4000-8000-000000000003"
  };
}

// createRecordingView builds each audio eligibility variant used by navigation tests.
function createRecordingView(audioAvailability: RecordingClientView["audioAvailability"]): RecordingClientView {
  return {
    audioAvailability,
    created_at: "2026-08-05T10:00:00.000Z",
    duration_seconds: 60,
    file_size_bytes: 1_024,
    id: "00000000-0000-4000-8000-000000000002",
    mime_type: "audio/webm",
    source_type: "upload",
    status: "completed",
    title: "Evidence call",
    updated_at: "2026-08-05T10:01:00.000Z"
  };
}

// createTask returns a legacy task row whose location must be derived at runtime.
function createTask(title: string, evidenceQuote: string): StructuredTaskRow {
  return {
    ai_output_id: "output-1",
    deadline: null,
    deadline_confidence: null,
    deadline_normalized: null,
    description: null,
    evidence_end_ms: null,
    evidence_quote: evidenceQuote,
    evidence_start_ms: null,
    owner_category: "Moje práce",
    owner_name: null,
    position: 1,
    processing_job_id: "job-1",
    raw_item: {},
    source_type: "explicit",
    status: "new",
    title,
    transcript_id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000003"
  };
}

// createDecision returns a legacy decision row with a quote but no stored range.
function createDecision(): StructuredDecisionRow {
  return {
    ai_output_id: "output-1",
    evidence_end_ms: null,
    evidence_quote: "Rozhodnuti dukaz",
    evidence_start_ms: null,
    owner_category: null,
    owner_role: null,
    position: 1,
    processing_job_id: "job-1",
    raw_item: {},
    source_type: "explicit",
    status: "decided",
    title: "Rozhodnuti",
    transcript_id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000003"
  };
}

// createRisk returns a legacy risk row, optionally without the quote required for fallback.
function createRisk(evidenceQuote: string | null, position = 1): StructuredRiskRow {
  return {
    ai_output_id: "output-1",
    evidence_end_ms: null,
    evidence_quote: evidenceQuote,
    evidence_start_ms: null,
    impact: null,
    mitigation: null,
    owner_category: null,
    owner_role: null,
    position,
    processing_job_id: "job-1",
    raw_item: {},
    source_type: "explicit",
    title: evidenceQuote ? "Riziko" : "Riziko bez dukazu",
    transcript_id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000003"
  };
}

// createLegacyItems covers task, decision and risk fallback plus unmatched and quote-less rows.
function createLegacyItems(): StructuredAiItems {
  return {
    chapters: [],
    decisions: [createDecision()],
    risks: [createRisk("Riziko dukaz"), createRisk(null, 2)],
    tasks: [
      createTask("Ukol", "Ukol dukaz"),
      { ...createTask("Nenalezeny ukol", "Nenalezeny dukaz"), position: 2 }
    ]
  };
}

// renderTabs mounts the actual AI-to-transcript navigation surface.
async function renderTabs(
  audioAvailability: RecordingClientView["audioAvailability"],
  items: StructuredAiItems,
  transcript = createTranscript()
) {
  await act(async () => root?.render(createElement(TranscriptTabs, {
    activeAiOutputs: [],
    activeRecording: createRecordingView(audioAvailability),
    activeStructuredItems: items,
    activeTranscript: transcript,
    initialTab: "ai",
    initialTabFromCookie: true,
    userSettings: defaultUserSettings
  })));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  window.localStorage.clear();
  audioPlayerMocks.seekToMs.mockClear();
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  container = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("structured evidence navigation", () => {
  it("derives legacy locations without mutation and opens eligible audio in the containing transcript block", async () => {
    const items = createLegacyItems();
    await renderTabs("single", items);
    const evidenceActions = Array.from(container?.querySelectorAll<HTMLButtonElement>(
      'button[data-evidence-action="true"]'
    ) ?? []);

    expect(evidenceActions).toHaveLength(3);
    expect(container?.textContent).toContain("Nenalezeny dukaz");
    expect(items.tasks[0]?.evidence_start_ms).toBeNull();
    expect(items.decisions[0]?.evidence_start_ms).toBeNull();
    expect(items.risks[0]?.evidence_start_ms).toBeNull();

    await act(async () => evidenceActions[0]?.click());

    expect(container?.querySelector('[role="tabpanel"]')?.id).toBe("recording-tab-panel-transcript");
    expect(container?.querySelector("#transcript-at-1000")?.getAttribute("aria-current")).toBe("true");
    expect(audioPlayerMocks.seekToMs).toHaveBeenCalledWith(1_000, { play: true });
  });

  it.each(["none", "segmented"] as const)(
    "keeps %s recordings scrollable and highlighted without seeking audio",
    async (audioAvailability) => {
      await renderTabs(audioAvailability, createLegacyItems());
      const action = container?.querySelector<HTMLButtonElement>('button[data-evidence-action="true"]');

      await act(async () => action?.click());

      expect(container?.querySelector('[role="tabpanel"]')?.id).toBe("recording-tab-panel-transcript");
      expect(container?.querySelector("#transcript-at-1000")?.getAttribute("aria-current")).toBe("true");
      expect(audioPlayerMocks.seekToMs).not.toHaveBeenCalled();
    }
  );

  it("falls back to the start block for cross-speaker evidence and treats an exact boundary as the new block", async () => {
    const transcript = createTranscript();
    transcript.raw_text = "Predchozi blok. Druha cast treti cast.";
    transcript.segments = [
      { end_ms: 2_000, speaker: 1, start_ms: 1_000, text: "Predchozi blok." },
      { end_ms: 3_000, speaker: 2, start_ms: 2_000, text: "Druha cast" },
      { end_ms: 4_000, speaker: 3, start_ms: 3_000, text: " treti cast." }
    ];
    const task = {
      ...createTask("Cross-speaker ukol", "Druha cast treti cast"),
      evidence_end_ms: 3_500,
      evidence_start_ms: 2_000
    };
    const items: StructuredAiItems = { chapters: [], decisions: [], risks: [], tasks: [task] };
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
      writable: true
    });
    await renderTabs("single", items, transcript);

    await act(async () => container
      ?.querySelector<HTMLButtonElement>('button[data-evidence-action="true"]')
      ?.click());

    expect(container?.querySelector("#transcript-at-1000")?.getAttribute("aria-current")).toBeNull();
    expect(container?.querySelector("#transcript-at-2000")?.getAttribute("aria-current")).toBe("true");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(audioPlayerMocks.seekToMs).toHaveBeenCalledWith(2_000, { play: true });
  });

  it("keeps exact seek navigation when no renderable speaker block can own the evidence start", async () => {
    const transcript = createTranscript();
    transcript.segments = [
      { end_ms: 6_000, speaker: null, start_ms: 5_000, text: "Dukaz bez diarizace." }
    ];
    const task = {
      ...createTask("Ukol bez speaker bloku", "Dukaz bez diarizace"),
      evidence_end_ms: 6_000,
      evidence_start_ms: 5_000
    };
    await renderTabs("single", {
      chapters: [],
      decisions: [],
      risks: [],
      tasks: [task]
    }, transcript);

    await act(async () => container
      ?.querySelector<HTMLButtonElement>('button[data-evidence-action="true"]')
      ?.click());

    expect(container?.querySelector('[role="tabpanel"]')?.id).toBe("recording-tab-panel-transcript");
    expect(container?.querySelector(".transcript-table-row-highlighted")).toBeNull();
    expect(audioPlayerMocks.seekToMs).toHaveBeenCalledWith(5_000, { play: true });
  });
});
