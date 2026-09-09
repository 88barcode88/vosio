import { ChevronRight, FileAudio } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import type { WorkspaceView } from "@/lib/workspace-data";

const workspaceViewLabels: Record<WorkspaceView, string> = {
  ai: "AI archiv",
  documentation: "Dokumentace",
  recordings: "Nahrávky",
  settings: "Nastavení",
  templates: "AI prompty",
  trash: "Koš"
};

// WorkspaceTopbar keeps the global context and appearance control aligned across every workspace route.
export function WorkspaceTopbar({
  activeRecordingTitle,
  isCreatingRecording,
  view
}: {
  activeRecordingTitle?: string | null;
  isCreatingRecording: boolean;
  view: WorkspaceView;
}) {
  const currentLabel = activeRecordingTitle
    ?? (isCreatingRecording ? "Nová nahrávka" : workspaceViewLabels[view]);

  return (
    <header className="workspace-topbar">
      <div className="workspace-breadcrumbs" aria-label="Drobečková navigace">
        <FileAudio aria-hidden="true" size={15} />
        <span>Pracovní prostor</span>
        <ChevronRight aria-hidden="true" size={14} />
        <strong>{currentLabel}</strong>
      </div>
      <ThemeToggle compact />
    </header>
  );
}
