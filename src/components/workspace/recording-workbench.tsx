import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { DeleteRecordingForm } from "@/components/delete-recording-form";
import { TranscriptTabs } from "@/components/transcript-tabs";
import { ExportControls } from "@/components/transcript-tabs/export-controls";
import { TranscriptionControls } from "@/components/transcription-controls";
import { RecordingDetailTitleEditor } from "@/components/workspace/recording-detail-title-editor";
import { RecordingOrganizationEditor } from "@/components/workspace/recording-organization-editor";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
import {
  toRecordingClientView,
  type RecordingClientView
} from "@/lib/recordings/client-view";
import {
  formatFileSize,
  formatRecordingDate,
  getStatusLabel,
  type RecordingRow
} from "@/lib/recordings/types";
import type { UserSettings } from "@/lib/settings/types";
import type { TranscriptTab } from "@/components/transcript-tabs/types";
import type { TranscriptRow } from "@/lib/transcripts/types";
import type { ResolvedTranscriptDeepLink } from "@/lib/transcripts/deep-link";
import type { RecordingMarkerRow } from "@/lib/recording-markers/types";
import type {
  RecordingOrganization,
  RecordingOrganizationOptions
} from "@/lib/recording-organization/types";
import {
  formatDuration,
  getRecordingDotClassName,
  getSourceTypeLabel
} from "@/components/workspace/utils";

// RecordingWorkbench composes the selected recording as one full-width working document.
export function RecordingWorkbench({
  activeAiOutputs,
  activeRecording,
  activeRecordingMarkers,
  activeRecordingOrganization,
  activeStructuredItems,
  activeTranscript,
  initialDeepLink,
  initialTab,
  initialTabFromCookie,
  initialTabFromUrl,
  recordingOrganizationOptions,
  userSettings
}: {
  activeAiOutputs: AiOutputView[];
  activeRecording: RecordingRow | null;
  activeRecordingMarkers: RecordingMarkerRow[];
  activeRecordingOrganization: RecordingOrganization;
  activeStructuredItems: StructuredAiItems;
  activeTranscript: TranscriptRow | null;
  initialDeepLink: ResolvedTranscriptDeepLink | null;
  initialTab: TranscriptTab;
  initialTabFromCookie: boolean;
  initialTabFromUrl: boolean;
  recordingOrganizationOptions: RecordingOrganizationOptions;
  userSettings: UserSettings;
}) {
  const activeRecordingView = activeRecording
    ? toRecordingClientView(activeRecording)
    : null;

  return (
    <section className="recording-workbench" aria-label="Aktuální nahrávka">
      <Link className="recording-detail-back" href="/recordings">
        <ChevronLeft aria-hidden="true" size={16} />
        Zpět na nahrávky
      </Link>
      <RecordingCard
        activeAiOutputs={activeAiOutputs}
        activeRecording={activeRecording}
        activeRecordingView={activeRecordingView}
        activeRecordingOrganization={activeRecordingOrganization}
        activeStructuredItems={activeStructuredItems}
        activeTranscript={activeTranscript}
        recordingOrganizationOptions={recordingOrganizationOptions}
      />
      <TranscriptPanel
        activeAiOutputs={activeAiOutputs}
        activeRecording={activeRecordingView}
        activeRecordingMarkers={activeRecordingMarkers}
        activeStructuredItems={activeStructuredItems}
        activeTranscript={activeTranscript}
        initialDeepLink={initialDeepLink}
        initialTab={initialTab}
        initialTabFromCookie={initialTabFromCookie}
        initialTabFromUrl={initialTabFromUrl}
        userSettings={userSettings}
      />
    </section>
  );
}

// RecordingCard shows the compact selected-recording header, metadata and title actions.
function RecordingCard({
  activeAiOutputs,
  activeRecording: activeRecordingRow,
  activeRecordingView,
  activeRecordingOrganization,
  activeStructuredItems,
  activeTranscript,
  recordingOrganizationOptions
}: {
  activeAiOutputs: AiOutputView[];
  activeRecording: RecordingRow | null;
  activeRecordingView: RecordingClientView | null;
  activeRecordingOrganization: RecordingOrganization;
  activeStructuredItems: StructuredAiItems;
  activeTranscript: TranscriptRow | null;
  recordingOrganizationOptions: RecordingOrganizationOptions;
}) {
  const activeRecording = activeRecordingRow ? toRecordingClientView(activeRecordingRow) : null;

  return (
    <section className="recording-object-header">
      <div className="recording-detail-main">
        <div className="recording-title-stack">
          <div className="recording-meta">
            <span className={getRecordingDotClassName(activeRecording?.status)} />
            <span>Nahrávka · {activeRecording ? getStatusLabel(activeRecording.status) : "Připraveno"}</span>
          </div>
          <div className="recording-title-line">
            <h1>{activeRecording ? activeRecording.title : "Audio"}</h1>
            <dl className="recording-detail-meta">
              <div>
                <dt>Datum</dt>
                <dd>{activeRecording ? formatRecordingDate(activeRecording.created_at) : "bez data"}</dd>
              </div>
              <div>
                <dt>Délka</dt>
                <dd>{formatDuration(activeRecording?.duration_seconds ?? null)}</dd>
              </div>
              <div>
                <dt>Velikost</dt>
                <dd>{activeRecording ? formatFileSize(activeRecording.file_size_bytes) : "bez souboru"}</dd>
              </div>
              <div>
                <dt>Zdroj</dt>
                <dd>{getSourceTypeLabel(activeRecording?.source_type)}</dd>
              </div>
            </dl>
          </div>
        </div>
        {activeRecordingRow ? (
          <div className="recording-detail-actions">
            <ExportControls
              activeAiOutputs={activeAiOutputs}
              activeRecording={activeRecordingView}
              activeStructuredItems={activeStructuredItems}
              activeTranscript={activeTranscript}
            />
            <RecordingDetailTitleEditor
              key={activeRecordingRow.id}
              recordingId={activeRecordingRow.id}
              title={activeRecordingRow.title}
            />
            <DeleteRecordingForm
              label="Smazat nahrávku"
              next="/recordings"
              recordingId={activeRecordingRow.id}
              variant="danger"
            />
          </div>
        ) : null}
      </div>
      {activeRecordingRow ? (
        <>
          <RecordingOrganizationEditor
            key={`organization-${activeRecordingRow.id}`}
            options={recordingOrganizationOptions}
            organization={activeRecordingOrganization}
            recording={activeRecordingRow}
          />
          <div className="recording-header-operations" aria-label="Akce přepisu">
            <CommandBar activeRecording={activeRecordingView} activeTranscript={activeTranscript} />
          </div>
        </>
      ) : null}
    </section>
  );
}

// TranscriptPanel renders the saved transcript or the real pending transcription state.
function TranscriptPanel({
  activeAiOutputs,
  activeRecording,
  activeRecordingMarkers,
  activeStructuredItems,
  activeTranscript,
  initialDeepLink,
  initialTab,
  initialTabFromCookie,
  initialTabFromUrl,
  userSettings
}: {
  activeAiOutputs: AiOutputView[];
  activeRecording: RecordingClientView | null;
  activeRecordingMarkers: RecordingMarkerRow[];
  activeStructuredItems: StructuredAiItems;
  activeTranscript: TranscriptRow | null;
  initialDeepLink: ResolvedTranscriptDeepLink | null;
  initialTab: TranscriptTab;
  initialTabFromCookie: boolean;
  initialTabFromUrl: boolean;
  userSettings: UserSettings;
}) {
  return (
    <section className="transcript-panel">
      <TranscriptTabs
        activeAiOutputs={activeAiOutputs}
        activeRecording={activeRecording}
        activeRecordingMarkers={activeRecordingMarkers}
        activeStructuredItems={activeStructuredItems}
        activeTranscript={activeTranscript}
        initialDeepLink={initialDeepLink}
        initialTab={initialTab}
        initialTabFromCookie={initialTabFromCookie}
        initialTabFromUrl={initialTabFromUrl}
        userSettings={userSettings}
      />
    </section>
  );
}

// CommandBar exposes transcription actions without creating a dominant side panel.
function CommandBar({
  activeRecording,
  activeTranscript
}: {
  activeRecording: RecordingClientView | null;
  activeTranscript: TranscriptRow | null;
}) {
  const storedAudioMode = activeRecording?.audioAvailability === "segmented"
    ? "segments"
    : activeRecording?.audioAvailability ?? "none";

  return (
    <div className="command-bar">
      <TranscriptionControls
        storedAudioMode={storedAudioMode}
        hasTranscript={Boolean(activeTranscript)}
        recordingId={activeRecording?.id ?? null}
        recordingStatus={activeRecording?.status ?? null}
      />
    </div>
  );
}
