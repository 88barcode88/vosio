import type { AiArchiveItem } from "@/lib/ai/types";

export const AI_ARCHIVE_PROCESSING_TYPES = [
  "summary",
  "action_items",
  "meeting_minutes",
  "timeline_chapters",
  "structured_extraction",
  "crm_note",
  "follow_up_email",
  "custom_prompt"
] as const;

export type AiArchiveFilters = {
  processingType: string | null;
  recordingId: string | null;
};

const aiArchiveActionAlerts = {
  ai_output_delete_failed: "AI výstup se nepodařilo smazat. Zkuste to znovu.",
  invalid_ai_output_delete: "Požadavek na smazání AI výstupu není platný."
} as const;

// createAiArchiveSearchParams preserves duplicate query values for strict canonicalization.
export function createAiArchiveSearchParams(input: Record<string, string | string[] | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(input)) {
    for (const item of Array.isArray(value) ? value : typeof value === "string" ? [value] : []) {
      searchParams.append(key, item);
    }
  }

  return searchParams;
}

// canonicalizeAiArchiveSearchParams accepts only one supported type and one joined recording id.
export function canonicalizeAiArchiveSearchParams(
  current: URLSearchParams,
  knownRecordingIds: Set<string>
) {
  const searchParams = new URLSearchParams(current);
  const typeValues = current.getAll("type");
  const recordingValues = current.getAll("recording");
  const errorValues = current.getAll("error");
  const processingType = typeValues.length === 1
    && AI_ARCHIVE_PROCESSING_TYPES.some((value) => value === typeValues[0])
    ? typeValues[0]!
    : null;
  const recordingId = recordingValues.length === 1 && knownRecordingIds.has(recordingValues[0]!)
    ? recordingValues[0]!
    : null;
  const typeValid = typeValues.length === 0 || processingType !== null;
  const recordingValid = recordingValues.length === 0 || recordingId !== null;
  const actionErrorCode = errorValues.length === 1
    && Object.hasOwn(aiArchiveActionAlerts, errorValues[0])
    ? errorValues[0] as keyof typeof aiArchiveActionAlerts
    : null;
  const actionAlert = actionErrorCode ? aiArchiveActionAlerts[actionErrorCode] : null;
  const errorValid = errorValues.length === 0 || actionAlert !== null;

  if (!typeValid) searchParams.delete("type");
  if (!recordingValid) searchParams.delete("recording");
  if (!errorValid) searchParams.delete("error");

  return {
    actionAlert,
    changed: !typeValid || !recordingValid || !errorValid,
    filters: { processingType, recordingId } satisfies AiArchiveFilters,
    searchParams
  };
}

// filterAiArchiveItems applies the canonical archive filters without mutating joined rows.
export function filterAiArchiveItems(items: AiArchiveItem[], filters: AiArchiveFilters) {
  return items.filter((item) => (
    (!filters.processingType || item.processing_type === filters.processingType)
    && (!filters.recordingId || item.recording.id === filters.recordingId)
  ));
}

// buildAiArchiveHref changes one filter while preserving the other canonical archive value.
export function buildAiArchiveHref(
  current: URLSearchParams,
  patch: { processingType?: string | null; recordingId?: string | null }
) {
  const searchParams = new URLSearchParams(current);

  if ("processingType" in patch) {
    if (patch.processingType) searchParams.set("type", patch.processingType);
    else searchParams.delete("type");
  }
  if ("recordingId" in patch) {
    if (patch.recordingId) searchParams.set("recording", patch.recordingId);
    else searchParams.delete("recording");
  }

  const query = searchParams.toString();
  return `/ai${query ? `?${query}` : ""}`;
}
