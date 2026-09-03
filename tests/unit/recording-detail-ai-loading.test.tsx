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
});
