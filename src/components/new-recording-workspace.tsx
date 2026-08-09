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

      <dl className="recording-storage-summary" aria-label="Limity úložiště">
        <div>
          <dt>Bucket recordings</dt>
          <dd>{storageLimitSummary.bucketLimit}</dd>
        </div>
        <div>
          <dt>Globální limit</dt>
          <dd>{storageLimitSummary.globalLimit}</dd>
        </div>
        <div>
          <dt>Preference</dt>
          <dd>{storageLimitSummary.planLabel}</dd>
        </div>
      </dl>

      <div className="capture-grid capture-primary-grid">
        <article className="capture-card capture-card-primary" data-primary-capture="live">
          <div className="capture-card-heading">
            <Mic aria-hidden="true" size={16} />
            <div>
              <strong>Nahrávat live</strong>
              <span>Limit audia: {storageLimitSummary.liveAudioLimit}. Přepis se uloží vždy.</span>
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
              <span>Audio, M4A nebo MP4</span>
            </div>
          </div>
          <div className="upload-console">
            <RecordingUploadForm
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
