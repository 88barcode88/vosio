"use client";

import { useEffect, useRef } from "react";


// AutomaticTimelineReconciler restores consent-snapshotted output types only under current personal authority.
export function AutomaticTimelineReconciler({
  onReconciled,
  canRunPersonalAi = false,
  transcriptId
}: {
  onReconciled?: () => Promise<void>;
  canRunPersonalAi?: boolean;
  transcriptId: string | null;
}) {
  // Latest callback is read at call time so parent re-renders (e.g. tab switches) never re-arm the POST.
  const onReconciledRef = useRef(onReconciled);
  useEffect(() => {
    onReconciledRef.current = onReconciled;
  }, [onReconciled]);

  useEffect(() => {
    if (!transcriptId || !canRunPersonalAi) {
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

        // Only genuinely queued work changes AI state; current/not_scheduled need no reload.
        if (!disposed && payload?.status === "queued") {
          await onReconciledRef.current?.();
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
  }, [transcriptId, canRunPersonalAi]);

  return null;
}
