"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Upload, X } from "lucide-react";
import { useRecordingNavigationBlocker } from "@/components/recording-navigation-guard";
import {
  formatFileSize,
  getRecordingFileAccept,
  getRecordingFormatSummary
} from "@/lib/recordings/types";
import { createUploadOperationGuard, createUploadQueue } from "@/lib/recordings/upload-queue";
import { createUploadProgressTracker, type AggregateUploadProgress } from "@/lib/recordings/upload-progress";
import type { RecordingUploadProgress } from "@/lib/recordings/resumable-upload";
import {
  unsupportedRecordingMimeMessage,
  uploadRecording,
  validateAudioFile
} from "@/lib/recordings/upload";

type UploadState = {
  message: string;
  tone: "error" | "success" | "working";
};

type UploadPhase = "idle" | "transferring" | "finalizing" | "success" | "error" | "cancelled";

type SelectedFileSummary = {
  count: number;
  name: string;
  totalSize: number;
};

export type RecordingUploadTransport = typeof uploadRecording;

const genericUploadFailureMessage = "Nahrání souboru se nepodařilo. Zkuste to znovu.";
const standardCancellationMessage = "Nahrávání bylo zrušeno.";
const failedStateSuffix = " Záznam se nepodařilo označit jako neúspěšný.";
const safeExactUploadMessages = new Set([
  genericUploadFailureMessage,
  `${genericUploadFailureMessage}${failedStateSuffix}`,
  "Nahrávání souborů teď není dostupné.",
  "Nepovedlo se vytvořit záznam nahrávky.",
  "Přihlášení vypršelo. Přihlaste se znovu.",
  "Soubor je uložený, ale metadata se neuložila.",
  `Soubor je uložený, ale metadata se neuložila.${failedStateSuffix}`,
  unsupportedRecordingMimeMessage
]);
const safeFileSizeMessagePattern = /^Soubor je větší než (?:(?:povolených )?\d+(?:[.,]\d+)? (?:B|KB|MB|GB)\.)(?: Vyberte menší soubor\.)?$/u;

type RecordingUploadFormProps = {
  allowedMimeTypes: readonly string[] | null;
  maxFileSizeBytes: number | null;
  redirectAfterUpload?: "detail" | "list" | "stay";
  uploadTransport?: RecordingUploadTransport;
};

// getCancelledUploadMessage preserves only the known cancellation persistence failure without leaking provider detail.
export function getCancelledUploadMessage(input: {
  cancellationReason: unknown | null;
  succeededCount: number;
  totalCount: number;
}) {
  const persistenceFailed = input.cancellationReason instanceof Error &&
    input.cancellationReason.message === `${standardCancellationMessage}${failedStateSuffix}`;
  const detail = persistenceFailed ? failedStateSuffix : "";

  if (input.succeededCount > 0) {
    return `Nahrávání zrušeno. Uloženo ${input.succeededCount} z ${input.totalCount} nahrávek.${detail}`;
  }

  return persistenceFailed ? `${standardCancellationMessage}${failedStateSuffix}` : standardCancellationMessage;
}

// getSafeUploadFailureMessage prevents unexpected provider details from reaching the browser UI.
export function getSafeUploadFailureMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message.trim() : "";
  return message.length <= 180 && (safeExactUploadMessages.has(message) || safeFileSizeMessagePattern.test(message))
    ? message
    : genericUploadFailureMessage;
}

// summarizeSelectedFiles creates persistent, non-sensitive metadata for the upload status surface.
function summarizeSelectedFiles(files: File[]): SelectedFileSummary {
  return {
    count: files.length,
    name: files.length === 1 ? files[0]?.name ?? "Soubor" : `${files.length} soubory`,
    totalSize: files.reduce((sum, file) => sum + file.size, 0)
  };
}

// RecordingUploadForm uploads selected audio and keeps progress and terminal states in one stable surface.
export function RecordingUploadForm({
  allowedMimeTypes,
  maxFileSizeBytes,
  redirectAfterUpload,
  uploadTransport = uploadRecording
}: RecordingUploadFormProps) {
  const filteredInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const operationGuardRef = useRef<ReturnType<typeof createUploadOperationGuard> | null>(null);
  const retryFilesRef = useRef<File[]>([]);
  const router = useRouter();
  const { registerNavigationBlocker } = useRecordingNavigationBlocker();
  const [uploadState, setUploadState] = useState<UploadState>({
    message: "Připraveno k nahrání.",
    tone: "working"
  });
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [announcement, setAnnouncement] = useState("Připraveno k nahrání.");
  const [selectedFiles, setSelectedFiles] = useState<SelectedFileSummary | null>(null);
  const [currentFileIndex, setCurrentFileIndex] = useState<number | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [currentFileProgress, setCurrentFileProgress] = useState<RecordingUploadProgress | null>(null);
  const [progress, setProgress] = useState<AggregateUploadProgress | null>(null);
  const [totalFiles, setTotalFiles] = useState(0);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      operationGuardRef.current?.unmount();
    };
  }, []);

  useEffect(() => {
    if (!isUploading) return;
    return registerNavigationBlocker();
  }, [isUploading, registerNavigationBlocker]);

  // processFiles performs the authenticated serial upload flow for a browser selection or retry.
  async function processFiles(files: File[]) {
    if (maxFileSizeBytes === null || allowedMimeTypes === null || files.length === 0 || isUploading) return;

    retryFilesRef.current = files;
    setSelectedFiles(summarizeSelectedFiles(files));
    setCurrentFileName(files[0]?.name ?? null);
    setTotalFiles(files.length);
    setCanRetry(false);
    setCurrentFileIndex(null);
    setCurrentFileProgress(null);
    setProgress(null);

    const validationError = files
      .map((file) => validateAudioFile(file, maxFileSizeBytes, allowedMimeTypes))
      .find(Boolean);
    if (validationError) {
      setPhase("error");
      setUploadState({ message: validationError, tone: "error" });
      setAnnouncement(validationError);
      return;
    }

    const operationGuard = createUploadOperationGuard();
    const progressTracker = createUploadProgressTracker(files);
    operationGuardRef.current = operationGuard;
    setIsUploading(true);
    setPhase("transferring");
    setAnnouncement(`Nahrávání souboru 1 z ${files.length} začalo.`);
    setCurrentFileIndex(0);
    setCurrentFileProgress({ bytesSent: 0, bytesTotal: files[0]?.size ?? 0, percentage: 0 });
    setProgress(progressTracker.getSnapshot());
    setUploadState({
      message: files.length === 1 ? "Nahrávám soubor…" : `Nahrávám ${files.length} souborů…`,
      tone: "working"
    });

    try {
      const queue = createUploadQueue(files, async (file, index, control) => {
        if (operationGuard.canApplyEffects()) {
          setAnnouncement(`Nahrávání souboru ${index + 1} z ${files.length} začalo.`);
          setCurrentFileIndex(index);
          setCurrentFileName(file.name);
          setCurrentFileProgress({ bytesSent: 0, bytesTotal: file.size, percentage: 0 });
          setPhase("transferring");
        }

        const uploadedRecording = await uploadTransport({
          allowedMimeTypes,
          file,
          maxFileSizeBytes,
          onPhase: (nextPhase) => {
            if (!operationGuard.canApplyEffects()) return;
            setPhase(nextPhase);
            if (nextPhase === "finalizing") {
              setUploadState({ message: "Dokončuji bezpečné uložení…", tone: "working" });
              setAnnouncement(`Dokončuji uložení souboru ${index + 1} z ${files.length}.`);
            }
          },
          onProgress: (nextProgress) => {
            if (!operationGuard.canApplyEffects()) return;
            setCurrentFileProgress(nextProgress);
            setProgress(progressTracker.updateFileProgress(index, nextProgress.bytesSent));
          },
          onResumableUploadTask: control.setActiveTask,
          sourceType: "upload"
        });

        if (operationGuard.canApplyEffects()) setProgress(progressTracker.completeFile(index));
        return uploadedRecording;
      });
      operationGuard.setActiveTask(queue);
      const result = await queue.run();
      operationGuard.setActiveTask(null);

      if (!operationGuard.canApplyEffects() || !mountedRef.current) return;

      if (result.cancelled) {
        const message = getCancelledUploadMessage({
          cancellationReason: result.cancellationReason,
          succeededCount: result.succeeded.length,
          totalCount: files.length
        });
        setPhase("cancelled");
        setUploadState({ message, tone: result.succeeded.length > 0 ? "success" : "error" });
        setAnnouncement(message);
        setCanRetry(result.succeeded.length === 0);
        if (result.succeeded.length > 0) router.refresh();
        return;
      }

      if (result.failed.length > 0) {
        const detail = getSafeUploadFailureMessage(result.failed[0]?.error);
        const message = result.succeeded.length > 0
          ? `Uloženo ${result.succeeded.length} z ${files.length} nahrávek. ${detail}`
          : detail;
        setPhase("error");
        setUploadState({ message, tone: "error" });
        setAnnouncement(message);
        setCanRetry(result.succeeded.length === 0);
        if (result.succeeded.length > 0) router.refresh();
        return;
      }

      const message = files.length === 1 ? "Nahrávka je uložená." : `Uloženo ${files.length} nahrávek.`;
      setPhase("success");
      setUploadState({ message, tone: "success" });
      setAnnouncement(message);
      const lastRecordingId = result.succeeded[result.succeeded.length - 1]?.value.id ?? null;

      if (redirectAfterUpload === "detail" && files.length === 1 && lastRecordingId) {
        router.push(`/recordings/${lastRecordingId}`);
      } else if (redirectAfterUpload === "list") {
        router.push("/recordings");
      } else if (redirectAfterUpload !== "stay") {
        router.refresh();
      }
    } finally {
      if (operationGuard.canApplyEffects() && mountedRef.current) setIsUploading(false);
      if (operationGuardRef.current === operationGuard) operationGuardRef.current = null;
    }
  }

  // handleFileChange normalizes the native picker into the shared serial upload path.
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void processFiles(files);
  }

  // handleDrop accepts browser files without turning the decorative drop surface into a second control.
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void processFiles(Array.from(event.dataTransfer.files));
  }

  const totalProgressValue = progress?.bytesSent ?? 0;
  const totalProgressMax = progress?.bytesTotal || selectedFiles?.totalSize || 1;
  const fileLabel = selectedFiles?.name ?? "Zatím nebyl vybrán soubor";
  const enabledMimeTypes = allowedMimeTypes ?? [];
  const fileAccept = getRecordingFileAccept(enabledMimeTypes);
  const formatSummary = getRecordingFormatSummary(enabledMimeTypes);
  const uploadAvailable = maxFileSizeBytes !== null && enabledMimeTypes.length > 0;

  return (
    <div aria-busy={isUploading} className="real-upload" data-phase={phase}>
      <input
        accept={fileAccept}
        className="visually-hidden"
        disabled={isUploading || !uploadAvailable}
        multiple
        onChange={handleFileChange}
        ref={filteredInputRef}
        type="file"
      />
      <div className="upload-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <Upload aria-hidden="true" size={22} />
        <strong>Přetáhněte zvukový záznam nebo MP4 sem</strong>
        <span>{formatSummary}</span>
        <div className="real-upload-actions">
          <button
            disabled={isUploading || !uploadAvailable}
            onClick={() => filteredInputRef.current?.click()}
            type="button"
          >
            <Upload aria-hidden="true" size={18} />
            Vybrat soubor
          </button>
        </div>
      </div>

      <div className="upload-status-panel" data-phase={phase} data-upload-status="true">
        <div className="upload-file-summary">
          <span className="upload-current-file" title={selectedFiles?.name}>{fileLabel}</span>
          <span>
            {selectedFiles ? formatFileSize(selectedFiles.totalSize) : "Bez vybraného souboru"}
            {selectedFiles && selectedFiles.count > 1 ? ` · ${selectedFiles.count} soubory` : ""}
          </span>
          <span>Limit {maxFileSizeBytes === null ? "není dostupný" : formatFileSize(maxFileSizeBytes)}</span>
        </div>
        <div className="upload-progress">
          <progress
            aria-label="Celkový průběh nahrávání"
            max={totalProgressMax}
            value={Math.min(totalProgressValue, totalProgressMax)}
          />
          <span>
            {isUploading && currentFileName
              ? `Soubor ${currentFileIndex === null ? "" : `${currentFileIndex + 1} z ${totalFiles} · `}${currentFileProgress?.percentage ?? 0} %`
              : phase === "success" ? "Nahrávání dokončeno" : "Průběh se zobrazí po zahájení"}
          </span>
        </div>
        <p
          className={`upload-state upload-state-${uploadState.tone}`}
          aria-live={uploadState.tone === "error" ? "assertive" : undefined}
          role={uploadState.tone === "error" ? "alert" : undefined}
        >
          {uploadState.message}
        </p>
        <div className="upload-terminal-actions">
          {isUploading ? (
            <button
              className="secondary-upload-button"
              disabled={phase === "finalizing"}
              onClick={() => operationGuardRef.current?.cancel()}
              type="button"
            >
              <X aria-hidden="true" size={18} />
              {phase === "finalizing" ? "Dokončuji…" : "Zrušit nahrávání"}
            </button>
          ) : null}
          {canRetry ? (
            <button className="secondary-upload-button" onClick={() => void processFiles(retryFilesRef.current)} type="button">
              <RotateCcw aria-hidden="true" size={18} />
              Zkusit znovu
            </button>
          ) : null}
        </div>
      </div>

      <p aria-atomic="true" className="visually-hidden" role="status">
        {uploadState.tone === "error" ? "" : announcement}
      </p>
    </div>
  );
}
