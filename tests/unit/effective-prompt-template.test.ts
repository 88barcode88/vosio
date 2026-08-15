import { describe, expect, it } from "vitest";
import { mapEffectivePromptRow } from "@/lib/prompt-templates/effective";

describe("effective prompt rows", () => {
  it("maps an active text override without changing system identity or schema", () => {
    expect(mapEffectivePromptRow({
      name: "System action items",
      output_schema: { type: "object" },
      override_id: "00000000-0000-4000-8000-000000000002",
      processing_type: "action_items",
      prompt_text: "Upravený prompt s dostatečnou délkou.",
      revision: 4,
      source: "user_override",
      system_prompt_id: "00000000-0000-4000-8000-000000000001",
    })).toMatchObject({
      isModified: true,
      processingType: "action_items",
      revision: 4,
      outputSchema: { type: "object" },
    });
  });

  it("maps a system fallback with revision zero", () => {
    expect(mapEffectivePromptRow({
      name: "System summary",
      output_schema: null,
      override_id: null,
      processing_type: "summary",
      prompt_text: "Výchozí prompt s dostatečnou délkou.",
      revision: null,
      source: "system",
      system_prompt_id: "00000000-0000-4000-8000-000000000003",
    })).toMatchObject({ isModified: false, overrideId: null, revision: 0 });
  });
});
