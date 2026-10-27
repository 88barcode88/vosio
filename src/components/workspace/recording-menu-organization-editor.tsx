"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { RecordingOrganizationEditor } from "@/components/workspace/recording-organization-editor";
import { assignRecordingOrganizationAction } from "@/lib/recording-organization/actions";
import { loadRecordingOrganizationAction } from "@/lib/recording-organization/load-recording-action";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";

// RecordingMenuOrganizationEditor lazily obtains tags missing from search results before editing.
export function RecordingMenuOrganizationEditor({ recordingId, options, embedded = false, onPendingChange }: {
  embedded?: boolean;
  onPendingChange?: (pending: boolean) => void;
  recordingId: string;
  options: RecordingOrganizationOptions;
}) {
  const [recording, setRecording] = useState<Awaited<ReturnType<typeof loadRecordingOrganizationAction>>>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  // loadAssignment obtains the authorized tag snapshot before exposing any assignment inputs.
  const loadAssignment = useCallback(() => {
    startTransition(async () => {
      setError(false);
      try {
        const snapshot = await loadRecordingOrganizationAction(recordingId);
        if (snapshot) setRecording(snapshot); else setError(true);
      } catch { setError(true); }
    });
  }, [recordingId]);
  useEffect(() => { if (embedded) loadAssignment(); }, [embedded, loadAssignment]);
  useEffect(() => { onPendingChange?.(pending); }, [onPendingChange, pending]);

  if (recording) return <RecordingOrganizationEditor
    embedded={embedded}
    onPendingChange={onPendingChange}
    initiallyOpen
    key={recording.id}
    options={options}
    organization={{
      client: options.clients.find((item) => item.id === recording.client_id) ?? null,
      project: options.projects.find((item) => item.id === recording.project_id) ?? null,
      folder: options.folders.find((item) => item.id === recording.folder_id) ?? null,
      tags: options.tags.filter((item) => recording.tag_ids.includes(item.id))
    }}
    recording={recording}
    saveAction={async (state, formData) => {
      const result = await assignRecordingOrganizationAction(state, formData);
      if (result.status === "success") setRecording({
        ...recording,
        id: recording.id,
        client_id: String(formData.get("clientId") ?? "") || null,
        project_id: String(formData.get("projectId") ?? "") || null,
        folder_id: String(formData.get("folderId") ?? "") || null,
        tag_ids: formData.getAll("tagIds").map(String)
      });
      return result;
    }}
    showSummary={false}
  />;

  return <div>
    <button className="ghost-action" disabled={pending} type="button" onClick={loadAssignment}>
      <Pencil aria-hidden="true" size={15} />{pending ? "Načítám zařazení…" : embedded ? "Načíst zařazení" : "Upravit zařazení"}
    </button>
    {error ? <p role="alert">Zařazení se nepodařilo načíst. Zkuste to znovu.</p> : null}
  </div>;
}
