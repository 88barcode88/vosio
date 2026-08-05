import { describe, expect, it } from "vitest";
import {
  extractTranscriptSpeakerSummaries,
  getTranscriptSpeakerContext,
  updateTranscriptSpeakerSummary
} from "@/lib/transcripts/speakers";
import { getTranscriptSpeakerBlocks } from "@/components/transcript-tabs/speaker-blocks";

describe("transcript speaker helpers", () => {
  it("extracts diarized speaker summaries from flat Soniox tokens", () => {
    const speakers = extractTranscriptSpeakerSummaries([
      { end_ms: 400, speaker: 2, start_ms: 100, text: "Ahoj" },
      { end_ms: 900, speaker: 1, start_ms: 500, text: "Dobrý den" },
      { end_ms: 1200, speaker: 2, start_ms: 950, text: "pokračujeme" }
    ]);

    expect(speakers).toMatchObject([
      { firstStartMs: 500, id: "1", label: "Mluvčí 1", tokenCount: 1 },
      { firstStartMs: 100, id: "2", label: "Mluvčí 2", tokenCount: 2 }
    ]);
  });

  it("preserves provider evidence while applying manual speaker labels", () => {
    const segments = [
      { end_ms: 400, speaker: 1, start_ms: 100, text: "Ahoj" }
    ];
    const updated = updateTranscriptSpeakerSummary([], segments, {
      name: "Klient Anna",
      role: "client_customer",
      speakerId: "1"
    });

    expect(updated).toMatchObject([
      {
        firstStartMs: 100,
        id: "1",
        name: "Klient Anna",
        role: "client_customer",
        source: "manual",
        tokenCount: 1
      }
    ]);
  });

  it("builds prompt speaker context with owner categories", () => {
    const context = getTranscriptSpeakerContext(
      [
        {
          firstStartMs: 100,
          id: "1",
          label: "Mluvčí 1",
          lastEndMs: 400,
          name: "Konzultant",
          role: "delivery_team",
          roleLabel: "Dodavatel / náš tým",
          source: "manual",
          tokenCount: 3
        }
      ],
      []
    );

    expect(context).toEqual([
      expect.objectContaining({
        assigned_name: "Konzultant",
        owner_category: "Moje práce",
        role: "delivery_team",
        speaker_id: "1"
      })
    ]);
  });

  it("keeps more than eight speakers available for editing and context", () => {
    const tokens = Array.from({ length: 12 }, (_, index) => ({
      end_ms: (index + 1) * 1000,
      speaker: index + 1,
      start_ms: index * 1000,
      text: `Věta ${index + 1}. `
    }));

    const speakers = extractTranscriptSpeakerSummaries(tokens);
    const context = getTranscriptSpeakerContext(speakers, tokens);

    expect(speakers).toHaveLength(12);
    expect(speakers.at(7)).toMatchObject({ id: "8", label: "Mluvčí 8" });
    expect(speakers.at(11)).toMatchObject({ id: "12", label: "Mluvčí 12" });
    expect(context.at(11)).toMatchObject({ owner_category: "Nejasné", speaker_id: "12" });
  });

  it("uses manually saved speaker names in transcript rows", () => {
    const segments = [
      { end_ms: 400, speaker: 1, start_ms: 100, text: "Dobrý den. " },
      { end_ms: 800, speaker: 1, start_ms: 450, text: "Pokračuji. " },
      { end_ms: 1200, speaker: 2, start_ms: 900, text: "Rozumím." }
    ];
    const speakers = updateTranscriptSpeakerSummary([], segments, {
      name: "Klient Anna",
      role: "client_customer",
      speakerId: "1"
    });

    const blocks = getTranscriptSpeakerBlocks(segments, speakers);

    expect(blocks).toEqual([
      expect.objectContaining({ speakerId: "1", speakerLabel: "Klient Anna", text: "Dobrý den. Pokračuji. " }),
      expect.objectContaining({ speakerId: "2", speakerLabel: "Mluvčí 2", text: "Rozumím." })
    ]);
  });

  it("preserves the first start and last end offset in each consecutive speaker block", () => {
    const segments = [
      { end_ms: 2100, speaker: 1, start_ms: 1200, text: "První " },
      { end_ms: 4200, speaker: 1, start_ms: 2200, text: "blok." },
      { end_ms: 5100, speaker: 2, start_ms: 4300, text: "Druhý blok." }
    ];

    expect(getTranscriptSpeakerBlocks(segments, [])).toMatchObject([
      {
        anchorId: "transcript-at-1200",
        endMs: 4200,
        startMs: 1200,
        text: "První blok."
      },
      {
        anchorId: "transcript-at-4300",
        endMs: 5100,
        startMs: 4300,
        text: "Druhý blok."
      }
    ]);
  });

  it("uses a stable block fallback when the first token has no timestamp", () => {
    const blocks = getTranscriptSpeakerBlocks(
      [
        { end_ms: null, speaker: 1, start_ms: null, text: "Bez času." },
        { end_ms: 2200, speaker: 2, start_ms: 1200, text: "S časem." }
      ],
      []
    );

    expect(blocks[0]).toMatchObject({
      anchorId: "transcript-block-1",
      endMs: null,
      startMs: null
    });
    expect(blocks[1]).toMatchObject({
      anchorId: "transcript-at-1200",
      endMs: 2200,
      startMs: 1200
    });
  });

  it("suffixes duplicate non-null start anchors by resulting block occurrence", () => {
    const blocks = getTranscriptSpeakerBlocks(
      [
        { end_ms: 1500, speaker: 1, start_ms: 1200, text: "První." },
        { end_ms: 1700, speaker: 2, start_ms: 1200, text: "Druhý." },
        { end_ms: 1900, speaker: 3, start_ms: 1200, text: "Třetí." }
      ],
      []
    );

    expect(blocks.map((block) => block.anchorId)).toEqual([
      "transcript-at-1200",
      "transcript-at-1200-2",
      "transcript-at-1200-3"
    ]);
  });

  it("keeps UI timestamps safe when later tokens contain malformed offsets", () => {
    const blocks = getTranscriptSpeakerBlocks(
      [
        { end_ms: -1, speaker: 1, start_ms: Number.NaN, text: "První " },
        { end_ms: 2_100, speaker: 1, start_ms: 1_200, text: "druhý " },
        { end_ms: Number.POSITIVE_INFINITY, speaker: 1, start_ms: 2_200, text: "třetí." }
      ],
      []
    );

    expect(blocks[0]).toMatchObject({
      anchorId: "transcript-at-1200",
      endMs: 2_100,
      label: "00:01",
      startMs: 1_200,
      text: "První druhý třetí."
    });
  });

  it("resolves duplicate stored speaker metadata deterministically", () => {
    const speakerBase = {
      firstStartMs: 100,
      id: "1",
      label: "Mluvčí 1",
      lastEndMs: 400,
      role: "unknown",
      roleLabel: "Nepřiřazeno",
      source: "manual",
      tokenCount: 1
    };
    const blocks = getTranscriptSpeakerBlocks(
      [{ end_ms: 400, speaker: 1, start_ms: 100, text: "Text." }],
      [
        { ...speakerBase, name: "První jméno" },
        { ...speakerBase, name: "Poslední jméno" }
      ]
    );

    expect(blocks[0]?.speakerLabel).toBe("Poslední jméno");
  });

  it("keeps the existing raw-text UI fallback when no token has a speaker", () => {
    expect(getTranscriptSpeakerBlocks(
      [{ end_ms: 900, start_ms: 100, text: "Bez mluvčího." }],
      []
    )).toEqual([]);
  });
});
