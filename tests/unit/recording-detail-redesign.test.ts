import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workbenchSource = readFileSync(
  join(process.cwd(), "src", "components", "workspace", "recording-workbench.tsx"),
  "utf8"
);
const workspaceSource = readFileSync(
  join(process.cwd(), "src", "components", "vosio-workspace.tsx"),
  "utf8"
);
const transcriptSource = readFileSync(
  join(process.cwd(), "src", "components", "transcript-tabs.tsx"),
  "utf8"
);
const workspaceCss = readFileSync(join(process.cwd(), "app", "styles", "workspace.css"), "utf8");
const transcriptCss = readFileSync(join(process.cwd(), "app", "styles", "transcript.css"), "utf8");
const timelineCss = readFileSync(join(process.cwd(), "app", "styles", "timeline-ai-output.css"), "utf8");
const appicaWorkflowCss = readFileSync(
  join(process.cwd(), "app", "styles", "appica-workflow.css"),
  "utf8"
);

describe("Appica recording detail contract", () => {
  it("uses a full-width detail document with a back link and no dominant right rail", () => {
    expect(workbenchSource).toContain('href="/recordings"');
    expect(workbenchSource).toContain("Zpět na nahrávky");
    expect(workbenchSource).not.toContain('className="recording-rail"');
    expect(workspaceSource).toContain('return "content-area content-area-document"');
    expect(workspaceCss).toMatch(/\.recording-workbench\s*\{[\s\S]*?height:\s*auto;/);
  });

  it("keeps export and transcription operations in the header before player and tabs", () => {
    expect(workbenchSource).not.toContain('className="recording-detail-operations"');
    expect(workbenchSource).toContain("<ExportControls");
    expect(workbenchSource).toContain("<CommandBar");
    expect(workbenchSource.indexOf("<RecordingCard"))
      .toBeLessThan(workbenchSource.indexOf("<TranscriptPanel"));
    expect(transcriptSource).not.toContain("<ExportControls");
  });

  it("keeps player and exact tabs together above the active long document", () => {
    expect(transcriptSource.indexOf("<RecordingAudioPlayer"))
      .toBeLessThan(transcriptSource.indexOf('className="tabs-row"'));
    expect(transcriptSource).toContain('className="recording-detail-sticky"');
    expect(transcriptSource).toContain('aria-label="Přehrávač a záložky detailu"');
    expect(transcriptCss).toMatch(/\.recording-detail-sticky\s*\{[\s\S]*?position:\s*sticky;/);
    expect(transcriptCss).toMatch(/\.transcript-table-scroll\s*\{[\s\S]*?overflow:\s*visible;/);
  });

  it("applies the neutral compact hierarchy without adding nested document scroll", () => {
    expect(workbenchSource).toContain('aria-label="Informace a akce nahrávky"');
    expect(appicaWorkflowCss).toMatch(/\.recording-object-header\s*\{[\s\S]*?border-radius:\s*6px;/);
    expect(appicaWorkflowCss).toMatch(/\.recording-detail-sticky\s*\{[\s\S]*?position:\s*sticky;/);
    expect(appicaWorkflowCss).toMatch(/\.tab-panel\s*\{[\s\S]*?overflow:\s*visible;/);
    expect(appicaWorkflowCss).toMatch(/\.transcript-table-scroll\s*\{[\s\S]*?overflow:\s*visible;/);
  });

  it("keeps speaker autosave feedback inside the full-width one-scroll detail", () => {
    expect(workbenchSource).not.toContain('className="recording-rail"');
    expect(workspaceCss).toMatch(/\.recording-workbench\s*\{[\s\S]*?width:\s*100%;/);
    expect(transcriptCss).toMatch(/\.transcript-table-scroll\s*\{[\s\S]*?overflow:\s*visible;/);
    expect(transcriptCss).toMatch(/\.speaker-summary-feedback\s*\{[\s\S]*?min-height:\s*20px;/);
    expect(transcriptCss).not.toMatch(/\.transcript-panel\s*\{[^}]*max-width:/);
    expect(transcriptCss).not.toMatch(/\.transcript-table-scroll\s*\{[^}]*overflow-y:\s*(auto|scroll)/);
  });

  it("keeps player and task icon controls at least 44px touch-safe", () => {
    expect(transcriptCss).toMatch(/\.recording-audio-toggle\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
    expect(transcriptCss).toMatch(/\.recording-audio-progress input\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(timelineCss).toMatch(/\.structured-task-row > button\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
    expect(timelineCss).toMatch(/\.structured-task-row > \.structured-task-delete\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
    expect(workspaceCss).toMatch(/\.recording-detail-back\s*\{[\s\S]*?min-height:\s*44px;/);
  });
});
