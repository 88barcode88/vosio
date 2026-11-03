import { describe, expect, it } from "vitest";
import {
  MAX_NORMALIZED_EVIDENCE_QUOTE_LENGTH,
  resolveEvidenceLocation,
  resolveUniqueEvidenceTextBlock
} from "@/lib/transcripts/evidence-location";

const uniqueSegments = [
  { end_ms: 1_200, start_ms: 1_000, text: "Domluvime" },
  { end_ms: 1_500, start_ms: 1_200, text: " termin" },
  { end_ms: 1_550, start_ms: 1_500, text: "," },
  { end_ms: 1_700, start_ms: 1_550, text: " v" },
  { end_ms: 2_000, start_ms: 1_700, text: " p\u00E1tek!" }
];

describe("evidence location resolver", () => {
  it("matches one exact contiguous quote across Czech case, whitespace and punctuation differences", () => {
    expect(resolveEvidenceLocation(uniqueSegments, "  DOMLUVIME termin v P\u00C1TEK. ")).toEqual({
      endMs: 2_000,
      startMs: 1_000
    });
  });

  it("returns null when the same normalized quote appears more than once", () => {
    expect(resolveEvidenceLocation([...uniqueSegments, ...uniqueSegments], "domluvime termin v p\u00E1tek")).toBeNull();
  });

  it("finds one untimed transcript block across Czech case and punctuation differences", () => {
    const target = { anchorId: "transcript-block-2", text: "Tak to zobrazíme zase." };

    expect(resolveUniqueEvidenceTextBlock([
      { anchorId: "transcript-block-1", text: "Úvod hovoru" },
      target
    ], "„TAK to zobrazíme zase“")).toBe(target);
  });

  it("rejects an untimed quote that is duplicated or only a partial word", () => {
    expect(resolveUniqueEvidenceTextBlock([
      { anchorId: "transcript-block-1", text: "Stejný důkaz" },
      { anchorId: "transcript-block-2", text: "Stejný důkaz" }
    ], "stejný důkaz")).toBeNull();
    expect(resolveUniqueEvidenceTextBlock([
      { anchorId: "transcript-block-1", text: "předtermínový" }
    ], "termín")).toBeNull();
  });

  it("preserves symbols, compatibility characters and Czech accents during normalization", () => {
    const symbols = [
      { end_ms: 1_200, start_ms: 1_000, text: "C++" },
      { end_ms: 1_600, start_ms: 1_300, text: " ①" },
      { end_ms: 2_000, start_ms: 1_700, text: " pátek" }
    ];

    expect(resolveEvidenceLocation(symbols, "C")).toBeNull();
    expect(resolveEvidenceLocation(symbols, "c++")).toEqual({ endMs: 1_200, startMs: 1_000 });
    expect(resolveEvidenceLocation(symbols, "1")).toBeNull();
    expect(resolveEvidenceLocation(symbols, "patek")).toBeNull();
  });

  it("handles a long token stream and rejects oversized quotes before reading transcript tokens", () => {
    const longSegments = Array.from({ length: 20_000 }, (_, index) => ({
      end_ms: index + 1,
      start_ms: index,
      text: index === 19_999 ? " hledany dukaz" : " vypln"
    }));
    const unreadableSegments = new Proxy([], {
      get() {
        throw new Error("oversized quote must short-circuit before transcript traversal");
      }
    });

    expect(resolveEvidenceLocation(longSegments, "hledany dukaz")).toEqual({ endMs: 20_000, startMs: 19_999 });
    expect(resolveEvidenceLocation(
      unreadableSegments,
      "a".repeat(MAX_NORMALIZED_EVIDENCE_QUOTE_LENGTH + 1)
    )).toBeNull();
  });

  it.each([
    [[{ end_ms: 1_200, text: "Domluvime" }], "missing start"],
    [[{ start_ms: 1_000, text: "Domluvime" }], "missing end"]
  ])("returns null for a unique match with %s", (segments, _reason) => {
    expect(resolveEvidenceLocation(segments, "domluvime")).toBeNull();
  });

  describe("Soniox sub-word tokens", () => {
    // Real Soniox tokens split Czech words into pieces; only a leading space marks a new word.
    const subwordSegments = [
      { end_ms: 400, speaker: "1", start_ms: 300, text: "Dob" },
      { end_ms: 500, speaker: "1", start_ms: 400, text: "rý" },
      { end_ms: 800, speaker: "1", start_ms: 500, text: " den" },
      { end_ms: 900, speaker: "1", start_ms: 800, text: "," },
      { end_ms: 1_100, speaker: "1", start_ms: 900, text: " pos" },
      { end_ms: 1_300, speaker: "1", start_ms: 1_100, text: "l" },
      { end_ms: 1_500, speaker: "1", start_ms: 1_300, text: "ouch" },
      { end_ms: 1_600, speaker: "1", start_ms: 1_500, text: "ám" },
      { end_ms: 1_800, speaker: "2", start_ms: 1_700, text: "Ano" },
      { end_ms: 2_000, speaker: "2", start_ms: 1_800, text: " pros" },
      { end_ms: 2_100, speaker: "2", start_ms: 2_000, text: "ím" }
    ];

    it("locates a quote whose words were split into several tokens", () => {
      expect(resolveEvidenceLocation(subwordSegments, "Dobrý den, poslouchám")).toEqual({ endMs: 1_600, startMs: 300 });
      expect(resolveEvidenceLocation(subwordSegments, "„poslouchám“")).toEqual({ endMs: 1_600, startMs: 900 });
    });

    it("keeps whole-word matching for sub-word streams", () => {
      expect(resolveEvidenceLocation(subwordSegments, "dobr")).toBeNull();
      expect(resolveEvidenceLocation(subwordSegments, "slouchám")).toBeNull();
      expect(resolveEvidenceLocation(subwordSegments, "den poslouch")).toBeNull();
    });

    it("does not glue the last word of one speaker to the first word of the next", () => {
      expect(resolveEvidenceLocation(subwordSegments, "poslouchám ano")).toEqual({ endMs: 1_800, startMs: 900 });
      expect(resolveEvidenceLocation(subwordSegments, "poslouchámano")).toBeNull();
    });

    it("discards a paraphrase and a quote with a different word", () => {
      expect(resolveEvidenceLocation(subwordSegments, "dobrý den, slyším vás")).toBeNull();
      expect(resolveEvidenceLocation(subwordSegments, "dobrý den poslouchám vás")).toBeNull();
    });
  });

  describe("segment boundaries", () => {
    it("keeps words of adjacent phrase-level segments apart", () => {
      const phrases = [
        { end_ms: 1_000, start_ms: 0, text: "prvni veta" },
        { end_ms: 2_000, start_ms: 1_000, text: "druha veta" }
      ];

      expect(resolveEvidenceLocation(phrases, "veta druha")).toEqual({ endMs: 2_000, startMs: 0 });
      expect(resolveEvidenceLocation(phrases, "vetadruha")).toBeNull();
    });

    it("does not merge the last word of a nested segment with the first word of the next", () => {
      const nested = [
        { tokens: [{ end_ms: 100, start_ms: 0, text: "Ahoj" }, { end_ms: 200, start_ms: 100, text: " sv" }, { end_ms: 300, start_ms: 200, text: "ete" }] },
        { tokens: [{ end_ms: 400, start_ms: 300, text: "Pak" }, { end_ms: 500, start_ms: 400, text: " jdeme" }] }
      ];

      expect(resolveEvidenceLocation(nested, "ahoj svete pak jdeme")).toEqual({ endMs: 500, startMs: 0 });
      expect(resolveEvidenceLocation(nested, "svetepak")).toBeNull();
    });
  });

  it.each([
    ["domluvime term", "partial token"],
    ["domluvime p\u00E1tek", "non-contiguous words"],
    ["schvalime rozpocet", "no match"]
  ])("returns null for %s (%s)", (quote) => {
    expect(resolveEvidenceLocation(uniqueSegments, quote)).toBeNull();
  });
});
