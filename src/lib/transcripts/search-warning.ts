export const TRANSCRIPT_SEARCH_INDEX_WARNING = "transcript_search_index_incomplete" as const;

export const TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE =
  "Přepis je uložený. Přesné hledání v jednotlivých pasážích zatím není úplné, proto se použije základní hledání v celém přepisu.";

type WarningPayload = {
  warnings?: unknown;
};

// hasTranscriptSearchIndexWarning recognizes the stable warning without rejecting unknown warnings.
export function hasTranscriptSearchIndexWarning(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const warnings = (payload as WarningPayload).warnings;

  return Array.isArray(warnings) && warnings.includes(TRANSCRIPT_SEARCH_INDEX_WARNING);
}

// isTranscriptSearchIndexWarningCode accepts one URL search-param value or Next.js value array.
export function isTranscriptSearchIndexWarningCode(value: unknown) {
  return Array.isArray(value)
    ? value.includes(TRANSCRIPT_SEARCH_INDEX_WARNING)
    : value === TRANSCRIPT_SEARCH_INDEX_WARNING;
}

// addTranscriptSearchIndexWarningToPath carries a nonfatal warning across client navigation.
export function addTranscriptSearchIndexWarningToPath(path: string) {
  const url = new URL(path, "https://vosio.local");

  url.searchParams.set("warning", TRANSCRIPT_SEARCH_INDEX_WARNING);

  return `${url.pathname}${url.search}${url.hash}`;
}

// getTranscriptSearchWarningPayload adds only the stable known warning to an API response.
export function getTranscriptSearchWarningPayload(result: { status: string }) {
  return result.status === "incomplete"
    ? { warnings: [TRANSCRIPT_SEARCH_INDEX_WARNING] }
    : {};
}
