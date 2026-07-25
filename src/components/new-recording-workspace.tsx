import { FileText, Mic, Upload } from "lucide-react";
import { PersistentRecorderSlot } from "@/components/persistent-recording-session";
import { RecordingUploadForm } from "@/components/recording-upload-form";
import { TranscriptImportForm } from "@/components/transcript-import-form";
import { getLiveAudioMaxFileSizeBytes } from "@/lib/recordings/live-audio-limit";
import {
  getLiveAudioStorageCopy,
  getManualUploadStorageCopy,
  getUnavailableRecordingStorageCopy
} from "@/lib/recordings/storage-copy";
import type { RecordingStorageConfig } from "@/lib/recordings/storage-config";
import { defaultUserSettings, type UserSettings } from "@/lib/settings/types";

type NewRecordingWorkspaceProps = {
  recordingStorageConfig: RecordingStorageConfig;
  userSettings?: UserSettings;
};

// NewRecordingWorkspace renders the capture console for live recording, file upload and transcript import.
export function NewRecordingWorkspace({
  recordingStorageConfig,
  userSettings = defaultUserSettings
}: NewRecordingWorkspaceProps) {
  const maxFileSizeBytes = recordingStorageConfig.maxFileSizeBytes;
  const liveAudioMaxFileSizeBytes = getLiveAudioMaxFileSizeBytes(maxFileSizeBytes);

  return (
    <section className="new-recording-workspace" aria-label="Nová nahrávka">
      <div className="new-recording-header">
        <div>
          <span>Capture console</span>
          <h1>Nová nahrávka</h1>
          <p>Live přepis, audio soubor a hotový přepis jsou rovnocenné cesty do stejného workflow.</p>
        </div>
      </div>
      {maxFileSizeBytes === null ? (
        <p className="recording-storage-alert" role="alert">
          {getUnavailableRecordingStorageCopy()}
        </p>
      ) : null}

      <div className="capture-grid">
        <article className="capture-card capture-card-primary">
          <div className="capture-card-heading">
            <Mic size={16} />
            <div>
              <strong>Nahrávat live</strong>
              <span>{getLiveAudioStorageCopy(liveAudioMaxFileSizeBytes)}</span>
            </div>
          </div>
          <div className="capture-card-body">
            <PersistentRecorderSlot
              allowTranscriptOnly
              captionMode
              maxAudioFileSizeBytes={liveAudioMaxFileSizeBytes}
              realtimeModel={userSettings.sonioxRealtimeModel}
              redirectAfterSave="detail"
            />
          </div>
        </article>

        <article className="capture-card">
          <div className="capture-card-heading">
            <Upload size={16} />
            <div>
              <strong>Nahrát soubor</strong>
              <span>Audio, M4A nebo MP4</span>
            </div>
          </div>
          <div className="upload-console">
            {maxFileSizeBytes !== null ? <p>{getManualUploadStorageCopy(maxFileSizeBytes)}</p> : null}
            <RecordingUploadForm
              maxFileSizeBytes={maxFileSizeBytes}
              redirectAfterUpload="detail"
            />
          </div>
        </article>

        <article className="capture-card">
          <div className="capture-card-heading">
            <FileText size={16} />
            <div>
              <strong>Vložit přepis</strong>
              <span>Text bez audio souboru</span>
            </div>
          </div>
          <div className="upload-console">
            <p>
              Vložte hotový přepis. Vosio ho uloží jako dokončený záznam a AI zpracování poběží
              stejně jako u přepisů ze Sonioxu.
            </p>
            <TranscriptImportForm redirectAfterImport="detail" />
          </div>
        </article>
      </div>
    </section>
  );
}
