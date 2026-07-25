import type { AiOutputView } from "@/lib/ai/types";
import type {
  StructuredAiItems,
  StructuredChapterRow,
  StructuredDecisionRow,
  StructuredRiskRow,
  StructuredTaskRow
} from "@/lib/ai/structured-types";
import type { RecordingRow } from "@/lib/recordings/types";
import { formatFileSize, formatRecordingDate } from "@/lib/recordings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";
import type { ExportTarget } from "@/components/transcript-tabs/types";
import {
  getAiOutputMarkdownText,
  getAiOutputTitle
} from "@/components/transcript-tabs/ai-output-formatting";

// getSafeFilename converts a title into a stable markdown filename.
export function getSafeFilename(title: string) {
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized || "vosio-export";
}

// downloadMarkdownFile downloads generated markdown without sending data to a server.
export function downloadMarkdownFile(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${getSafeFilename(filename)}.md`;
  link.click();
  window.URL.revokeObjectURL(url);
}

// copyTextToClipboard writes visible export content into the user's clipboard.
export async function copyTextToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

// createMailtoHref builds a system-mail-client link for follow-up email drafts.
export function createMailtoHref(subject: string, body: string) {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// hasStructuredWorkspaceItems checks whether an export can include normalized AI workspace rows.
function hasStructuredWorkspaceItems(items: StructuredAiItems) {
  return items.tasks.length > 0 || items.chapters.length > 0 || items.decisions.length > 0 || items.risks.length > 0;
}

// formatMaybeList renders array-like JSON fields into concise Markdown text.
function formatMaybeList(value: unknown[]) {
  const values = value
    .map((item) => typeof item === "string" ? item : null)
    .filter((item): item is string => Boolean(item));

  return values.length > 0 ? values.join(", ") : "neuvedeno";
}

// formatOptionalDetail joins optional row metadata without adding empty Markdown noise.
function formatOptionalDetail(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
}

// formatStructuredTaskLine renders one persisted checklist row for export packages.
function formatStructuredTaskLine(task: StructuredTaskRow) {
  const checked = task.status === "done" ? "x" : " ";
  const details = formatOptionalDetail([
    task.owner_category,
    task.owner_name,
    task.deadline ? `termín: ${task.deadline}` : null,
    task.status !== "new" ? `stav: ${task.status}` : null
  ]);
  const evidence = task.evidence_quote ? `\n  Důkaz: "${task.evidence_quote}"` : "";

  return `- [${checked}] ${task.title}${details ? ` (${details})` : ""}${evidence}`;
}

// buildStructuredChecklistMarkdown renders only persisted checklist tasks for focused export and clipboard actions.
export function buildStructuredChecklistMarkdown(tasks: StructuredTaskRow[]) {
  const taskGroups = [
    { label: "Moje práce", rows: tasks.filter((task) => task.owner_category === "Moje práce") },
    { label: "Klient", rows: tasks.filter((task) => task.owner_category === "Klient") },
    { label: "Nejasné", rows: tasks.filter((task) => task.owner_category === "Nejasné") }
  ];

  return [
    "## Checklist",
    ...taskGroups.map((group) => [
      `### ${group.label}`,
      group.rows.length > 0 ? group.rows.map(formatStructuredTaskLine).join("\n") : "- Žádné."
    ].join("\n"))
  ].join("\n\n");
}

// formatStructuredChapter renders one AI timeline chapter into a compact Markdown block.
function formatStructuredChapter(chapter: StructuredChapterRow) {
  const range = formatOptionalDetail([chapter.start_time, chapter.end_time]) || "bez času";
  const topics = formatMaybeList(chapter.topics);
  const speakers = formatMaybeList(chapter.speakers);

  return [
    `### ${range} — ${chapter.title}`,
    chapter.summary ? `- Shrnutí: ${chapter.summary}` : null,
    `- Témata: ${topics}`,
    `- Mluvčí: ${speakers}`
  ].filter(Boolean).join("\n");
}

// formatStructuredDecisionLine renders one stored decision or confirmation row.
function formatStructuredDecisionLine(decision: StructuredDecisionRow) {
  const details = formatOptionalDetail([
    decision.status ? `stav: ${decision.status}` : null,
    decision.owner_category,
    decision.owner_role
  ]);
  const evidence = decision.evidence_quote ? `\n  Důkaz: "${decision.evidence_quote}"` : "";

  return `- ${decision.title}${details ? ` (${details})` : ""}${evidence}`;
}

// formatStructuredRiskLine renders one stored risk or blocker row.
function formatStructuredRiskLine(risk: StructuredRiskRow) {
  const details = formatOptionalDetail([
    risk.owner_category,
    risk.owner_role,
    risk.impact ? `dopad: ${risk.impact}` : null,
    risk.mitigation ? `řešení: ${risk.mitigation}` : null
  ]);

  return `- ${risk.title}${details ? ` (${details})` : ""}`;
}

// buildStructuredWorkspaceMarkdown renders normalized AI rows for the workspace export package.
export function buildStructuredWorkspaceMarkdown(items: StructuredAiItems) {
  const tasksMarkdown = buildStructuredChecklistMarkdown(items.tasks).replace(/^## Checklist\n\n/, "");
  const chaptersMarkdown = items.chapters.length > 0
    ? items.chapters.map(formatStructuredChapter).join("\n\n")
    : "- Žádné.";
  const decisionsMarkdown = items.decisions.length > 0
    ? items.decisions.map(formatStructuredDecisionLine).join("\n")
    : "- Žádné.";
  const risksMarkdown = items.risks.length > 0
    ? items.risks.map(formatStructuredRiskLine).join("\n")
    : "- Žádné.";

  return [
    "## Checklist",
    tasksMarkdown,
    "## Časová osa",
    chaptersMarkdown,
    "## Rozhodnutí",
    decisionsMarkdown,
    "## Rizika / blokery",
    risksMarkdown
  ].join("\n\n");
}

// buildRecordingExportMarkdown combines recording metadata, transcript, and AI outputs.
export function buildRecordingExportMarkdown(
  activeRecording: RecordingRow | null,
  activeTranscript: TranscriptRow | null,
  aiOutputs: AiOutputView[]
) {
  const title = activeRecording?.title ?? "Vosio nahrávka";
  const metadata = [
    `- Datum: ${activeRecording ? formatRecordingDate(activeRecording.created_at) : "bez data"}`,
    `- Stav: ${activeRecording?.status ?? "bez nahrávky"}`,
    `- Zdroj: ${activeRecording?.source_type ?? "bez zdroje"}`,
    `- Velikost: ${formatFileSize(activeRecording?.file_size_bytes ?? null)}`
  ];
  const transcript = activeTranscript?.raw_text?.trim()
    ? activeTranscript.raw_text.trim()
    : "Přepis zatím není uložený.";
  const outputs = aiOutputs.length > 0
    ? aiOutputs.map((output) => getAiOutputMarkdownText(output)).join("\n\n---\n\n")
    : "Zatím nejsou uložené žádné AI výstupy.";

  return `# ${title}\n\n${metadata.join("\n")}\n\n## Přepis\n\n${transcript}\n\n## AI výstupy\n\n${outputs}\n`;
}

// buildWorkspaceExportMarkdown creates a complete working package for handoff or review.
export function buildWorkspaceExportMarkdown(
  activeRecording: RecordingRow | null,
  activeTranscript: TranscriptRow | null,
  aiOutputs: AiOutputView[],
  structuredItems: StructuredAiItems
) {
  const recordingMarkdown = buildRecordingExportMarkdown(activeRecording, activeTranscript, aiOutputs);
  const workspaceMarkdown = hasStructuredWorkspaceItems(structuredItems)
    ? buildStructuredWorkspaceMarkdown(structuredItems)
    : "## Pracovní data\n\nZatím nejsou uložené žádné strukturované úkoly, kapitoly, rozhodnutí ani rizika.";

  return `${recordingMarkdown}\n---\n\n${workspaceMarkdown}\n`;
}

// getExportTargets returns available export choices for the current recording detail.
export function getExportTargets(
  activeTranscript: TranscriptRow | null,
  aiOutputs: AiOutputView[],
  structuredItems: StructuredAiItems
): ExportTarget[] {
  const canExportWorkspace = Boolean(activeTranscript || aiOutputs.length > 0 || hasStructuredWorkspaceItems(structuredItems));

  return [
    { id: "recording", label: "Celá nahrávka", type: "recording" },
    ...(canExportWorkspace ? [{ id: "workspace", label: "Pracovní balíček", type: "workspace" } as const] : []),
    ...(activeTranscript ? [{ id: "transcript", label: "Jen přepis", type: "transcript" } as const] : []),
    ...aiOutputs.map((output) => ({
      id: output.id,
      label: `AI: ${getAiOutputTitle(output.processing_type)} · ${formatRecordingDate(output.created_at)}`,
      output,
      type: "ai_output" as const
    }))
  ];
}

// getExportMarkdown resolves the selected export choice into markdown text.
export function getExportMarkdown(
  target: ExportTarget,
  activeRecording: RecordingRow | null,
  activeTranscript: TranscriptRow | null,
  aiOutputs: AiOutputView[],
  structuredItems: StructuredAiItems
) {
  if (target.type === "recording") {
    return buildRecordingExportMarkdown(activeRecording, activeTranscript, aiOutputs);
  }

  if (target.type === "transcript") {
    return `# Přepis\n\n${activeTranscript?.raw_text?.trim() ?? "Přepis zatím není uložený."}\n`;
  }

  if (target.type === "workspace") {
    return buildWorkspaceExportMarkdown(activeRecording, activeTranscript, aiOutputs, structuredItems);
  }

  if (target.type === "ai_output") {
    return getAiOutputMarkdownText(target.output);
  }

  const exhaustiveTarget: never = target;

  return exhaustiveTarget;
}
