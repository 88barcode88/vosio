"use client";
import { ChevronDown, FileText, Mic, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CaptureScopePicker, privateCaptureScope } from "@/components/capture-scope-picker";
import type { CaptureScope } from "@/lib/recordings/capture";
import type { RecordingProjectRow } from "@/lib/recording-organization/types";
import { PersistentRecorderSlot } from "@/components/persistent-recording-session";
import {
  RecordingUploadForm,
  type RecordingUploadTransport
} from "@/components/recording-upload-form";
import { TranscriptImportForm } from "@/components/transcript-import-form";
import { getLiveAudioMaxFileSizeBytes } from "@/lib/recordings/live-audio-limit";
import { getRecordingStorageLimitSummary } from "@/lib/recordings/storage-copy";
import { getRecordingFormatSummary } from "@/lib/recordings/types";
import type { RecordingStorageConfig } from "@/lib/recordings/storage-config";
import { defaultUserSettings, type UserSettings } from "@/lib/settings/types";

export type NewRecordingCaptureSlots = {
  scope?: ReactNode;
  live: ReactNode;
  transcriptImport: ReactNode;
};

type NewRecordingWorkspaceProps = {
  projects?: RecordingProjectRow[];
  captureSlots?: NewRecordingCaptureSlots;
  recordingStorageConfig: RecordingStorageConfig;
  uploadRedirectAfterSuccess?: "detail" | "list" | "stay";
  uploadTransport?: RecordingUploadTransport;
  userSettings?: UserSettings;
};

// NewRecordingWorkspace renders two primary capture methods and a secondary transcript import.
export function NewRecordingWorkspace({
  projects = [],
  captureSlots,
  recordingStorageConfig,
  uploadRedirectAfterSuccess = "detail",
  uploadTransport,
  userSettings = defaultUserSettings
}: NewRecordingWorkspaceProps) {
  const [captureScope, setCaptureScope] = useState<CaptureScope>(privateCaptureScope);
  const [captureRequestId, setCaptureRequestId] = useState<string | undefined>();
  const [scopeMounted, setScopeMounted] = useState(false);
  const maxFileSizeBytes = recordingStorageConfig.maxFileSizeBytes;
  const allowedMimeTypes = recordingStorageConfig.allowedMimeTypes;
  const liveAudioMaxFileSizeBytes = getLiveAudioMaxFileSizeBytes(maxFileSizeBytes);
  const storageLimitSummary = getRecordingStorageLimitSummary(
    recordingStorageConfig,
    userSettings.supabaseStoragePlan
  );

  return (
    <section className="new-recording-workspace" aria-label="Nová nahrávka">
      <header className="new-recording-header">
        <h1>Nová nahrávka</h1>
        <p>Začněte live nahráváním nebo nahrajte existující audio soubor.</p>
      </header>
      <details className="capture-scope-disclosure" onToggle={(event) => { if (event.currentTarget.open) setScopeMounted(true); }}>
        <summary>Projekt a pokročilé sdílení{!captureSlots?.scope && (captureScope.projectId || captureScope.visibility !== "private") ? " · vlastní výběr" : ""}</summary>
        {scopeMounted ? captureSlots?.scope ?? <CaptureScopePicker projects={projects} value={captureScope} onChange={(scope, requestId) => { setCaptureScope(scope); setCaptureRequestId(requestId); }} /> : null}
      </details>

      {storageLimitSummary.warning ? (
        <p className="recording-storage-alert" role="alert">
          {storageLimitSummary.warning}
        </p>
      ) : null}

      <div
        aria-label="Hlavní způsoby pořízení"
        className="capture-grid capture-primary-grid"
        role="group"
      >
        <article className="capture-card capture-card-primary" data-primary-capture="live">
          <div className="capture-card-heading">
            <Mic aria-hidden="true" size={16} />
            <div>
              <strong>Nahrávat live</strong>
              <span>
                Audio s live přepisem, jen audio s následným přepisem, nebo jen live text.
                Limit audia: {storageLimitSummary.liveAudioLimit}.
              </span>
            </div>
          </div>
          <div className="capture-card-body">
            {captureSlots?.live ?? (
              <PersistentRecorderSlot
                captureScope={captureScope}
                captureRequestId={captureRequestId}
                allowTranscriptOnly
                captionMode
                liveAudioQuality={userSettings.liveAudioQuality}
                maxAudioFileSizeBytes={liveAudioMaxFileSizeBytes}
                realtimeLanguage={userSettings.sonioxRealtimeLanguage}
                realtimeModel={userSettings.sonioxRealtimeModel}
                redirectAfterSave="detail"
              />
            )}
          </div>
        </article>

        <article className="capture-card capture-card-primary" data-primary-capture="upload">
          <div className="capture-card-heading">
            <Upload aria-hidden="true" size={16} />
            <div>
              <strong>Nahrát soubor</strong>
              <span>{getRecordingFormatSummary(allowedMimeTypes ?? [])}</span>
            </div>
          </div>
          <div className="upload-console">
            <RecordingUploadForm
              captureScope={captureScope}
              captureRequestId={captureRequestId}
              allowedMimeTypes={allowedMimeTypes}
              maxFileSizeBytes={maxFileSizeBytes}
              redirectAfterUpload={uploadRedirectAfterSuccess}
              uploadTransport={uploadTransport}
            />
          </div>
        </article>
      </div>

      <p className="recording-storage-info-row" aria-label="Limity úložiště">
        Limit audia: {storageLimitSummary.liveAudioLimit}. Maximální velikost souboru: {storageLimitSummary.manualUploadLimit}.
      </p>
      <p className="capture-sharing-note">{captureSlots?.scope ? "Přístup odpovídá výběru v pokročilém nastavení. Sdílení můžete upravit v detailu po uložení." : captureScope.visibility === "private" ? "Nahrávka se uloží soukromě. Sdílení můžete nastavit v detailu po uložení." : "Nahrávka se uloží s vybraným přístupem."}</p>

      <article className="capture-card transcript-import-card" data-secondary-capture="transcript">
        <details aria-label="Import hotového přepisu" className="transcript-import-disclosure">
          <summary>
            <span className="capture-card-heading">
              <FileText aria-hidden="true" size={16} />
              <span>
                <strong>Vložit přepis</strong>
                <small>Vedlejší možnost pro text bez audio souboru</small>
              </span>
            </span>
            <ChevronDown aria-hidden="true" className="transcript-import-chevron" size={15} />
          </summary>
          <div className="upload-console transcript-import-console">
            <p>
              Vložte hotový přepis. Vosio ho uloží jako dokončený záznam a AI zpracování poběží
              stejně jako u přepisů ze Sonioxu.
            </p>
            {captureSlots?.transcriptImport ?? <TranscriptImportForm captureScope={captureScope} captureRequestId={captureRequestId} redirectAfterImport="detail" />}
          </div>
        </details>
      </article>
    </section>
  );
}
