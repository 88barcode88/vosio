"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Files, Upload } from "lucide-react";
import { useRecordingNavigationBlocker } from "@/components/recording-navigation-guard";
import { formatFileSize, RECORDING_FILE_ACCEPT } from "@/lib/recordings/types";
import { createUploadOperationGuard, createUploadQueue } from "@/lib/recordings/upload-queue";
import { createUploadProgressTracker, type AggregateUploadProgress } from "@/lib/recordings/upload-progress";
import type { RecordingUploadProgress } from "@/lib/recordings/resumable-upload";
import { uploadRecording, validateAudioFile } from "@/lib/recordings/upload";

type UploadState = {
  message: string;
  tone: "error" | "success" | "working";
};

type RecordingUploadFormProps = {
  maxFileSizeBytes: number | null;
  redirectAfterUpload?: "detail" | "list";
};

// getCancelledUploadMessage preserves a meaningful cancellation persistence error for the visible upload result.
export function getCancelledUploadMessage(input: {
  cancellationReason: unknown | null;
  succeededCount: number;
  totalCount: number;
}) {
  const detail = input.cancellationReason instanceof Error &&
    input.cancellationReason.message !== "Nahrávání bylo zrušeno."
    ? ` ${input.cancellationReason.message}`
    : "";

  if (input.succeededCount > 0) {
    return `Nahrávání zrušeno. Uloženo ${input.succeededCount} z ${input.totalCount} nahrávek.${detail}`;
  }

  return detail.trim() || "Nahrávání bylo zrušeno.";
}

// RecordingUploadForm uploads selected audio and records its metadata.
export function RecordingUploadForm({
  maxFileSizeBytes,
  redirectAfterUpload
}: RecordingUploadFormProps) {
  const filteredInputRef = useRef<HTMLInputElement>(null);
  const unfilteredInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const operationGuardRef = useRef<ReturnType<typeof createUploadOperationGuard> | null>(null);
  const router = useRouter();
  const { registerNavigationBlocker } = useRecordingNavigationBlocker();
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [phase, setPhase] = useState<"transferring" | "finalizing" | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
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
    if (!isUploading) {
      return;
    }

    return registerNavigationBlocker();
  }, [isUploading, registerNavigationBlocker]);

  // handleFileChange performs the authenticated upload flow for selected recording files.
  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (maxFileSizeBytes === null) {
      event.target.value = "";
      return;
    }

    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    const validationError = files
      .map((file) => validateAudioFile(file, maxFileSizeBytes))
      .find(Boolean);
    if (validationError) {
      setUploadState({ message: validationError, tone: "error" });
      event.target.value = "";
      return;
    }

    const operationGuard = createUploadOperationGuard();
    const progressTracker = createUploadProgressTracker(files);
    operationGuardRef.current = operationGuard;
    setIsUploading(true);
    setPhase("transferring");
    setAnnouncement(`Nahrávání souboru 1 z ${files.length} začalo.`);
    setCurrentFileIndex(0);
    setCurrentFileName(files[0]?.name ?? null);
    setTotalFiles(files.length);
    setCurrentFileProgress({
      bytesSent: 0,
      bytesTotal: files[0]?.size ?? 0,
      percentage: 0
    });
    setProgress(progressTracker.getSnapshot());
    setUploadState({
      message: files.length === 1 ? "Nahrávám soubor..." : `Nahrávám ${files.length} souborů...`,
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

        const uploadedRecording = await uploadRecording({
          file,
          maxFileSizeBytes,
          onPhase: (nextPhase) => {
            if (operationGuard.canApplyEffects()) {
              setPhase(nextPhase);
              if (nextPhase === "finalizing") {
                setAnnouncement(`Dokončuji uložení souboru ${index + 1} z ${files.length}.`);
              }
            }
          },
          onProgress: (nextProgress) => {
            if (operationGuard.canApplyEffects()) {
              setCurrentFileProgress(nextProgress);
              setProgress(progressTracker.updateFileProgress(index, nextProgress.bytesSent));
            }
          },
          onResumableUploadTask: control.setActiveTask,
          sourceType: "upload"
        });
        if (operationGuard.canApplyEffects()) {
          setProgress(progressTracker.completeFile(index));
        }

        return uploadedRecording;
      });
      operationGuard.setActiveTask(queue);
      const result = await queue.run();
      operationGuard.setActiveTask(null);

      event.target.value = "";

      if (!operationGuard.canApplyEffects() || !mountedRef.current) {
        return;
      }

      if (result.cancelled) {
        setUploadState({
          message: getCancelledUploadMessage({
            cancellationReason: result.cancellationReason,
            succeededCount: result.succeeded.length,
            totalCount: files.length
          }),
          tone: result.succeeded.length > 0 ? "success" : "error"
        });

        if (result.succeeded.length > 0) {
          router.refresh();
        }

        return;
      }

      if (result.failed.length > 0) {
        const firstReason = result.failed[0]?.error;
        const detail = firstReason instanceof Error ? firstReason.message : "Upload selhal.";

        setUploadState({
          message:
            result.succeeded.length > 0
              ? `Uloženo ${result.succeeded.length} z ${files.length} nahrávek. ${detail}`
              : detail,
          tone: "error"
        });

        if (result.succeeded.length > 0) {
          router.refresh();
        }

        return;
      }

      setUploadState({
        message: files.length === 1 ? "Nahrávka je uložená." : `Uloženo ${files.length} nahrávek.`,
        tone: "success"
      });

      const lastRecordingId = result.succeeded[result.succeeded.length - 1]?.value.id ?? null;

      if (redirectAfterUpload === "detail" && files.length === 1 && lastRecordingId) {
        router.push(`/recordings/${lastRecordingId}`);
        return;
      }

      if (redirectAfterUpload === "list") {
        router.push("/recordings");
        return;
      }

      router.refresh();
    } finally {
      if (operationGuard.canApplyEffects() && mountedRef.current) {
        setIsUploading(false);
        setPhase(null);
        setAnnouncement(null);
      }

      if (operationGuardRef.current === operationGuard) {
        operationGuardRef.current = null;
      }
    }
  }

  return (
    <div aria-busy={isUploading} className="real-upload">
      <input
        accept={RECORDING_FILE_ACCEPT.join(",")}
        className="visually-hidden"
        disabled={isUploading || maxFileSizeBytes === null}
        multiple
        onChange={handleFileChange}
        ref={filteredInputRef}
        type="file"
      />
      <input
        className="visually-hidden"
        disabled={isUploading || maxFileSizeBytes === null}
        multiple
        onChange={handleFileChange}
        ref={unfilteredInputRef}
        type="file"
      />
      <div className="real-upload-actions">
        <button
          disabled={isUploading || maxFileSizeBytes === null}
          onClick={() => filteredInputRef.current?.click()}
          type="button"
        >
          <Upload size={18} />
          {phase === "finalizing" ? "Dokončuji…" : isUploading ? "Nahrávám..." : "Nahrát audio/MP4"}
        </button>
        <button
          className="secondary-upload-button"
          disabled={isUploading || maxFileSizeBytes === null}
          onClick={() => unfilteredInputRef.current?.click()}
          type="button"
        >
          <Files size={18} />
          Vybrat jiný soubor
        </button>
        {isUploading ? (
          <button
            className="secondary-upload-button"
            disabled={phase === "finalizing"}
            onClick={() => operationGuardRef.current?.cancel()}
            type="button"
          >
            {phase === "finalizing" ? "Dokončuji…" : "Zrušit nahrávání"}
          </button>
        ) : null}
      </div>
      {isUploading && announcement ? (
        <p aria-atomic="true" className="visually-hidden" role="status">
          {announcement}
        </p>
      ) : null}
      {isUploading && progress && currentFileName ? (
        <div className="upload-progress">
          <span className="upload-current-file" title={currentFileName}>
            Aktuální soubor {currentFileIndex === null ? "" : `${currentFileIndex + 1} z ${totalFiles}: `}{currentFileName}
          </span>
          <progress
            aria-label="Celkový průběh nahrávání"
            max={progress.bytesTotal || 1}
            value={progress.bytesSent}
          />
          <span>
            Soubor {currentFileProgress?.percentage ?? 0} % ({formatFileSize(currentFileProgress?.bytesSent ?? 0)} z {formatFileSize(currentFileProgress?.bytesTotal ?? 0)}) · Celkem {progress.percentage} % ({formatFileSize(progress.bytesSent)} z {formatFileSize(progress.bytesTotal)})
          </span>
        </div>
      ) : null}
      {uploadState ? (
        <p
          className={`upload-state upload-state-${uploadState.tone}`}
          aria-live={uploadState.tone === "error" ? "assertive" : uploadState.tone === "success" ? "polite" : "off"}
          role={uploadState.tone === "error" ? "alert" : uploadState.tone === "success" ? "status" : undefined}
        >
          {uploadState.message}
        </p>
      ) : null}
    </div>
  );
}
