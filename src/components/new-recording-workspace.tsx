import { ChevronDown, FileText, Mic, Upload } from "lucide-react";
import type { ReactNode } from "react";
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
  live: ReactNode;
  transcriptImport: ReactNode;
};

type NewRecordingWorkspaceProps = {
  captureSlots?: NewRecordingCaptureSlots;
  recordingStorageConfig: RecordingStorageConfig;
  uploadRedirectAfterSuccess?: "detail" | "list" | "stay";
  uploadTransport?: RecordingUploadTransport;
  userSettings?: UserSettings;
};

// NewRecordingWorkspace renders two primary capture methods and a secondary transcript import.
export function NewRecordingWorkspace({
  captureSlots,
  recordingStorageConfig,
  uploadRedirectAfterSuccess = "detail",
  uploadTransport,
  userSettings = defaultUserSettings
}: NewRecordingWorkspaceProps) {
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

      {storageLimitSummary.warning ? (
        <p className="recording-storage-alert" role="alert">
          {storageLimitSummary.warning}
        </p>
      ) : null}

      <p className="recording-storage-info-row" aria-label="Limity úložiště">
        <span><strong>Bucket recordings:</strong> {storageLimitSummary.bucketLimit}</span>
        <span aria-hidden="true">·</span>
        <span><strong>Globální limit:</strong> {storageLimitSummary.globalLimit}</span>
        <span aria-hidden="true">·</span>
        <span><strong>Preference:</strong> {storageLimitSummary.planLabel}</span>
      </p>

      <div className="capture-grid capture-primary-grid">
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
                allowTranscriptOnly
                captionMode
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
              allowedMimeTypes={allowedMimeTypes}
              maxFileSizeBytes={maxFileSizeBytes}
              redirectAfterUpload={uploadRedirectAfterSuccess}
              uploadTransport={uploadTransport}
            />
          </div>
        </article>
      </div>

      <article className="capture-card transcript-import-card" data-secondary-capture="transcript">
        <details className="transcript-import-disclosure">
          <summary>
            <span className="capture-card-heading">
              <FileText aria-hidden="true" size={16} />
              <span>
                <strong>Vložit přepis</strong>
                <small>Vedlejší možnost pro text bez audio souboru</small>
              </span>
            </span>
            <ChevronDown aria-hidden="true" className="transcript-import-chevron" size={18} />
          </summary>
          <div className="upload-console transcript-import-console">
            <p>
              Vložte hotový přepis. Vosio ho uloží jako dokončený záznam a AI zpracování poběží
              stejně jako u přepisů ze Sonioxu.
            </p>
            {captureSlots?.transcriptImport ?? <TranscriptImportForm redirectAfterImport="detail" />}
          </div>
        </details>
      </article>
    </section>
  );
}
