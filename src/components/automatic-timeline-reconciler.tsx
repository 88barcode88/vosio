"use client";

import { useEffect } from "react";

// AutomaticTimelineReconciler performs one owner-authenticated recovery attempt only in the active timeline.
export function AutomaticTimelineReconciler({
  onReconciled,
  transcriptId
}: {
  onReconciled?: () => Promise<void>;
  transcriptId: string | null;
}) {
  useEffect(() => {
    if (!transcriptId) {
      return;
    }

    // reconcile posts only the transcript identity; all paid-call configuration stays server-side.
    async function reconcile() {
      try {
        const response = await fetch(
          `/api/transcripts/${transcriptId}/automatic-timeline`,
          { method: "POST" }
        );

        if (!response.ok) {
          return;
        }

        const payload = await response.json().catch(() => null) as { status?: string } | null;

        if (payload?.status === "done") {
          await onReconciled?.();
        }
      } catch {
        // Recovery is best-effort and will be attempted again on the next detail open.
      }
    }

    void reconcile();
  }, [onReconciled, transcriptId]);

  return null;
}
