import { describe, expect, it } from "vitest";
import {
  MAX_NORMALIZED_EVIDENCE_QUOTE_LENGTH,
  resolveEvidenceLocation
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

  it.each([
    ["domluvime term", "partial token"],
    ["domluvime p\u00E1tek", "non-contiguous words"],
    ["schvalime rozpocet", "no match"]
  ])("returns null for %s (%s)", (quote) => {
    expect(resolveEvidenceLocation(uniqueSegments, quote)).toBeNull();
  });
});
