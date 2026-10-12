import { createClient } from "@/lib/supabase/browser";
import { queueLiveCapture } from "@/lib/recordings/live-capture-queue";
import { applyCaptureTransition, captureReceiptSchema, CaptureError, createCaptureAttempt, createCaptureDraft, getCaptureState, type CaptureAttempt } from "@/lib/recordings/capture";
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
  capture?: CaptureAttempt;
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
  capture?: CaptureAttempt;
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

// Check recovery authority after interruption; retain uploading state and the exact resumable object.
async function markRecordingUploadFailed(input: {
  id: string;
  message: string;
  supabase: ReturnType<typeof createClient>;
}) {
  try {
    // An interrupted transfer stays uploading so the same fixed TUS object can resume.
    await getCaptureState(input.supabase, input.id);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error("Stav nahrávky se nepodařilo ověřit.");
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

  const capture = input.capture ?? createCaptureAttempt();
  const id = await createCaptureDraft(supabase, capture, input.title?.trim() || getRecordingTitle(input.file), input.sourceType);
  const recording = { id };
  const state = await getCaptureState(supabase, id);
  capture.captureRevision = state.captureRevision;
  const filename = `${capture.requestId}-${sanitizeFilename(input.file.name).slice(-150)}`;
  if (state.status === "uploaded" && capture.requests.upload_complete) {
    await applyCaptureTransition(supabase, capture, "upload_complete", capture.requests.upload_complete.payload);
    return { id, storagePath: `${user.id}/${id}/${filename}` };
  }
  const { data: storagePath, error: prepareError } = await supabase.rpc("prepare_recording_upload_v1", {
    p_recording_id: id, p_filename: filename, p_mime_type: contentType, p_file_size_bytes: input.file.size
  });
  if (prepareError || typeof storagePath !== "string") throw new CaptureError(prepareError?.code ?? "invalid_response");
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
      if (failedUpdateError instanceof CaptureError && failedUpdateError.code === "42501") throw failedUpdateError;

      if (error instanceof RecordingUploadCancelledError) {
        if (failedUpdateError) {
          error.message = `${error.message} Stav nahrávky se nepodařilo ověřit. Obnovte stav před dalším pokusem.`;
          error.cause = failedUpdateError;
        }

        throw error;
      }

      const uploadErrorMessage = getUploadErrorMessage(message, input.maxFileSizeBytes);
      if (failedUpdateError) {
        throw new Error(`${uploadErrorMessage} Stav nahrávky se nepodařilo ověřit. Obnovte stav před dalším pokusem.`);
      }

      throw new Error(uploadErrorMessage);
    }

    throw error;
  }

  await applyCaptureTransition(supabase, capture, "upload_complete", { transition: "upload_complete", mimeType: contentType, fileSizeBytes: input.file.size });

  return {
    id: recording.id,
    storagePath
  };
}

// createLiveRecordingDraft creates one recoverable DB row before live recording starts.
export async function createLiveRecordingDraft(input: {
  capture?: CaptureAttempt;
  sourceType?: "in_app_recording" | "realtime";
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

  const capture = input.capture ?? createCaptureAttempt();
  const recording = { id: await createCaptureDraft(supabase, capture, input.title, input.sourceType ?? "in_app_recording") };

  const storagePrefix = getLiveRecordingStoragePrefix(user.id, recording.id as string);

  return {
    capture,
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
  const { data: storagePath, error: prepareError } = await supabase.rpc("prepare_recording_upload_v1", {
    p_recording_id: input.recording.id, p_filename: `live/recording.${sanitizeFilename(input.extension)}`,
    p_mime_type: input.contentType, p_file_size_bytes: input.blob.size
  });
  if (prepareError || typeof storagePath !== "string") throw new CaptureError(prepareError?.code ?? "invalid_response");
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

// adoptLegacyLiveRecordingParts registers the complete browser scope before any legacy part is resumed.
export async function adoptLegacyLiveRecordingParts(manifest: DurableSafetyManifest) {
  const parts = validateSafetyPartListing(manifest.parts).map(({ item }) => item);
  if (parts.length !== manifest.partCount || parts.some((part) => part.ownerId !== manifest.ownerId
    || part.recordingId !== manifest.recordingId || part.generationId !== manifest.generationId
    || part.size !== part.blob.size || part.name !== formatSafetyPartName(part.index, part.extension))) {
    throw new CaptureError("invalid_manifest");
  }
  const client = createClient();
  const auth = await client.auth.getUser();
  if (auth.error || auth.data.user?.id !== manifest.ownerId) throw new CaptureError("42501");
  const state = await getCaptureState(client, manifest.recordingId);
  const { data, error } = await client.rpc("adopt_legacy_live_parts_v1", {
    p_recording_id: manifest.recordingId, p_expected_capture_revision: state.captureRevision,
    p_parts: parts.map((part) => ({ index: part.index, mimeType: normalizeAudioMimeType(part.mimeType), bytes: part.size }))
  });
  if (error) throw new CaptureError(error.code ?? "unknown");
  if (data?.recordingId !== manifest.recordingId || data?.captureRevision !== state.captureRevision) throw new CaptureError("invalid_response");
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
  const partMimeType = normalizeAudioMimeType(input.contentType);
  const capture = input.recording.capture ??= createCaptureAttempt();
  await queueLiveCapture(capture, async () => {
    const state = await getCaptureState(supabase, input.recording.id);
    const { data, error } = await supabase.rpc("prepare_recording_live_part_v1", {
      p_recording_id: input.recording.id, p_expected_capture_revision: state.captureRevision,
      p_part_index: input.partIndex, p_mime_type: partMimeType, p_file_size_bytes: input.blob.size
    });
    if (error || data !== storagePath) throw new CaptureError(error?.code ?? "invalid_response");
  });
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
    contentType: partMimeType,
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
  const session = input.recording.capture ??= createCaptureAttempt();
  await queueLiveCapture(session, async () => {
    const capture = await captureForDraft(input.recording);
    if (input.storagePath === input.recording.storagePrefix) {
      const pending = capture.requests.live_parts_complete ??= {
        requestId: crypto.randomUUID(), revision: capture.captureRevision,
        payload: { transition: "upload_complete", durationSeconds: input.durationSeconds }
      };
      const { data, error } = await supabase.rpc("complete_recording_live_parts_v1", {
        p_recording_id: input.recording.id, p_request_id: pending.requestId,
        p_expected_capture_revision: pending.revision, p_duration_seconds: pending.payload.durationSeconds
      });
      if (error) throw new CaptureError(error.code ?? "unknown");
      const receipt = captureReceiptSchema.parse(data);
      if (receipt.recordingId !== input.recording.id) throw new CaptureError("invalid_response");
      capture.captureRevision = Math.max(capture.captureRevision, receipt.captureRevision);
    } else {
      await applyCaptureTransition(supabase, capture, "upload_complete", { transition: "upload_complete", durationSeconds: input.durationSeconds, mimeType: input.contentType, fileSizeBytes: input.totalBytes });
    }
  });
  return { id: input.recording.id };
}

// completeLiveRecordingWithoutAudio converts an oversized live capture into a text-only recording.
export async function completeLiveRecordingWithoutAudio(input: {
  durationSeconds: number;
  recording: LiveRecordingDraft;
}) {
  const supabase = createClient();
  const session = input.recording.capture ??= createCaptureAttempt();
  await queueLiveCapture(session, async () => {
    const capture = await captureForDraft(input.recording);
    await applyCaptureTransition(supabase, capture, "text_only", { transition: "text_only", durationSeconds: input.durationSeconds });
  });
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

  const recording = input.recording;
  const session = recording.capture ??= createCaptureAttempt();
  await queueLiveCapture(session, async () => {
    const capture = await captureForDraft(recording);
    await applyCaptureTransition(supabase, capture, "capture_failed", { transition: "capture_failed" });
  });
}

// Keep a live draft's revision on the persistent session object, refreshing only before a new transition.
export async function captureForDraft(recording: LiveRecordingDraft) {
  const capture = recording.capture ??= createCaptureAttempt();
  capture.recordingId = recording.id;
  const state = await getCaptureState(createClient(), recording.id);
  capture.captureRevision = state.captureRevision;
  return capture;
}
