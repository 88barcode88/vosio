"use client";

import { useEffect } from "react";
import {
  TRANSCRIPT_SEARCH_INDEX_WARNING,
  TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE
} from "@/lib/transcripts/search-warning";

// clearTranscriptSearchIndexWarning removes only the consumed warning without navigating or reloading.
function clearTranscriptSearchIndexWarning() {
  const url = new URL(window.location.href);

  if (!url.searchParams.has("warning", TRANSCRIPT_SEARCH_INDEX_WARNING)) {
    return;
  }

  url.searchParams.delete("warning", TRANSCRIPT_SEARCH_INDEX_WARNING);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

// TranscriptSearchWarningNotice exposes a nonfatal indexing fallback to sighted and screen-reader users.
export function TranscriptSearchWarningNotice() {
  useEffect(() => {
    clearTranscriptSearchIndexWarning();
  }, []);

  return (
    <p
      aria-live="polite"
      className="upload-state upload-state-working"
      role="status"
    >
      {TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE}
    </p>
  );
}
