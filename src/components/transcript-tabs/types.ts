import type { AiOutputView } from "@/lib/ai/types";

export type TranscriptTab = "transcript" | "ai" | "timeline" | "files" | "chat";

export type TranscriptSpeakerBlock = {
  anchorId: string;
  endMs: number | null;
  label: string;
  speakerId: string | null;
  speakerClassName: string;
  speakerLabel: string;
  startMs: number | null;
  text: string;
};

export type TranscriptTarget = {
  anchorId?: string;
  endMs?: number | null;
  highlightText?: string | null;
  playback: "none" | "play" | "seek";
  startMs: number | null;
  transcriptId: string;
};

export type TranscriptEvidenceReference = {
  endMs: number | null;
  quote: string;
  startMs: number | null;
  transcriptId: string;
};

export type TimelineChapter = {
  decisions: string[];
  end: string | null;
  relatedActionItems: string[];
  speakers: string[];
  start: string | null;
  summary: string;
  title: string;
};

export type AiMarkdownLine =
  | { kind: "bullet" | "heading" | "paragraph"; text: string }
  | { kind: "table"; rows: string[][] };

export type ExportTarget =
  | { id: "recording"; label: string; type: "recording" }
  | { id: "workspace"; label: string; type: "workspace" }
  | { id: "transcript"; label: string; type: "transcript" }
  | { id: string; label: string; output?: AiOutputView; type: "ai_output" };
