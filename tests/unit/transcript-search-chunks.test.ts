import { describe, expect, it } from "vitest";
import { getTranscriptSpeakerBlocks } from "@/components/transcript-tabs/speaker-blocks";
import { buildTranscriptSearchChunks } from "@/lib/transcripts/search-chunks";

describe("transcript search chunks", () => {
  it("groups consecutive speakers with exact token punctuation and 1-based positions", () => {
    const segments = [
      { end_ms: 1_700, speaker: 1, start_ms: 1_200, text: "Dobrý" },
      { end_ms: 2_300, speaker: 1, start_ms: 1_800, text: ", den!  " },
      { end_ms: 3_100, speaker: 2, start_ms: 2_500, text: "Souhlasím." }
    ];

    expect(buildTranscriptSearchChunks({ rawText: "", segments, speakers: [] })).toEqual([
      {
        endMs: 2_300,
        position: 1,
        speakerLabel: "Mluvčí 1",
        startMs: 1_200,
        text: "Dobrý, den!  "
      },
      {
        endMs: 3_100,
        position: 2,
        speakerLabel: "Mluvčí 2",
        startMs: 2_500,
        text: "Souhlasím."
      }
    ]);
  });

  it("uses saved speaker display names", () => {
    const segments = [
      { end_ms: 4_200, speaker: 1, start_ms: 1_200, text: "Dobrý den." }
    ];
    const speakers = [
      {
        firstStartMs: 1_200,
        id: "1",
        label: "Mluvčí 1",
        lastEndMs: 4_200,
        name: "Klient Anna",
        role: "client_customer",
        roleLabel: "Klient",
        source: "manual",
        tokenCount: 1
      }
    ];

    expect(buildTranscriptSearchChunks({ rawText: "", segments, speakers })).toEqual([
      {
        endMs: 4_200,
        position: 1,
        speakerLabel: "Klient Anna",
        startMs: 1_200,
        text: "Dobrý den."
      }
    ]);
  });

  it("keeps the first and last safe timestamps in a speaker group", () => {
    const segments = [
      { end_ms: -1, speaker: 1, start_ms: Number.NaN, text: "Bez " },
      { end_ms: 2_100, speaker: 1, start_ms: 1_200, text: "platného " },
      { end_ms: Number.POSITIVE_INFINITY, speaker: 1, start_ms: 2_200, text: "konce " },
      { end_ms: 900, speaker: 1, start_ms: 2_600, text: "s chybným časem " },
      { end_ms: null, speaker: 1, start_ms: 3_000, text: "bloku." }
    ];

    expect(buildTranscriptSearchChunks({ rawText: "", segments, speakers: [] })).toEqual([
      {
        endMs: 2_100,
        position: 1,
        speakerLabel: "Mluvčí 1",
        startMs: 1_200,
        text: "Bez platného konce s chybným časem bloku."
      }
    ]);
  });

  it("uses an untimed raw-text chunk when no token group is renderable in the UI", () => {
    const segments = [
      { end_ms: 900, start_ms: 100, text: "Bez " },
      { end_ms: 1_500, start_ms: 1_000, text: "mluvčího." }
    ];

    expect(getTranscriptSpeakerBlocks(segments, [])).toEqual([]);
    expect(buildTranscriptSearchChunks({
      rawText: "  Celý raw přepis bez diarizace.  ",
      segments,
      speakers: []
    })).toEqual([
      {
        endMs: null,
        position: 1,
        speakerLabel: null,
        startMs: null,
        text: "Celý raw přepis bez diarizace."
      }
    ]);
  });

  it("does not index invisible no-speaker token text when raw text is empty", () => {
    const segments = [{ end_ms: 900, start_ms: 100, text: "Neviditelný token." }];

    expect(getTranscriptSpeakerBlocks(segments, [])).toEqual([]);
    expect(buildTranscriptSearchChunks({ rawText: "", segments, speakers: [] })).toEqual([]);
  });

  it("keeps every timed diarized chunk targetable by the corresponding UI block", () => {
    const segments = [
      { end_ms: 900, speaker: 1, start_ms: 100, text: "První." },
      { end_ms: 1_500, start_ms: 1_000, text: " Bez určení." },
      { end_ms: 2_400, speaker: 2, start_ms: 1_700, text: " Druhý." }
    ];
    const blocks = getTranscriptSpeakerBlocks(segments, []);
    const chunks = buildTranscriptSearchChunks({ rawText: "", segments, speakers: [] });

    expect(chunks.map(({ endMs, position, startMs, text }) => ({ endMs, position, startMs, text })))
      .toEqual(blocks.map((block, index) => ({
        endMs: block.endMs,
        position: index + 1,
        startMs: block.startMs,
        text: block.text
      })));
    expect(blocks.map((block) => block.speakerId)).toEqual(["1", null, "2"]);
  });

  it("falls back to trimmed manual raw text without timestamps", () => {
    expect(buildTranscriptSearchChunks({
      rawText: "  Ruční text.\n",
      segments: [],
      speakers: []
    })).toEqual([
      {
        endMs: null,
        position: 1,
        speakerLabel: null,
        startMs: null,
        text: "Ruční text."
      }
    ]);
  });

  it("returns no chunks for empty segments and empty raw text", () => {
    expect(buildTranscriptSearchChunks({ rawText: "  ", segments: [], speakers: [] })).toEqual([]);
    expect(buildTranscriptSearchChunks({
      rawText: "",
      segments: [{ speaker: 1, text: "  " }, null, "poškozený segment"],
      speakers: []
    })).toEqual([]);
  });
});
