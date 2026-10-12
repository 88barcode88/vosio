"use client";
import { AccessManager } from "./project-access-manager";
import type { RecordingVisibility } from "@/lib/recording-sharing/types";

// RecordingAccessManager permits standalone first invitations; only verified DB acceptance publishes exact items.
export function RecordingAccessManager({ recordingId, projectId, visibility, canManageAccess, onBusyChange }: { recordingId: string; projectId: string | null; visibility: RecordingVisibility; canManageAccess: boolean; onBusyChange?: (busy: boolean) => void }) {
  if (!canManageAccess) return null;
  if (visibility !== "selected" && !(projectId === null && visibility === "private")) return <p>Pro pozvání ke konkrétní projektové nahrávce nejprve zvolte sdílení s vybranými lidmi.</p>;
  return <AccessManager key={`${projectId ?? "standalone"}:${recordingId}`} recordingId={recordingId} onBusyChange={onBusyChange} scope={projectId ? { scope: "project-selected", projectId, recordingIds: [recordingId] } : { scope: "standalone", recordingIds: [recordingId] }} />;
}
