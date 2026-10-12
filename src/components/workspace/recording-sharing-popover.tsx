"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { CompactPopover } from "@/components/ui/compact-popover";
import { BulkRecordingSharing } from "./bulk-recording-sharing";
import { RecordingAccessManager } from "./recording-access-manager";
import type { RecordingRow } from "@/lib/recordings/types";

// RecordingSharingPopover keeps visibility and invitations next to Export without moving the action toolbar.
export function RecordingSharingPopover({ recording }: { recording: RecordingRow }) {
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  if (!recording.capabilities?.manageAccess) return null;
  return <CompactPopover label="Sdílení a přístup" trigger={<><Share2 aria-hidden="true" size={15} />Sdílet</>} busy={visibilityBusy || accessBusy}>
    <BulkRecordingSharing key={`visibility-${recording.id}`} recordings={[recording]} detail onBusyChange={setVisibilityBusy} />
    {!(recording.project_id && recording.visibility === "private") ? <RecordingAccessManager
      recordingId={recording.id} projectId={recording.project_id} visibility={recording.visibility ?? "private"} canManageAccess onBusyChange={setAccessBusy} /> : null}
  </CompactPopover>;
}
