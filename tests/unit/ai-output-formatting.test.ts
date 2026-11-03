import { describe, expect, it } from "vitest";
import { getAiOutputSummary } from "@/components/transcript-tabs/ai-output-formatting";
import type { AiOutputView } from "@/lib/ai/types";

// buildOutput creates a minimal saved AI output with the given markdown text.
function buildOutput(text: string): AiOutputView {
  return { output_text: text, output_json: null } as unknown as AiOutputView;
}

describe("getAiOutputSummary", () => {
  it("strips markdown markers from the collapsed one-line preview", () => {
    const summary = getAiOutputSummary(buildOutput("# Úkoly\n\n## Moje práce\n\n- [ ] **M1 – Mluvčí 2:** Zavolat `klientovi`\n> Důkaz: \"Domluvím schůzku.\"\n1. Druhý bod"));
    expect(summary).toBe("Úkoly Moje práce M1 – Mluvčí 2: Zavolat klientovi Důkaz: \"Domluvím schůzku.\" Druhý bod");
  });

  it("keeps hyphens and time ranges inside sentences", () => {
    expect(getAiOutputSummary(buildOutput("Kapitola 00:00 - 00:06 a e-mail"))).toBe("Kapitola 00:00 - 00:06 a e-mail");
  });
});
