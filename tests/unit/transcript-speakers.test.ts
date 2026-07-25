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
});
