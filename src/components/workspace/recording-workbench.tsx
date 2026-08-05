import { AudioLines, CheckCircle2 } from "lucide-react";
import { DeleteRecordingForm } from "@/components/delete-recording-form";
import { TranscriptTabs } from "@/components/transcript-tabs";
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
import type { RecordingMarkerRow } from "@/lib/recording-markers/types";
import type {
  RecordingOrganization,
  RecordingOrganizationOptions
} from "@/lib/recording-organization/types";
import {
  formatDuration,
  getRecordingDotClassName,
  getRecordingNextStepLabel,
  getSourceTypeLabel,
  getStorageAvailabilityLabel,
  getTranscriptAvailabilityLabel
} from "@/components/workspace/utils";

// RecordingWorkbench composes the selected recording header, tabs and right rail.
export function RecordingWorkbench({
  activeAiOutputs,
  activeRecording,
  activeRecordingMarkers,
  activeRecordingOrganization,
  activeStructuredItems,
  activeTranscript,
  initialTab,
  initialTabFromCookie,
  recordingOrganizationOptions,
  userSettings
}: {
  activeAiOutputs: AiOutputView[];
  activeRecording: RecordingRow | null;
  activeRecordingMarkers: RecordingMarkerRow[];
  activeRecordingOrganization: RecordingOrganization;
  activeStructuredItems: StructuredAiItems;
  activeTranscript: TranscriptRow | null;
  initialTab: TranscriptTab;
  initialTabFromCookie: boolean;
  recordingOrganizationOptions: RecordingOrganizationOptions;
  userSettings: UserSettings;
}) {
  const activeRecordingView = activeRecording
    ? toRecordingClientView(activeRecording)
    : null;

  return (
    <section className="recording-workbench" aria-label="Aktuální nahrávka">
      <RecordingCard
        activeRecording={activeRecording}
        activeRecordingOrganization={activeRecordingOrganization}
        recordingOrganizationOptions={recordingOrganizationOptions}
      />
      <div className="recording-workbench-grid">
        <TranscriptPanel
          activeAiOutputs={activeAiOutputs}
          activeRecording={activeRecordingView}
          activeRecordingMarkers={activeRecordingMarkers}
          activeStructuredItems={activeStructuredItems}
          activeTranscript={activeTranscript}
          initialTab={initialTab}
          initialTabFromCookie={initialTabFromCookie}
          userSettings={userSettings}
        />
        <aside className="recording-rail" aria-label="Pracovní stav nahrávky">
          <CommandBar activeRecording={activeRecordingView} activeTranscript={activeTranscript} />
          <RecordingRail
            activeAiOutputs={activeAiOutputs}
            activeRecording={activeRecordingView}
            activeStructuredItems={activeStructuredItems}
            activeTranscript={activeTranscript}
          />
        </aside>
      </div>
    </section>
  );
}

// RecordingCard shows the compact selected-recording header, metadata and title actions.
function RecordingCard({
  activeRecording: activeRecordingRow,
  activeRecordingOrganization,
  recordingOrganizationOptions
}: {
  activeRecording: RecordingRow | null;
  activeRecordingOrganization: RecordingOrganization;
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
        <RecordingOrganizationEditor
          key={`organization-${activeRecordingRow.id}`}
          options={recordingOrganizationOptions}
          organization={activeRecordingOrganization}
          recording={activeRecordingRow}
        />
      ) : null}
    </section>
  );
}

// RecordingRail renders compact operational context next to the transcript workspace.
function RecordingRail({
  activeAiOutputs,
  activeRecording,
  activeStructuredItems,
  activeTranscript
}: {
  activeAiOutputs: AiOutputView[];
  activeRecording: RecordingClientView | null;
  activeStructuredItems: StructuredAiItems;
  activeTranscript: TranscriptRow | null;
}) {
  return (
    <div className="recording-rail-cards">
      <section className="rail-card">
        <div>
          <CheckCircle2 size={15} />
          <strong>Stav</strong>
        </div>
        <dl>
          <div>
            <dt>Nahrávka</dt>
            <dd>{activeRecording ? getStatusLabel(activeRecording.status) : "Bez nahrávky"}</dd>
          </div>
          <div>
            <dt>Přepis</dt>
            <dd>{getTranscriptAvailabilityLabel(activeTranscript)}</dd>
          </div>
        </dl>
      </section>
      <section className="rail-card">
        <div>
          <AudioLines size={15} />
          <strong>Obsah</strong>
        </div>
        <dl>
          <div>
            <dt>AI výstupy</dt>
            <dd>{activeAiOutputs.length}</dd>
          </div>
          <div>
            <dt>AI úkoly</dt>
            <dd>{activeStructuredItems.tasks.length}</dd>
          </div>
          <div>
            <dt>Soubor</dt>
            <dd>{getStorageAvailabilityLabel(activeRecording)}</dd>
          </div>
          <div>
            <dt>Jazyk</dt>
            <dd>{activeTranscript?.language ?? "nezjištěno"}</dd>
          </div>
        </dl>
      </section>
      <section className="rail-card rail-card-next-step">
        <div>
          <CheckCircle2 size={15} />
          <strong>Další krok</strong>
        </div>
        <p>{getRecordingNextStepLabel(activeRecording, activeTranscript)}</p>
      </section>
    </div>
  );
}

// TranscriptPanel renders the saved transcript or the real pending transcription state.
function TranscriptPanel({
  activeAiOutputs,
  activeRecording,
  activeRecordingMarkers,
  activeStructuredItems,
  activeTranscript,
  initialTab,
  initialTabFromCookie,
  userSettings
}: {
  activeAiOutputs: AiOutputView[];
  activeRecording: RecordingClientView | null;
  activeRecordingMarkers: RecordingMarkerRow[];
  activeStructuredItems: StructuredAiItems;
  activeTranscript: TranscriptRow | null;
  initialTab: TranscriptTab;
  initialTabFromCookie: boolean;
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
        initialTab={initialTab}
        initialTabFromCookie={initialTabFromCookie}
        userSettings={userSettings}
      />
    </section>
  );
}

// CommandBar exposes the primary transcription actions in the recording rail.
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
