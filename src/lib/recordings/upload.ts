import { createClient } from "@/lib/supabase/browser";
import {
  RECORDINGS_BUCKET,
  SEGMENTED_RECORDING_STORAGE_FOLDER,
  formatFileSize,
  getRecordingContentType
} from "@/lib/recordings/types";
import {
  createResumableRecordingUpload,
  RecordingUploadCancelledError,
  type RecordingUploadProgress,
  type ResumableRecordingUploadTask
} from "@/lib/recordings/resumable-upload";

export type UploadRecordingInput = {
  allowedMimeTypes: readonly string[];
  file: File;
  maxFileSizeBytes: number;
  onPhase?: (phase: UploadRecordingPhase) => void;
  onProgress?: (progress: RecordingUploadProgress) => void;
  onResumableUploadTask?: (task: ResumableRecordingUploadTask | null) => void;
  sourceType: "upload" | "in_app_recording";
  title?: string;
};

export type UploadRecordingPhase = "transferring" | "finalizing";

export type UploadRecordingResult = {
  id: string;
  storagePath: string;
};

export type LiveRecordingDraft = {
  id: string;
  storagePrefix: string;
  userId: string;
};

export type LiveRecordingUploadInput = {
  blob: Blob;
  contentType: string;
  extension: string;
  maxFileSizeBytes: number;
  recording: LiveRecordingDraft;
};

// sanitizeFilename keeps uploaded storage object names stable and URL-safe.
export function sanitizeFilename(filename: string) {
  const normalized = filename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

  return safe || "audio-upload";
}

// getLiveRecordingStoragePrefix returns the Storage folder for one live recording.
export function getLiveRecordingStoragePrefix(userId: string, recordingId: string) {
  return `${userId}/${recordingId}/${SEGMENTED_RECORDING_STORAGE_FOLDER}/`;
}

// getLiveRecordingStoragePath creates one final object path for an unsegmented live recording.
export function getLiveRecordingStoragePath(input: {
  extension: string;
  storagePrefix: string;
}) {
  const safeExtension = sanitizeFilename(input.extension).replace(/^\./, "") || "webm";

  return `${input.storagePrefix}recording.${safeExtension}`;
}

// getRecordingTitle derives a readable recording title from the selected file.
export function getRecordingTitle(file: File) {
  return file.name.replace(/\.[^.]+$/, "").trim() || "Nová nahrávka";
}

export const unsupportedRecordingMimeMessage =
  "Soubor nemá podporovaný MIME typ. Vyberte M4A, MP3, WAV, WebM, OGG, FLAC nebo MP4.";

// isAcceptedAudio checks the explicit MIME against the runtime Supabase bucket allowlist.
export function isAcceptedAudio(file: File, allowedMimeTypes: readonly string[]) {
  return allowedMimeTypes.includes(getRecordingContentType(file, allowedMimeTypes));
}

// validateAudioFile returns a user-facing error when a recording file cannot be uploaded.
export function validateAudioFile(
  file: File,
  maxFileSizeBytes: number | null,
  allowedMimeTypes: readonly string[] | null
) {
  if (maxFileSizeBytes === null || allowedMimeTypes === null || allowedMimeTypes.length === 0) {
    return "Nahrávání souborů teď není dostupné.";
  }

  if (!isAcceptedAudio(file, allowedMimeTypes)) return unsupportedRecordingMimeMessage;

  if (file.size > maxFileSizeBytes) {
    return `Soubor je větší než ${formatFileSize(maxFileSizeBytes)}.`;
  }

  return null;
}

// getUploadErrorMessage converts storage failures into short, non-technical Czech UI copy.
function getUploadErrorMessage(message: string, maxFileSizeBytes: number) {
  if (message.toLowerCase().includes("maximum allowed size")) {
    return `Soubor je větší než povolených ${formatFileSize(maxFileSizeBytes)}. Vyberte menší soubor.`;
  }

  return "Nahrání souboru se nepodařilo. Zkuste to znovu.";
}

// markRecordingUploadFailed records a recoverable terminal state and reports a failed recovery update.
async function markRecordingUploadFailed(input: {
  id: string;
  message: string;
  supabase: ReturnType<typeof createClient>;
}) {
  try {
    const { error } = await input.supabase
      .from("recordings")
      .update({ error_message: input.message, status: "failed" })
      .eq("id", input.id);

    return error ? new Error(error.message) : null;
  } catch (error) {
    return error instanceof Error ? error : new Error("Nepodařilo se označit nahrávku jako neúspěšnou.");
  }
}

// uploadRecording creates metadata first, transfers audio with TUS, then finalizes the recording row.
export async function uploadRecording(input: UploadRecordingInput): Promise<UploadRecordingResult> {
  const supabase = createClient();
  const validationError = validateAudioFile(input.file, input.maxFileSizeBytes, input.allowedMimeTypes);

  if (validationError) {
    throw new Error(validationError);
  }

  const contentType = getRecordingContentType(input.file, input.allowedMimeTypes);
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("Přihlášení vypršelo. Přihlaste se znovu.");
  }

  const title = input.title?.trim() || getRecordingTitle(input.file);
  const { data: recording, error: insertError } = await supabase
    .from("recordings")
    .insert({
      file_size_bytes: input.file.size,
      mime_type: contentType,
      source_type: input.sourceType,
      status: "uploading",
      title,
      user_id: user.id
    })
    .select("id")
    .single();

  if (insertError || !recording) {
    throw new Error("Nepovedlo se vytvořit záznam nahrávky.");
  }

  const storagePath = `${user.id}/${recording.id}/${Date.now()}-${sanitizeFilename(input.file.name)}`;
  let transferCompleted = false;

  try {
    input.onPhase?.("transferring");
    const task = createResumableRecordingUpload({
      contentType,
      file: input.file,
      objectName: storagePath,
      onProgress: input.onProgress
    });
    input.onResumableUploadTask?.(task);
    await task.done;
    transferCompleted = true;
    input.onResumableUploadTask?.(null);
    input.onPhase?.("finalizing");
  } catch (error) {
    input.onResumableUploadTask?.(null);

    if (!transferCompleted) {
      const message = error instanceof Error ? error.message : "Nahrávání selhalo.";
      const failedUpdateError = await markRecordingUploadFailed({
        id: recording.id,
        message,
        supabase
      });

      if (error instanceof RecordingUploadCancelledError) {
        if (failedUpdateError) {
          error.message = `${error.message} Záznam se nepodařilo označit jako neúspěšný.`;
          error.cause = failedUpdateError;
        }

        throw error;
      }

      const uploadErrorMessage = getUploadErrorMessage(message, input.maxFileSizeBytes);
      if (failedUpdateError) {
        throw new Error(`${uploadErrorMessage} Záznam se nepodařilo označit jako neúspěšný.`);
      }

      throw new Error(uploadErrorMessage);
    }

    throw error;
  }

  const { error: updateError } = await supabase
    .from("recordings")
    .update({ status: "uploaded", storage_path: storagePath })
    .eq("id", recording.id);

  if (updateError) {
    const message = "Soubor je uložený, ale metadata se neuložila.";
    const failedUpdateError = await markRecordingUploadFailed({
      id: recording.id,
      message,
      supabase
    });

    if (failedUpdateError) {
      throw new Error(`${message} Záznam se nepodařilo označit jako neúspěšný.`);
    }

    throw new Error(message);
  }

  return {
    id: recording.id,
    storagePath
  };
}

// createLiveRecordingDraft creates one recoverable DB row before live recording starts.
export async function createLiveRecordingDraft(input: {
  contentType: string;
  title: string;
}): Promise<LiveRecordingDraft> {
  const supabase = createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("Přihlášení vypršelo. Přihlaste se znovu.");
  }

  const { data: recording, error } = await supabase
    .from("recordings")
    .insert({
      file_size_bytes: 0,
      mime_type: input.contentType,
      source_type: "in_app_recording",
      status: "uploading",
      title: input.title,
      user_id: user.id
    })
    .select("id")
    .single();

  if (error || !recording) {
    throw new Error("Nepovedlo se vytvořit záznam live nahrávky.");
  }

  const storagePrefix = getLiveRecordingStoragePrefix(user.id, recording.id as string);

  return {
    id: recording.id as string,
    storagePrefix,
    userId: user.id
  };
}

// uploadLiveRecording stores one finalized live audio object below the Storage size limit.
export async function uploadLiveRecording(input: LiveRecordingUploadInput) {
  if (input.blob.size === 0) {
    return { bytes: 0, storagePath: null };
  }

  if (input.blob.size > input.maxFileSizeBytes) {
    throw new Error(`Nahrávka je větší než ${formatFileSize(input.maxFileSizeBytes)}.`);
  }

  const supabase = createClient();
  const storagePath = getLiveRecordingStoragePath({
    extension: input.extension,
    storagePrefix: input.recording.storagePrefix
  });
  const { error } = await supabase.storage.from(RECORDINGS_BUCKET).upload(storagePath, input.blob, {
    cacheControl: "3600",
    contentType: input.contentType,
    upsert: false
  });

  if (error) {
    throw new Error(getUploadErrorMessage(error.message, input.maxFileSizeBytes));
  }

  return { bytes: input.blob.size, storagePath };
}

// completeLiveRecordingUpload marks one finalized live audio object as uploaded.
export async function completeLiveRecordingUpload(input: {
  contentType: string;
  durationSeconds: number;
  recording: LiveRecordingDraft;
  storagePath: string;
  totalBytes: number;
}) {
  const supabase = createClient();
  const { error } = await supabase
    .from("recordings")
    .update({
      duration_seconds: input.durationSeconds,
      file_size_bytes: input.totalBytes,
      mime_type: input.contentType,
      status: "uploaded",
      storage_path: input.storagePath
    })
    .eq("id", input.recording.id)
    .eq("user_id", input.recording.userId);

  if (error) {
    throw new Error("Audio je uložené, ale metadata nahrávky se neuložila.");
  }
}

// completeLiveRecordingWithoutAudio converts an oversized live capture into a text-only recording.
export async function completeLiveRecordingWithoutAudio(input: {
  durationSeconds: number;
  recording: LiveRecordingDraft;
}) {
  const supabase = createClient();
  const { error } = await supabase
    .from("recordings")
    .update({
      duration_seconds: input.durationSeconds,
      error_message: null,
      file_size_bytes: 0,
      source_type: "realtime",
      status: "uploaded",
      storage_path: null
    })
    .eq("id", input.recording.id)
    .eq("user_id", input.recording.userId);

  if (error) {
    throw new Error("Přepis je připravený, ale metadata nahrávky se neuložila.");
  }
}

// failLiveRecordingUpload stores a safe failure state for a started live recording.
export async function failLiveRecordingUpload(input: {
  message: string;
  recording: LiveRecordingDraft | null;
}) {
  if (!input.recording) {
    return;
  }

  const supabase = createClient();

  await supabase
    .from("recordings")
    .update({ error_message: input.message, status: "failed" })
    .eq("id", input.recording.id)
    .eq("user_id", input.recording.userId);
}
