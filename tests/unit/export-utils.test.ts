import { describe, expect, it } from "vitest";
import {
  buildStructuredChecklistMarkdown,
  buildStructuredWorkspaceMarkdown,
  getExportMarkdown,
  getExportTargets
} from "@/components/transcript-tabs/export-utils";
import type { AiOutputView } from "@/lib/ai/types";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { RecordingClientView } from "@/lib/recordings/client-view";
import type { TranscriptRow } from "@/lib/transcripts/types";

const createdAt = "2026-05-24T09:00:00.000Z";

const recording: RecordingClientView = {
  audioAvailability: "single",
  created_at: createdAt,
  duration_seconds: 120,
  file_size_bytes: 1024,
  id: "recording-1",
  mime_type: "audio/mp4",
  source_type: "upload",
  status: "completed",
  title: "Call s klientem",
  updated_at: createdAt,
};

const transcript: TranscriptRow = {
  created_at: createdAt,
  id: "transcript-1",
  language: "cs",
  raw_text: "Klient pošle podklady. My připravíme export.",
  recording_id: "recording-1",
  segments: [],
  speakers: [],
  transcription_job_id: "job-1",
  user_id: "user-1"
};

const aiOutput: AiOutputView = {
  created_at: createdAt,
  id: "output-1",
  output_json: { markdown: "## Shrnutí\n\nKrátké shrnutí callu." },
  output_text: null,
  processing_job_id: "job-1",
  processing_type: "summary",
  transcript_id: "transcript-1",
  user_id: "user-1"
};

const emptyStructuredItems: StructuredAiItems = {
  chapters: [],
  decisions: [],
  risks: [],
  tasks: []
};

const structuredItems: StructuredAiItems = {
  chapters: [
    {
      ai_output_id: "output-2",
      confidence: "high",
      dominant_roles: ["client_customer"],
      end_time: "00:05:00",
      position: 1,
      processing_job_id: "job-2",
      raw_item: {},
      source_type: "explicit",
      speakers: ["Mluvčí 1"],
      start_time: "00:00:00",
      summary: "Probírala se integrace.",
      title: "Integrace CRM",
      topics: ["CRM"],
      transcript_id: "transcript-1",
      user_id: "user-1"
    }
  ],
  decisions: [
    {
      ai_output_id: "output-2",
      evidence_quote: "půjdeme tímto směrem",
      id: "decision-1",
      evidence_end_ms: null,
      evidence_start_ms: null,
      owner_category: "Moje práce",
      owner_role: "delivery_team",
      position: 1,
      processing_job_id: "job-2",
      raw_item: {},
      source_type: "explicit",
      status: "decided",
      title: "Použije se exportní balíček",
      transcript_id: "transcript-1",
      user_id: "user-1"
    }
  ],
  risks: [
    {
      ai_output_id: "output-2",
      id: "risk-1",
      evidence_end_ms: null,
      evidence_quote: null,
      evidence_start_ms: null,
      impact: "Zdržení předání",
      mitigation: "Doplnit chybějící data",
      owner_category: "Klient",
      owner_role: "client_customer",
      position: 1,
      processing_job_id: "job-2",
      raw_item: {},
      source_type: "inferred",
      title: "Chybějící podklady",
      transcript_id: "transcript-1",
      user_id: "user-1"
    }
  ],
  tasks: [
    {
      ai_output_id: "output-2",
      deadline: "příští týden",
      deadline_confidence: "uncertain",
      deadline_normalized: null,
      description: "Klient má dodat vstupní soubory.",
      evidence_quote: "pošlete nám podklady",
      id: "task-1",
      evidence_end_ms: null,
      evidence_start_ms: null,
      owner_category: "Klient",
      owner_name: "Klient",
      position: 1,
      processing_job_id: "job-2",
      raw_item: {},
      source_type: "explicit",
      status: "done",
      title: "Poslat podklady",
      transcript_id: "transcript-1",
      user_id: "user-1"
    },
    {
      ai_output_id: "output-2",
      deadline: null,
      deadline_confidence: null,
      deadline_normalized: null,
      description: null,
      evidence_quote: "připravíme export",
      id: "task-2",
      evidence_end_ms: null,
      evidence_start_ms: null,
      owner_category: "Moje práce",
      owner_name: "Míra",
      position: 2,
      processing_job_id: "job-2",
      raw_item: {},
      source_type: "explicit",
      status: "new",
      title: "Připravit export",
      transcript_id: "transcript-1",
      user_id: "user-1"
    }
  ]
};

describe("export utils", () => {
  it("offers a workspace export without changing existing export targets", () => {
    const targets = getExportTargets(transcript, [aiOutput], structuredItems);

    expect(targets.map((target) => target.type)).toEqual(["recording", "workspace", "transcript", "ai_output"]);
    expect(targets.find((target) => target.type === "workspace")).toMatchObject({
      id: "workspace",
      label: "Pracovní balíček"
    });
  });

  it("keeps existing transcript and AI output exports focused", () => {
    const transcriptMarkdown = getExportMarkdown(
      { id: "transcript", label: "Jen přepis", type: "transcript" },
      recording,
      transcript,
      [aiOutput],
      structuredItems
    );
    const aiMarkdown = getExportMarkdown(
      { id: aiOutput.id, label: "AI: Shrnutí", output: aiOutput, type: "ai_output" },
      recording,
      transcript,
      [aiOutput],
      structuredItems
    );

    expect(transcriptMarkdown).toBe("# Přepis\n\nKlient pošle podklady. My připravíme export.\n");
    expect(aiMarkdown).toContain("# Shrnutí");
    expect(aiMarkdown).toContain("Krátké shrnutí callu.");
  });

  it("exports structured workspace rows from persisted checklist data", () => {
    const markdown = getExportMarkdown(
      { id: "workspace", label: "Pracovní balíček", type: "workspace" },
      recording,
      transcript,
      [aiOutput],
      structuredItems
    );

    expect(markdown).toContain("# Call s klientem");
    expect(markdown).toContain("## Checklist");
    expect(markdown).toContain("- [x] Poslat podklady");
    expect(markdown).toContain("- [ ] Připravit export");
    expect(markdown).toContain("## Časová osa");
    expect(markdown).toContain("00:00:00 · 00:05:00 — Integrace CRM");
    expect(markdown).toContain("## Rozhodnutí");
    expect(markdown).toContain("Použije se exportní balíček");
    expect(markdown).toContain("## Rizika / blokery");
    expect(markdown).toContain("Chybějící podklady");
  });

  it("exports only the checklist when users copy or download structured tasks", () => {
    const markdown = buildStructuredChecklistMarkdown(structuredItems.tasks);

    expect(markdown).toContain("## Checklist");
    expect(markdown).toContain("### Moje práce");
    expect(markdown).toContain("- [ ] Připravit export");
    expect(markdown).toContain("### Klient");
    expect(markdown).toContain("- [x] Poslat podklady");
    expect(markdown).not.toContain("## Časová osa");
    expect(markdown).not.toContain("## Rozhodnutí");
  });

  it("renders empty structured workspace sections predictably", () => {
    const markdown = buildStructuredWorkspaceMarkdown(emptyStructuredItems);

    expect(markdown).toContain("## Checklist");
    expect(markdown).toContain("### Moje práce\n- Žádné.");
    expect(markdown).toContain("## Časová osa\n\n- Žádné.");
    expect(markdown).toContain("## Rozhodnutí\n\n- Žádné.");
    expect(markdown).toContain("## Rizika / blokery\n\n- Žádné.");
  });
});
