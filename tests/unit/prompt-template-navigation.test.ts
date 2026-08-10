import { describe, expect, it } from "vitest";
import { canonicalizePromptTemplateSearchParams } from "@/lib/prompt-templates/navigation";

const ownId = "00000000-0000-4000-8000-000000000501";
const systemId = "00000000-0000-4000-8000-000000000502";

describe("prompt template URL state", () => {
  it("accepts one known template or the explicit create mode", () => {
    const selected = canonicalizePromptTemplateSearchParams(
      new URLSearchParams({ template: ownId }),
      new Set([ownId, systemId])
    );
    const create = canonicalizePromptTemplateSearchParams(
      new URLSearchParams({ mode: "create" }),
      new Set([ownId, systemId])
    );

    expect(selected).toMatchObject({ changed: false, state: { kind: "selected", templateId: ownId } });
    expect(create).toMatchObject({ changed: false, state: { kind: "create" } });
  });

  it("canonicalizes duplicate, conflicting and unknown values to the list surface", () => {
    for (const params of [
      new URLSearchParams(`template=${ownId}&template=${systemId}`),
      new URLSearchParams(`template=${ownId}&mode=create`),
      new URLSearchParams("template=00000000-0000-4000-8000-000000000599"),
      new URLSearchParams("mode=edit")
    ]) {
      const result = canonicalizePromptTemplateSearchParams(params, new Set([ownId, systemId]));
      expect(result.changed).toBe(true);
      expect(result.state).toEqual({ kind: "list" });
      expect(result.searchParams.has("template")).toBe(false);
      expect(result.searchParams.has("mode")).toBe(false);
    }
  });

  it("preserves unrelated safe feedback params during canonicalization", () => {
    const params = new URLSearchParams(`template=${ownId}&template=${systemId}&error=save_failed`);
    const result = canonicalizePromptTemplateSearchParams(params, new Set([ownId, systemId]));

    expect(result.searchParams.get("error")).toBe("save_failed");
  });
});
