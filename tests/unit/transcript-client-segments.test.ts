import { describe, expect, it } from "vitest";
import { toClientTranscriptSegments } from "@/lib/transcripts/client-segments";
import { getStoredTranscriptSpeakerSummaries } from "@/lib/transcripts/speakers";
import { resolveEvidenceLocation } from "@/lib/transcripts/evidence-location";
import { getTranscriptSpeakerBlocks } from "@/components/transcript-tabs/speaker-blocks";

// fullToken builds one Soniox-style token including fields the detail client never reads.
function fullToken(index: number, text: string) {
  return {
    confidence: 0.97,
    end_ms: index * 300 + 250,
    is_final: true,
    language: "cs",
    speaker: String((Math.floor(index / 40) % 2) + 1),
    start_ms: index * 300,
    text,
    translation_status: "none"
  };
}

// createNestedSegments builds a nested segment fixture with the requested token count.
function createNestedSegments(tokenCount: number, perSegment = 50) {
  const tokens = Array.from({ length: tokenCount }, (_, index) => fullToken(index, index === 700 ? " unikát" : index % 3 === 0 ? " slo" : "vo"));
  return Array.from({ length: Math.ceil(tokenCount / perSegment) }, (_, index) => ({
    end_ms: 1,
    speaker: "1",
    start_ms: 0,
    text: "segment",
    tokens: tokens.slice(index * perSegment, (index + 1) * perSegment)
  }));
}

describe("toClientTranscriptSegments", () => {
  it("keeps only text, speaker, start_ms and end_ms on flat legacy tokens", () => {
    expect(toClientTranscriptSegments([fullToken(0, "Ahoj")])).toEqual([
      { end_ms: 250, speaker: "1", start_ms: 0, text: "Ahoj" }
    ]);
  });

  it("keeps nested token arrays and drops segment-level and unread token fields", () => {
    expect(toClientTranscriptSegments([{ speaker: "1", text: "x", tokens: [fullToken(1, " den")] }])).toEqual([
      { tokens: [{ end_ms: 550, speaker: "1", start_ms: 300, text: " den" }] }
    ]);
  });

  it("omits missing fields instead of writing undefined keys", () => {
    const [token] = toClientTranscriptSegments([{ confidence: 1, text: "bez času", start_ms: undefined }]);
    expect(token).toEqual({ text: "bez času" });
    expect(Object.keys(token as object)).toEqual(["text"]);
  });

  it("returns an empty array for empty or non-array payloads and keeps primitive entries", () => {
    expect(toClientTranscriptSegments([])).toEqual([]);
    expect(toClientTranscriptSegments(null)).toEqual([]);
    expect(toClientTranscriptSegments({ tokens: [] })).toEqual([]);
    expect(toClientTranscriptSegments([null, "x"])).toEqual([null, "x"]);
  });

  it("does not mutate the stored segments", () => {
    const segments = createNestedSegments(3);
    const snapshot = structuredClone(segments);
    toClientTranscriptSegments(segments);
    expect(segments).toEqual(snapshot);
  });

  it("keeps client speaker blocks, speaker summaries and evidence locations identical", () => {
    const full = createNestedSegments(3000);
    const slim = toClientTranscriptSegments(full);
    const quote = "Unikátvo slovovo";

    expect(getTranscriptSpeakerBlocks(slim, [])).toEqual(getTranscriptSpeakerBlocks(full, []));
    expect(getStoredTranscriptSpeakerSummaries([], slim)).toEqual(getStoredTranscriptSpeakerSummaries([], full));
    expect(resolveEvidenceLocation(slim, quote)).toEqual(resolveEvidenceLocation(full, quote));
    expect(resolveEvidenceLocation(full, quote)).not.toBeNull();
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(full).length * 0.65);
  });
});
