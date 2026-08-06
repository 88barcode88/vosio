// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptTabs } from "@/components/transcript-tabs";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { RecordingMarkerRow, RecordingMarkerType } from "@/lib/recording-markers/types";
import type { RecordingClientView } from "@/lib/recordings/client-view";
import { defaultUserSettings } from "@/lib/settings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

const audioPlayerMocks = vi.hoisted(() => ({
  seekToMs: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/components/transcript-tabs/recording-audio-player", async () => {
  const React = await import("react");
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
  usePathname: () => "/recordings/marker-test",
  useRouter: () => ({ refresh: vi.fn() })
}));

vi.mock("@/lib/transcripts/actions", () => ({
  updateTranscriptSpeakerAction: vi.fn(async () => undefined)
}));

const recordingId = "00000000-0000-4000-8000-000000000202";
const transcriptId = "00000000-0000-4000-8000-000000000201";
const userId = "00000000-0000-4000-8000-000000000203";

let container: HTMLDivElement | null;
let root: Root | null;

// createMarker builds one fully typed persisted marker for timeline navigation tests.
function createMarker({
  id,
  markerType = "important",
  note,
  offsetMs,
  markerRecordingId = recordingId
}: {
  id: string;
  markerType?: RecordingMarkerType;
  note: string | null;
  offsetMs: number;
  markerRecordingId?: string;
}): RecordingMarkerRow {
  return {
    client_marker_id: `client-${id}`,
    created_at: "2026-08-05T10:00:00.000Z",
    id,
    marker_type: markerType,
    note,
    offset_ms: offsetMs,
    recording_id: markerRecordingId,
    updated_at: "2026-08-05T10:00:00.000Z",
    user_id: userId
  };
}

// createTranscript exposes two independently highlightable speaker blocks.
function createTranscript(): TranscriptRow {
  return {
    created_at: "2026-08-05T10:00:00.000Z",
    id: transcriptId,
    language: "cs",
    raw_text: "První blok. Druhý blok.",
    recording_id: recordingId,
    segments: [
      { end_ms: 2_000, speaker: 1, start_ms: 0, text: "První blok." },
      { end_ms: 5_000, speaker: 2, start_ms: 3_000, text: "Druhý blok." }
    ],
    speakers: [],
    transcription_job_id: null,
    user_id: userId
  };
}

// createRecording builds one recording with the requested audio availability contract.
function createRecording(
  audioAvailability: RecordingClientView["audioAvailability"]
): RecordingClientView {
  return {
    audioAvailability,
    created_at: "2026-08-05T10:00:00.000Z",
    duration_seconds: 60,
    file_size_bytes: 1_024,
    id: recordingId,
    mime_type: "audio/webm",
    source_type: "upload",
    status: "completed",
    title: "Marker call",
    updated_at: "2026-08-05T10:01:00.000Z"
  };
}

// createStructuredItems provides one chapter so marker ordering can be compared with AI content.
function createStructuredItems(): StructuredAiItems {
  return {
    chapters: [{
      ai_output_id: "output-1",
      confidence: "high",
      dominant_roles: [],
      end_time: "00:10",
      position: 1,
      processing_job_id: "job-1",
      raw_item: {},
      source_type: "explicit",
      speakers: [],
      start_time: "00:00",
      summary: "AI kapitola",
      title: "Kapitola",
      topics: [],
      transcript_id: transcriptId,
      user_id: userId
    }],
    decisions: [],
    risks: [],
    tasks: []
  };
}

// renderTimeline mounts the real marker-to-transcript navigation surface.
async function renderTimeline({
  activeTranscript = createTranscript(),
  audioAvailability = "single",
  markers
}: {
  activeTranscript?: TranscriptRow | null;
  audioAvailability?: RecordingClientView["audioAvailability"];
  markers: RecordingMarkerRow[];
}) {
  await act(async () => root?.render(createElement(TranscriptTabs, {
    activeAiOutputs: [],
    activeRecording: createRecording(audioAvailability),
    activeRecordingMarkers: markers,
    activeStructuredItems: createStructuredItems(),
    activeTranscript,
    initialTab: "timeline",
    initialTabFromCookie: true,
    userSettings: defaultUserSettings
  })));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
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

describe("recording marker navigation", () => {
  it("orders markers before AI chapters and opens the nearest block with one audio play", async () => {
    await renderTimeline({
      markers: [
        createMarker({ id: "marker-b", markerType: "task", note: "Později", offsetMs: 8_000 }),
        createMarker({ id: "marker-a", note: "Druhý blok", offsetMs: 3_500 })
      ]
    });

    const text = container?.textContent ?? "";
    expect(text.indexOf("Označené momenty")).toBeLessThan(text.indexOf("Obsahová časová osa"));
    const markerButtons = Array.from(container?.querySelectorAll<HTMLButtonElement>(
      ".timeline-marker-row"
    ) ?? []);
    expect(markerButtons.map((button) => button.querySelector("time")?.textContent))
      .toEqual(["00:03", "00:08"]);

    await act(async () => markerButtons[0]?.click());

    expect(container?.querySelector('[role="tabpanel"]')?.id).toBe("recording-tab-panel-transcript");
    expect(container?.querySelector("#transcript-at-3000")?.getAttribute("aria-current")).toBe("true");
    expect(audioPlayerMocks.seekToMs).toHaveBeenCalledOnce();
    expect(audioPlayerMocks.seekToMs).toHaveBeenCalledWith(3_500, { play: true });
  });

  it.each(["none", "segmented"] as const)(
    "opens and highlights %s transcript markers without audio playback",
    async (audioAvailability) => {
      await renderTimeline({
        audioAvailability,
        markers: [createMarker({ id: "marker-a", note: "Druhý blok", offsetMs: 3_500 })]
      });

      await act(async () => container?.querySelector<HTMLButtonElement>(".timeline-marker-row")?.click());

      expect(container?.querySelector("#transcript-at-3000")?.getAttribute("aria-current")).toBe("true");
      expect(audioPlayerMocks.seekToMs).not.toHaveBeenCalled();
    }
  );

  it("disables marker actions without a transcript and rejects cross-recording targets", async () => {
    const marker = createMarker({ id: "marker-a", note: null, offsetMs: 3_500 });
    await renderTimeline({ activeTranscript: null, markers: [marker] });

    expect(container?.querySelector<HTMLButtonElement>(".timeline-marker-row")?.disabled).toBe(true);
    expect(container?.textContent).toContain("Přepis není dostupný");
    expect(audioPlayerMocks.seekToMs).not.toHaveBeenCalled();

    await renderTimeline({
      markers: [{ ...marker, recording_id: "00000000-0000-4000-8000-000000000299" }]
    });
    await act(async () => container?.querySelector<HTMLButtonElement>(".timeline-marker-row")?.click());

    expect(container?.querySelector('[role="tabpanel"]')?.id).toBe("recording-tab-panel-timeline");
    expect(audioPlayerMocks.seekToMs).not.toHaveBeenCalled();
  });
});
