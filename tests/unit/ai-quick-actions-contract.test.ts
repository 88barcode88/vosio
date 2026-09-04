import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { quickActions } from "@/lib/workspace-data";

const controlsSource = readFileSync("src/components/ai-processing-controls.tsx", "utf8");
const runHookSource = readFileSync("src/components/transcript-tabs/use-ai-processing-run.ts", "utf8");
const routeSource = readFileSync("app/api/transcripts/[transcriptId]/process/route.ts", "utf8");
const architectureSource = readFileSync("docs/architecture.md", "utf8");

describe("AI quick action contract", () => {
  it("keeps exactly the six existing actions", () => {
    expect(quickActions.map(({ label, processingType }) => ({ label, processingType }))).toEqual([
      { label: "Shrnutí", processingType: "summary" },
      { label: "Úkoly", processingType: "action_items" },
      { label: "Časová osa", processingType: "timeline_chapters" },
      { label: "Zápis ze schůzky", processingType: "meeting_minutes" },
      { label: "CRM poznámka", processingType: "crm_note" },
      { label: "E-mail po hovoru", processingType: "follow_up_email" },
    ]);
  });

  it("keeps the browser request prompt-agnostic", () => {
    expect(controlsSource).toContain("processing.run({ model, processingType })");
    expect(runHookSource).toContain("body: JSON.stringify({ ...input, requestId })");
    expect(controlsSource).not.toContain("promptId");
    expect(controlsSource).not.toContain("overrideId");
    expect(runHookSource).not.toContain("promptId");
    expect(runHookSource).not.toContain("overrideId");
    expect(routeSource).not.toContain("customPrompt");
    expect(routeSource).not.toContain("promptId");
  });

  it("documents the six-action effective prompt runtime without a custom prompt workflow", () => {
    expect(architectureSource).toContain("přesně jeden ze šesti quick-action typů");
    expect(architectureSource).toContain("serverový resolver vybere efektivní text");
    expect(architectureSource).not.toContain("processing type nebo custom prompt");
  });
});
