import { createClient } from "@/lib/supabase/browser";
import {
  RECORDINGS_BUCKET,
  SEGMENTED_RECORDING_STORAGE_FOLDER,
  formatFileSize,
  getRecordingContentType,
  normalizeAudioMimeType
} from "@/lib/recordings/types";
import {
  formatSafetyPartName,
  getSafetyPartExtension,
  validateSafetyPartListing
} from "@/lib/live-recording/safety-parts";
import {
  getDurableAudioPartKey,
  type DurableSafetyManifest
} from "@/lib/live-recording/durable-audio";
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

export type LiveRecordingPartUploadInput = {
  blob: Blob;
  contentType: string;
  maxFileSizeBytes: number;
  partIndex: number;
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

// getLiveRecordingPartStoragePath creates the deterministic canonical path for one safety part.
export function getLiveRecordingPartStoragePath(input: {
  contentType: string;
  partIndex: number;
  recording: LiveRecordingDraft;
}) {
  const extension = getSafetyPartExtension(input.contentType);

  if (!extension) {
    throw new Error("Podporovaný bezpečnostní formát je pouze WebM nebo M4A.");
  }

  const expectedPrefix = getLiveRecordingStoragePrefix(input.recording.userId, input.recording.id);

  if (input.recording.storagePrefix !== expectedPrefix) {
    throw new Error("Cesta audio části neodpovídá vlastníkovi nahrávky.");
  }

  return `${expectedPrefix}${formatSafetyPartName(input.partIndex, extension)}`;
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

// getStoragePartMetadata reads the exact size and MIME needed for idempotent collision checks.
function getStoragePartMetadata(item: { metadata?: unknown }) {
  if (typeof item.metadata !== "object" || item.metadata === null) {
    return null;
  }

  const metadata = item.metadata as { mimetype?: unknown; size?: unknown };

  if (typeof metadata.size !== "number" || typeof metadata.mimetype !== "string") {
    return null;
  }

  return { mimeType: normalizeAudioMimeType(metadata.mimetype), size: metadata.size };
}

// uploadLiveRecordingPart uploads one durable part idempotently without overwriting an existing object.
export async function uploadLiveRecordingPart(input: LiveRecordingPartUploadInput) {
  if (input.blob.size <= 0 || input.blob.size > input.maxFileSizeBytes) {
    throw new Error(`Audio část je větší než ${formatFileSize(input.maxFileSizeBytes)} nebo je prázdná.`);
  }

  const supabase = createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user || user.id !== input.recording.userId) {
    throw new Error("Přihlášení vypršelo. Přihlaste se znovu.");
  }

  const storagePath = getLiveRecordingPartStoragePath(input);
  const name = storagePath.slice(input.recording.storagePrefix.length);
  const folder = input.recording.storagePrefix.replace(/\/$/, "");
  const bucket = supabase.storage.from(RECORDINGS_BUCKET);

  // findExistingPart verifies both bytes and MIME before treating a deterministic path as already uploaded.
  async function findExistingPart() {
    const { data, error } = await bucket.list(folder, { limit: 100, search: name });

    if (error) {
      throw new Error("Uloženou část audia se nepodařilo ověřit.");
    }

    const exact = (data ?? []).find((item) => item.name === name);

    if (!exact) {
      return false;
    }

    const metadata = getStoragePartMetadata(exact);
    if (
      !metadata ||
      metadata.size !== input.blob.size ||
      metadata.mimeType !== normalizeAudioMimeType(input.contentType)
    ) {
      throw new Error("Uložená část audia neodpovídá tomuto záznamu.");
    }

    return true;
  }

  if (await findExistingPart()) {
    return { bytes: input.blob.size, reused: true, storagePath };
  }

  const { error: uploadError } = await bucket.upload(storagePath, input.blob, {
    cacheControl: "3600",
    contentType: input.contentType,
    upsert: false
  });

  if (uploadError) {
    if (await findExistingPart()) {
      return { bytes: input.blob.size, reused: true, storagePath };
    }

    throw new Error(getUploadErrorMessage(uploadError.message, input.maxFileSizeBytes));
  }

  return { bytes: input.blob.size, reused: false, storagePath };
}

// normalizeRemovedStorageObjectPath converts Supabase remove names to canonical bucket-relative paths.
function normalizeRemovedStorageObjectPath(name: unknown) {
  if (typeof name !== "string") {
    return null;
  }

  const normalized = name.replace(/^\/+/, "");
  return normalized.length > 0 ? normalized : null;
}

// removeRemoteDurableSafetyGeneration removes only confirmed uploaded parts from one exact manifest.
export async function removeRemoteDurableSafetyGeneration(input: {
  manifest: DurableSafetyManifest;
}) {
  const manifest = input.manifest;
  const validatedParts = validateSafetyPartListing(manifest.parts).map(({ item }) => item);

  if (
    !manifest.ownerId ||
    !manifest.recordingId ||
    !manifest.generationId ||
    validatedParts.length !== manifest.partCount ||
    validatedParts.some((part) => (
      part.ownerId !== manifest.ownerId ||
      part.recordingId !== manifest.recordingId ||
      part.generationId !== manifest.generationId ||
      part.uploadedAt === null ||
      part.key !== getDurableAudioPartKey(part) ||
      part.name !== formatSafetyPartName(part.index, part.extension)
    ))
  ) {
    throw new Error("Bezpečnostní části nemají potvrzenou identitu pro odstranění.");
  }

  const supabase = createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user || user.id !== manifest.ownerId) {
    throw new Error("Přihlášení vypršelo. Přihlaste se znovu.");
  }

  const storagePrefix = getLiveRecordingStoragePrefix(manifest.ownerId, manifest.recordingId);
  const paths = validatedParts.map((part) => `${storagePrefix}${part.name}`);
  const { data, error } = await supabase.storage.from(RECORDINGS_BUCKET).remove(paths);
  const removedPaths = (data ?? []).map((item) => normalizeRemovedStorageObjectPath(item.name));
  const removedPathSet = new Set(removedPaths);
  const confirmedExactPaths =
    removedPaths.length === paths.length &&
    removedPathSet.size === paths.length &&
    paths.every((path) => removedPathSet.has(path));

  if (error || !confirmedExactPaths) {
    throw new Error("Úložiště nepotvrdilo odstranění všech bezpečnostních částí.");
  }

  return { removed: paths.length };
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
  const { data, error } = await supabase
    .from("recordings")
    .update({
      duration_seconds: input.durationSeconds,
      file_size_bytes: input.totalBytes,
      mime_type: input.contentType,
      status: "uploaded",
      storage_path: input.storagePath
    })
    .eq("id", input.recording.id)
    .eq("user_id", input.recording.userId)
    .select("id")
    .maybeSingle();

  if (error || data?.id !== input.recording.id) {
    throw new Error("Audio je uložené, ale metadata nahrávky se neuložila.");
  }

  return { id: data.id as string };
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
