import { describe, expect, it } from "vitest";
import type { TranscriptSpeakerBlock } from "@/components/transcript-tabs/types";
import {
  parseTranscriptDeepLink,
  parseTranscriptDeepLinkSearchParams,
  resolveTranscriptDeepLink,
  splitTranscriptHighlight,
  transcriptDeepLinkRequestsMatch,
  TRANSCRIPT_DEEP_LINK_MAX_AT_MS,
  TRANSCRIPT_RAW_ANCHOR_ID
} from "@/lib/transcripts/deep-link";

// createBlock builds one renderable transcript row for pure deep-link tests.
function createBlock(
  anchorId: string,
  startMs: number | null,
  endMs: number | null,
  text: string
): TranscriptSpeakerBlock {
  return {
    anchorId,
    endMs,
    label: "00:00",
    speakerClassName: "speaker-one",
    speakerId: "1",
    speakerLabel: "Mluvčí 1",
    startMs,
    text
  };
}

describe("transcript deep links", () => {
  it("parses only one explicit transcript tab and strict bounded target values", () => {
    expect(parseTranscriptDeepLink({
      at: "0",
      highlight: "  Lucern\n  CRM ",
      tab: "transcript"
    })).toEqual({
      explicitTranscriptTab: true,
      request: { atMs: 0, highlightText: "Lucern CRM" }
    });
    expect(parseTranscriptDeepLink({
      at: String(TRANSCRIPT_DEEP_LINK_MAX_AT_MS),
      tab: "transcript"
    }).request).toEqual({ atMs: TRANSCRIPT_DEEP_LINK_MAX_AT_MS, highlightText: null });
    expect(parseTranscriptDeepLink({ tab: "ai" })).toEqual({
      explicitTranscriptTab: false,
      request: null
    });
    expect(parseTranscriptDeepLink({ tab: ["transcript"] })).toEqual({
      explicitTranscriptTab: false,
      request: null
    });
  });

  it.each([
    { at: "-1", tab: "transcript" },
    { at: "1.5", tab: "transcript" },
    { at: "01", tab: "transcript" },
    { at: String(TRANSCRIPT_DEEP_LINK_MAX_AT_MS + 1), tab: "transcript" },
    { at: ["1", "2"], tab: "transcript" },
    { highlight: ["Lucern"], tab: "transcript" },
    { highlight: " ", tab: "transcript" },
    { highlight: "x".repeat(121), tab: "transcript" }
  ])("omits malformed targets but keeps the explicit transcript tab: $at $highlight", (query) => {
    expect(parseTranscriptDeepLink(query)).toEqual({
      explicitTranscriptTab: true,
      request: null
    });
  });

  it("rejects duplicate browser params and compares the exact normalized request signature", () => {
    expect(parseTranscriptDeepLinkSearchParams(
      new URLSearchParams("tab=transcript&at=1&at=1&highlight=Lucern")
    )).toEqual({ explicitTranscriptTab: true, request: null });
    expect(parseTranscriptDeepLinkSearchParams(
      new URLSearchParams("tab=transcript&tab=transcript&at=1")
    )).toEqual({ explicitTranscriptTab: false, request: null });
    expect(transcriptDeepLinkRequestsMatch(
      { atMs: 1, highlightText: "Lucern CRM" },
      { atMs: 1, highlightText: "Lucern CRM" }
    )).toBe(true);
    expect(transcriptDeepLinkRequestsMatch(
      { atMs: 1, highlightText: "Lucern CRM" },
      { atMs: 1, highlightText: "Jiný text" }
    )).toBe(false);
    expect(transcriptDeepLinkRequestsMatch(null, null)).toBe(true);
  });

  it("selects a containing block, then the nearest next block, then the closest prior block", () => {
    const blocks = [
      createBlock("first", 1000, 2000, "První část"),
      createBlock("second", 4000, 5000, "Lucern CRM"),
      createBlock("third", 8000, 9000, "Poslední část")
    ];
    const resolveAt = (atMs: number) => resolveTranscriptDeepLink({
      rawText: "",
      recordingId: "recording-1",
      request: { atMs, highlightText: "Lucern CRM" },
      speakerBlocks: blocks,
      transcriptId: "transcript-1"
    });

    expect(resolveAt(4500)?.target).toMatchObject({ anchorId: "second", startMs: 4500 });
    expect(resolveAt(2500)?.target).toMatchObject({ anchorId: "second", startMs: 2500 });
    expect(resolveAt(9500)?.target).toMatchObject({ anchorId: "third", startMs: 9500 });
  });

  it("uses render order to resolve duplicate timestamps deterministically", () => {
    const target = resolveTranscriptDeepLink({
      rawText: "",
      recordingId: "recording-1",
      request: { atMs: 1200, highlightText: null },
      speakerBlocks: [
        createBlock("transcript-at-1200", 1200, 1500, "První"),
        createBlock("transcript-at-1200-2", 1200, 1800, "Druhý")
      ],
      transcriptId: "transcript-1"
    });

    expect(target?.target.anchorId).toBe("transcript-at-1200");
  });

  it("requires one unique normalized text occurrence when no timestamp exists", () => {
    const base = {
      rawText: "",
      recordingId: "recording-1",
      request: { atMs: null, highlightText: "Lucern CRM" },
      transcriptId: "transcript-1"
    } as const;

    expect(resolveTranscriptDeepLink({
      ...base,
      speakerBlocks: [
        createBlock("first", 1000, 2000, "Řešíme Lucern\n CRM dnes."),
        createBlock("second", 3000, 4000, "Jiný obsah")
      ]
    })?.target).toMatchObject({ anchorId: "first", playback: "none", startMs: null });
    expect(resolveTranscriptDeepLink({
      ...base,
      speakerBlocks: [
        createBlock("first", 1000, 2000, "Lucern CRM"),
        createBlock("second", 3000, 4000, "Lucern CRM")
      ]
    })).toBeNull();
    expect(resolveTranscriptDeepLink({
      ...base,
      speakerBlocks: [createBlock("first", 1000, 2000, "Lucern CRM a Lucern CRM")]
    })).toBeNull();
    expect(resolveTranscriptDeepLink({
      ...base,
      speakerBlocks: [createBlock("first", 1000, 2000, "Bez shody")]
    })).toBeNull();
  });

  it("targets one raw paragraph without a seek and rejects ambiguous raw text", () => {
    const unique = resolveTranscriptDeepLink({
      rawText: "Ruční přepis řeší Lucern   CRM dnes.",
      recordingId: "recording-1",
      request: { atMs: null, highlightText: "Lucern CRM" },
      speakerBlocks: [],
      transcriptId: "transcript-1"
    });
    const ambiguous = resolveTranscriptDeepLink({
      rawText: "Lucern CRM a znovu Lucern CRM.",
      recordingId: "recording-1",
      request: { atMs: null, highlightText: "Lucern CRM" },
      speakerBlocks: [],
      transcriptId: "transcript-1"
    });

    expect(unique?.target).toMatchObject({
      anchorId: TRANSCRIPT_RAW_ANCHOR_ID,
      playback: "none",
      startMs: null
    });
    expect(ambiguous).toBeNull();
  });

  it("keeps highlight rendering inert and marks only one normalized match", () => {
    expect(splitTranscriptHighlight("Před Lucern\n CRM po", "lucern crm")).toEqual([
      { highlighted: false, text: "Před " },
      { highlighted: true, text: "Lucern\n CRM" },
      { highlighted: false, text: " po" }
    ]);
    expect(splitTranscriptHighlight("<img onerror=alert(1)>", "img")).toEqual([
      { highlighted: false, text: "<" },
      { highlighted: true, text: "img" },
      { highlighted: false, text: " onerror=alert(1)>" }
    ]);
    expect(splitTranscriptHighlight("Lucern CRM a Lucern CRM", "Lucern CRM"))
      .toEqual([{ highlighted: false, text: "Lucern CRM a Lucern CRM" }]);
  });
});
