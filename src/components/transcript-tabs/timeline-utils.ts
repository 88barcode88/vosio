import type { AiOutputView } from "@/lib/ai/types";
import type { StructuredChapterRow } from "@/lib/ai/structured-types";
import type { TimelineChapter } from "@/components/transcript-tabs/types";

// getStringField safely reads optional string fields from AI JSON payloads.
function getStringField(input: unknown, keys: string[]) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const source = input as Record<string, unknown>;
  const value = keys.map((key) => source[key]).find((candidate) => typeof candidate === "string");

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// getStringArrayField safely reads optional string array fields from AI JSON payloads.
function getStringArrayField(input: unknown, keys: string[]) {
  if (!input || typeof input !== "object") {
    return [];
  }

  const source = input as Record<string, unknown>;
  const value = keys.map((key) => source[key]).find(Array.isArray);

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

// getTimelineChapters extracts AI-generated topic chapters from saved output JSON.
export function getTimelineChapters(output: AiOutputView | undefined): TimelineChapter[] {
  if (!output?.output_json || typeof output.output_json !== "object") {
    return [];
  }

  const root = output.output_json as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  const chapters = data.chapters ?? data.timeline_chapters ?? data.timeline ?? [];

  if (!Array.isArray(chapters)) {
    return [];
  }

  return chapters
    .map((chapter) => ({
      decisions: getStringArrayField(chapter, ["decisions", "related_decisions"]),
      end: getStringField(chapter, ["end", "end_time", "time_end"]),
      relatedActionItems: getStringArrayField(chapter, ["related_action_items", "action_items"]),
      speakers: getStringArrayField(chapter, ["speakers", "related_speakers"]),
      start: getStringField(chapter, ["start", "start_time", "time_start"]),
      summary: getStringField(chapter, ["summary", "description"]) ?? "Bez shrnutí.",
      title: getStringField(chapter, ["title", "topic", "name"]) ?? "Kapitola"
    }))
    .filter((chapter) => chapter.title || chapter.summary);
}

// getPersistedTimelineChapters converts stored chapter rows into the UI timeline shape.
export function getPersistedTimelineChapters(chapters: StructuredChapterRow[]): TimelineChapter[] {
  return chapters.map((chapter) => ({
    decisions: [],
    end: chapter.end_time,
    relatedActionItems: [],
    speakers: chapter.speakers.filter((speaker): speaker is string => typeof speaker === "string"),
    start: chapter.start_time,
    summary: chapter.summary ?? "Bez shrnutí.",
    title: chapter.title
  }));
}

// getPreferredTimelineChapters prefers stored chapter rows and falls back to legacy AI output JSON.
export function getPreferredTimelineChapters(input: {
  aiOutputs: AiOutputView[];
  persistedChapters: StructuredChapterRow[];
}) {
  if (input.persistedChapters.length > 0) {
    return getPersistedTimelineChapters(input.persistedChapters);
  }

  return getTimelineChapters(getTimelineOutput(input.aiOutputs));
}

// getTimelineOutput finds the saved AI output dedicated to timeline chapters.
export function getTimelineOutput(aiOutputs: AiOutputView[]) {
  return aiOutputs.find((output) => output.processing_type === "timeline_chapters");
}

// getTimelineRangeLabel renders the visible time range for an AI timeline chapter.
export function getTimelineRangeLabel(chapter: TimelineChapter) {
  if (chapter.start && chapter.end) {
    return `${chapter.start} - ${chapter.end}`;
  }

  return chapter.start ?? chapter.end ?? "bez času";
}

// getTimelineChapterMeta summarizes chapter metadata without forcing dense prose into the card.
export function getTimelineChapterMeta(chapter: TimelineChapter) {
  return [
    chapter.speakers.length > 0 ? `${chapter.speakers.length} mluvčí` : null,
    chapter.relatedActionItems.length > 0 ? `${chapter.relatedActionItems.length} úkolů` : null,
    chapter.decisions.length > 0 ? `${chapter.decisions.length} rozhodnutí` : null
  ].filter(Boolean).join(" · ");
}
