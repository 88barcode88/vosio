// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptTabs } from "@/components/transcript-tabs";
import { TranscriptContent } from "@/components/transcript-tabs/transcript-content";
import type { TranscriptTarget } from "@/components/transcript-tabs/types";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { RecordingClientView } from "@/lib/recordings/client-view";
import { defaultUserSettings } from "@/lib/settings/types";
import { getTranscriptAnchorId } from "@/lib/transcripts/navigation";
import type { TranscriptRow } from "@/lib/transcripts/types";

const audioPlayerMocks = vi.hoisted(() => ({
  seekToMs: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/components/transcript-tabs/recording-audio-player", async () => {
  const React = await import("react");

  // MockRecordingAudioPlayer exposes the real imperative boundary without fetching audio.
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
  usePathname: () => "/recordings/test"
}));

vi.mock("@/lib/transcripts/actions", () => ({
  updateTranscriptSpeakerAction: vi.fn(async () => undefined)
}));

let container: HTMLDivElement | null;
let root: Root | null;

const emptyStructuredItems: StructuredAiItems = {
  chapters: [],
  decisions: [],
  risks: [],
  tasks: []
};

// createTranscript builds the smallest saved transcript needed by navigation rendering tests.
function createTranscript(): TranscriptRow {
  return {
    created_at: "2026-08-05T10:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    language: "cs",
    raw_text: "První blok. Bez času.",
    recording_id: "00000000-0000-4000-8000-000000000002",
    segments: [
      { end_ms: 2100, speaker: 1, start_ms: 1200, text: "První " },
      { end_ms: 4200, speaker: 1, start_ms: 2200, text: "blok." },
      { end_ms: null, speaker: 2, start_ms: null, text: "Bez času." }
    ],
    speakers: [],
    transcription_job_id: null,
    user_id: "00000000-0000-4000-8000-000000000003"
  };
}

// createTranscriptWithId preserves identical anchors while changing transcript identity for race tests.
function createTranscriptWithId(id: string) {
  return {
    ...createTranscript(),
    id
  };
}

// createRecordingView builds the safe active-recording contract used by TranscriptTabs.
function createRecordingView(
  audioAvailability: RecordingClientView["audioAvailability"] = "single"
): RecordingClientView {
  return {
    audioAvailability,
    created_at: "2026-08-05T10:00:00.000Z",
    duration_seconds: 60,
    file_size_bytes: 1024,
    id: "00000000-0000-4000-8000-000000000002",
    mime_type: "audio/webm",
    source_type: "upload",
    status: "completed",
    title: "Call",
    updated_at: "2026-08-05T10:01:00.000Z"
  };
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("transcript navigation", () => {
  it("generates timestamp anchors and deterministic index fallbacks", () => {
    expect(getTranscriptAnchorId(1200, 0)).toBe("transcript-at-1200");
    expect(getTranscriptAnchorId(1200, 1, 2)).toBe("transcript-at-1200-2");
    expect(getTranscriptAnchorId(1200, 2, 3)).toBe("transcript-at-1200-3");
    expect(getTranscriptAnchorId(0, 4)).toBe("transcript-at-0");
    expect(getTranscriptAnchorId(null, 2)).toBe("transcript-block-3");
  });

  it("defines one shared target contract for evidence, markers and search", () => {
    const target: TranscriptTarget = {
      anchorId: "transcript-at-1200",
      endMs: 4200,
      highlightText: "První blok.",
      playback: "play",
      startMs: 1200,
      transcriptId: "00000000-0000-4000-8000-000000000001"
    };

    expect(target).toMatchObject({ playback: "play", startMs: 1200 });
  });

  it("renders timed blocks as accessible targets and leaves untimed blocks inert", async () => {
    const onOpenTime = vi.fn();

    await act(async () => root?.render(createElement(TranscriptContent, {
      activeBlockAnchorId: "transcript-at-1200",
      activeRecording: null,
      activeTranscript: createTranscript(),
      onOpenTime
    })));

    const timedRow = container?.querySelector<HTMLElement>("#transcript-at-1200");
    const untimedRow = container?.querySelector<HTMLElement>("#transcript-block-2");
    const timedButton = timedRow?.querySelector<HTMLButtonElement>('button[type="button"]');

    expect(timedRow?.tabIndex).toBe(-1);
    expect(timedRow?.getAttribute("aria-current")).toBe("true");
    expect(timedRow?.classList.contains("transcript-table-row-highlighted")).toBe(true);
    expect(timedButton?.textContent).toBe("00:01");
    expect(untimedRow?.tabIndex).toBe(-1);
    expect(untimedRow?.getAttribute("aria-current")).toBeNull();
    expect(untimedRow?.querySelector('button[type="button"]')).toBeNull();

    await act(async () => timedButton?.click());
    expect(onOpenTime).toHaveBeenCalledWith(1200, "transcript-at-1200");
  });

  it("targets only the active duplicate timestamp block", async () => {
    const onOpenTime = vi.fn();
    const transcript = createTranscript();
    transcript.segments = [
      { end_ms: 1600, speaker: 1, start_ms: 1200, text: "První." },
      { end_ms: 1800, speaker: 2, start_ms: 1200, text: "Druhý." }
    ];

    await act(async () => root?.render(createElement(TranscriptContent, {
      activeBlockAnchorId: "transcript-at-1200-2",
      activeRecording: null,
      activeTranscript: transcript,
      onOpenTime
    })));

    const rows = Array.from(container?.querySelectorAll<HTMLElement>(".transcript-table-row") ?? []);
    const highlightedRows = rows.filter((row) =>
      row.classList.contains("transcript-table-row-highlighted")
    );
    const secondRowButton = rows[1]?.querySelector<HTMLButtonElement>('button[type="button"]');

    expect(rows.map((row) => row.id)).toEqual([
      "transcript-at-1200",
      "transcript-at-1200-2"
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows[0]?.getAttribute("aria-current")).toBeNull();
    expect(rows[1]?.getAttribute("aria-current")).toBe("true");
    expect(highlightedRows).toEqual([rows[1]]);

    await act(async () => secondRowButton?.click());
    expect(onOpenTime).toHaveBeenCalledWith(1200, "transcript-at-1200-2");
  });

  it("keeps the player mounted outside tab panels without background playback", async () => {
    await act(async () => root?.render(createElement(TranscriptTabs, {
      activeAiOutputs: [],
      activeRecording: createRecordingView(),
      activeStructuredItems: emptyStructuredItems,
      activeTranscript: createTranscript(),
      initialTab: "files",
      initialTabFromCookie: true,
      userSettings: defaultUserSettings
    })));

    expect(container?.querySelector('[data-testid="recording-audio-player"]')).not.toBeNull();
    expect(container?.querySelector('[role="tabpanel"]')?.id).toBe("recording-tab-panel-files");
    expect(audioPlayerMocks.seekToMs).not.toHaveBeenCalled();
  });

  it("opens a clicked transcript time with scroll, focus, highlight and direct play", async () => {
    vi.useFakeTimers();
    await act(async () => root?.render(createElement(TranscriptTabs, {
      activeAiOutputs: [],
      activeRecording: createRecordingView(),
      activeStructuredItems: emptyStructuredItems,
      activeTranscript: createTranscript(),
      initialTab: "transcript",
      initialTabFromCookie: true,
      userSettings: defaultUserSettings
    })));

    const row = container?.querySelector<HTMLElement>("#transcript-at-1200") as HTMLElement;
    const button = row.querySelector<HTMLButtonElement>('button[type="button"]') as HTMLButtonElement;
    const scrollIntoView = vi.fn();
    const focus = vi.spyOn(row, "focus");
    row.scrollIntoView = scrollIntoView;

    await act(async () => button.click());

    expect(audioPlayerMocks.seekToMs).toHaveBeenCalledWith(1200, { play: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(row.getAttribute("aria-current")).toBe("true");

    await act(async () => vi.advanceTimersByTime(2_000));
    expect(row.getAttribute("aria-current")).toBeNull();
  });

  it("still navigates transcript-only recordings without seeking audio", async () => {
    await act(async () => root?.render(createElement(TranscriptTabs, {
      activeAiOutputs: [],
      activeRecording: createRecordingView("none"),
      activeStructuredItems: emptyStructuredItems,
      activeTranscript: createTranscript(),
      initialTab: "transcript",
      initialTabFromCookie: true,
      userSettings: defaultUserSettings
    })));

    const button = container?.querySelector<HTMLButtonElement>(
      '#transcript-at-1200 button[type="button"]'
    );
    await act(async () => button?.click());

    expect(audioPlayerMocks.seekToMs).not.toHaveBeenCalled();
    expect(container?.querySelector("#transcript-at-1200")?.getAttribute("aria-current"))
      .toBe("true");
  });

  it("uses non-animated scrolling when reduced motion is requested", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    await act(async () => root?.render(createElement(TranscriptTabs, {
      activeAiOutputs: [],
      activeRecording: createRecordingView(),
      activeStructuredItems: emptyStructuredItems,
      activeTranscript: createTranscript(),
      initialTab: "transcript",
      initialTabFromCookie: true,
      userSettings: defaultUserSettings
    })));
    const row = container?.querySelector<HTMLElement>("#transcript-at-1200") as HTMLElement;
    const scrollIntoView = vi.fn();
    row.scrollIntoView = scrollIntoView;

    await act(async () => row.querySelector<HTMLButtonElement>("button")?.click());

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    vi.unstubAllGlobals();
  });

  it("clears highlight state when a pending target disappears before commit", async () => {
    const transcript = createTranscript();
    await act(async () => root?.render(createElement(TranscriptTabs, {
      activeAiOutputs: [],
      activeRecording: createRecordingView(),
      activeStructuredItems: emptyStructuredItems,
      activeTranscript: transcript,
      initialTab: "transcript",
      initialTabFromCookie: true,
      userSettings: defaultUserSettings
    })));
    const button = container?.querySelector<HTMLButtonElement>(
      '#transcript-at-1200 button[type="button"]'
    );

    await act(async () => {
      button?.click();
      root?.render(createElement(TranscriptTabs, {
        activeAiOutputs: [],
        activeRecording: createRecordingView(),
        activeStructuredItems: emptyStructuredItems,
        activeTranscript: { ...transcript, segments: [] },
        initialTab: "transcript",
        initialTabFromCookie: true,
        userSettings: defaultUserSettings
      }));
    });

    expect(container?.querySelector(".transcript-table-row-highlighted")).toBeNull();
  });

  it("does not apply a pending target to another transcript with the same anchor", async () => {
    const transcriptA = createTranscriptWithId("00000000-0000-4000-8000-000000000011");
    const transcriptB = createTranscriptWithId("00000000-0000-4000-8000-000000000012");
    await act(async () => root?.render(createElement(TranscriptTabs, {
      activeAiOutputs: [],
      activeRecording: createRecordingView(),
      activeStructuredItems: emptyStructuredItems,
      activeTranscript: transcriptA,
      initialTab: "transcript",
      initialTabFromCookie: true,
      userSettings: defaultUserSettings
    })));
    const button = container?.querySelector<HTMLButtonElement>(
      '#transcript-at-1200 button[type="button"]'
    );

    await act(async () => {
      button?.click();
      audioPlayerMocks.seekToMs.mockClear();
      root?.render(createElement(TranscriptTabs, {
        activeAiOutputs: [],
        activeRecording: createRecordingView(),
        activeStructuredItems: emptyStructuredItems,
        activeTranscript: transcriptB,
        initialTab: "transcript",
        initialTabFromCookie: true,
        userSettings: defaultUserSettings
      }));
    });

    expect(container?.querySelector("#transcript-at-1200")?.getAttribute("aria-current"))
      .toBeNull();
    expect(audioPlayerMocks.seekToMs).not.toHaveBeenCalled();
  });

  it("lets a newer highlight timer win over an older timer", async () => {
    vi.useFakeTimers();
    const transcript = createTranscript();
    transcript.segments = [
      { end_ms: 1600, speaker: 1, start_ms: 1200, text: "První." },
      { end_ms: 2600, speaker: 2, start_ms: 2200, text: "Druhý." }
    ];
    await act(async () => root?.render(createElement(TranscriptTabs, {
      activeAiOutputs: [],
      activeRecording: createRecordingView(),
      activeStructuredItems: emptyStructuredItems,
      activeTranscript: transcript,
      initialTab: "transcript",
      initialTabFromCookie: true,
      userSettings: defaultUserSettings
    })));
    const first = container?.querySelector<HTMLButtonElement>("#transcript-at-1200 button");
    const second = container?.querySelector<HTMLButtonElement>("#transcript-at-2200 button");

    await act(async () => first?.click());
    await act(async () => vi.advanceTimersByTime(1_500));
    await act(async () => second?.click());
    await act(async () => vi.advanceTimersByTime(500));

    expect(container?.querySelector("#transcript-at-2200")?.getAttribute("aria-current"))
      .toBe("true");

    await act(async () => vi.advanceTimersByTime(1_500));
    expect(container?.querySelector("#transcript-at-2200")?.getAttribute("aria-current"))
      .toBeNull();
  });
});
