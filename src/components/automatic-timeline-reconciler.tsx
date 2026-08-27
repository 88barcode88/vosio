"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// AutomaticTimelineReconciler performs one owner-authenticated recovery attempt when detail opens.
export function AutomaticTimelineReconciler({ transcriptId }: { transcriptId: string | null }) {
  const router = useRouter();

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
          router.refresh();
        }
      } catch {
        // Recovery is best-effort and will be attempted again on the next detail open.
      }
    }

    void reconcile();
  }, [router, transcriptId]);

  return null;
}
