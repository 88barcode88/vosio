// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptContent } from "@/components/transcript-tabs/transcript-content";
import type { TranscriptTarget } from "@/components/transcript-tabs/types";
import { getTranscriptAnchorId } from "@/lib/transcripts/navigation";
import type { TranscriptRow } from "@/lib/transcripts/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/recordings/test"
}));

vi.mock("@/lib/transcripts/actions", () => ({
  updateTranscriptSpeakerAction: vi.fn(async () => undefined)
}));

let container: HTMLDivElement | null;
let root: Root | null;

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

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
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
});
