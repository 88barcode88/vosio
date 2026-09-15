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
    let disposed = false;
    let requested = false;

    // reconcile posts only the transcript identity; all paid-call configuration stays server-side.
    async function reconcile() {
      if (disposed || requested || document.visibilityState === "hidden" || !navigator.onLine) return;
      requested = true;
      try {
        const response = await fetch(
          `/api/transcripts/${transcriptId}/automatic-timeline`,
          { method: "POST" }
        );

        if (!response.ok) {
          return;
        }

        const payload = await response.json().catch(() => null) as { status?: string } | null;

        if (!disposed && payload?.status && payload.status !== "not_scheduled") {
          await onReconciled?.();
        }
      } catch {
        // Recovery is best-effort and will be attempted again on the next detail open.
      }
    }

    // StrictMode's discarded activation must not send a second logical recovery request.
    queueMicrotask(() => { void reconcile(); });
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("online", reconcile);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("online", reconcile);
    };
  }, [onReconciled, transcriptId]);

  return null;
}
