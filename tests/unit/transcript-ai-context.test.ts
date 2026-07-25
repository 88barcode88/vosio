import { describe, expect, it } from "vitest";
import { buildAiTranscriptPromptContext } from "@/lib/transcripts/ai-context";

describe("AI transcript prompt context", () => {
  it("compacts token-level Soniox segments into speaker utterances", () => {
    const context = buildAiTranscriptPromptContext(
      [
        {
          tokens: [
            { end_ms: 200, speaker: 1, start_ms: 0, text: "Dobrý " },
            { end_ms: 400, speaker: 1, start_ms: 200, text: "den." },
            { end_ms: 900, speaker: 2, start_ms: 700, text: "Dobrý den." }
          ]
        }
      ],
      [
        {
          firstStartMs: 0,
          id: "1",
          label: "Mluvčí 1",
          lastEndMs: 400,
          name: "Mira",
          role: "delivery_team",
          roleLabel: "Dodavatel / náš tým",
          source: "manual",
          tokenCount: 2
        }
      ]
    );

    expect(context.total_tokens_seen).toBe(3);
    expect(context.truncated).toBe(false);
    expect(context.segments).toEqual([
      {
        end_time: "00:00:00",
        speaker_id: "1",
        speaker_label: "Mira",
        start_time: "00:00:00",
        text: "Dobrý den."
      },
      {
        end_time: "00:00:00",
        speaker_id: "2",
        speaker_label: "Mluvčí 2",
        start_time: "00:00:00",
        text: "Dobrý den."
      }
    ]);
  });
});
