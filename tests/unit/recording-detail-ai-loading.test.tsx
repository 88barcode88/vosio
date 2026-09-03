import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("recording detail AI loading", () => {
  it("does not put AI output or projection queries on the server detail critical path", () => {
    const page = readFileSync("app/recordings/[recordingId]/page.tsx", "utf8");

    expect(page).not.toContain("listAiOutputsForTranscripts");
    expect(page).not.toContain("listStructuredAiItemsForTranscripts");
    expect(page).not.toMatch(/await\s+.*ai(Output|State|Structured)/i);
  });

  it("starts the detail shell with lazy AI state and loads older bodies only on demand", () => {
    const workspace = readFileSync("src/components/workspace/recording-workbench.tsx", "utf8");
    const aiContent = readFileSync("src/components/transcript-tabs/ai-processing-content.tsx", "utf8");
    const exportControls = readFileSync("src/components/transcript-tabs/export-controls.tsx", "utf8");

    expect(workspace).toContain("TranscriptAiStateProvider");
    expect(aiContent).toContain("loadOutput");
    expect(exportControls).toContain("loadAllOutputs");
  });

  it("keeps the 25-output navigation fixture lazy and exposes every durable job state", () => {
    const fixture = readFileSync("app/login/recording-layout-e2e/page.tsx", "utf8");
    const spec = readFileSync("tests/e2e/recording-detail-layout.spec.ts", "utf8");

    expect(fixture).toContain('"ai-many"');
    expect(fixture).toContain('mode === "ai-many" ? [] : fixtureAiOutputs');
    expect(spec).toContain("Array.from({ length: 25 }");
    expect(spec).toContain("ai-state");
    expect(spec).toContain("api/ai-outputs");
    expect(spec).toContain("25 výstupů");
    expect(spec).toContain("Trvá déle než obvykle");
  });
});
