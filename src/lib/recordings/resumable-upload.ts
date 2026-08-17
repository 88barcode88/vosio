import { Upload, type HttpRequest } from "tus-js-client";
import { getPublicEnv } from "@/lib/env";
import { RECORDINGS_BUCKET } from "@/lib/recordings/types";
import { createClient } from "@/lib/supabase/browser";

const RESUMABLE_UPLOAD_CHUNK_SIZE = 6 * 1024 * 1024;
const RESUMABLE_UPLOAD_RETRY_DELAYS = [0, 3000, 5000, 10000, 20000];

type BrowserSupabaseClient = {
  auth: {
    getSession: () => Promise<{
      data: { session: { access_token: string } | null };
      error?: { message: string } | null;
    }>;
  };
};

type TusUploadOptions = ConstructorParameters<typeof Upload>[1];

type TusUpload = Pick<Upload, "abort" | "start">;

export type RecordingUploadProgress = {
  bytesSent: number;
  bytesTotal: number;
  percentage: number;
};

export type ResumableRecordingUploadTask = {
  cancel: () => void;
  done: Promise<void>;
};

export type CreateResumableRecordingUploadInput = {
  contentType: string;
  file: Blob;
  objectName: string;
  onProgress?: (progress: RecordingUploadProgress) => void;
};

export type ResumableUploadDependencies = {
  createBrowserClient: () => BrowserSupabaseClient;
  createTusUpload: (file: Blob, options: TusUploadOptions) => TusUpload;
  getSupabaseUrl: () => string;
};

// RecordingUploadCancelledError identifies an intentional cancellation without exposing transport failures.
export class RecordingUploadCancelledError extends Error {
  constructor() {
    super("Nahrávání bylo zrušeno.");
    this.name = "RecordingUploadCancelledError";
  }
}

// normalizeUploadProgress converts tus byte counters into safe, UI-ready upload progress.
export function normalizeUploadProgress(bytesSent: number, bytesTotal: number): RecordingUploadProgress {
  const percentage = bytesTotal > 0
    ? Math.min(100, Math.max(0, Math.round((bytesSent / bytesTotal) * 100)))
    : 0;

  return { bytesSent, bytesTotal, percentage };
}

// getResumableUploadEndpoint maps Supabase hosted projects to their dedicated Storage host.
export function getResumableUploadEndpoint(supabaseUrl: string) {
  const endpoint = new URL(supabaseUrl);
  const hostedProject = endpoint.hostname.match(/^([^.]+)\.supabase\.co$/);

  if (hostedProject) {
    endpoint.hostname = `${hostedProject[1]}.storage.supabase.co`;
  }

  endpoint.pathname = "/storage/v1/upload/resumable";
  endpoint.search = "";
  endpoint.hash = "";

  return endpoint.toString();
}

// getSupabaseResumableUploadEndpoint keeps the explicit Supabase helper name available to callers.
export const getSupabaseResumableUploadEndpoint = getResumableUploadEndpoint;

// getSessionAccessToken reads the latest browser session token for upload authorization.
async function getSessionAccessToken(client: BrowserSupabaseClient) {
  const { data, error } = await client.auth.getSession();
  const accessToken = data.session?.access_token;

  if (error || !accessToken) {
    throw new Error("Přihlášení vypršelo. Přihlaste se znovu.");
  }

  return accessToken;
}

// createResumableRecordingUpload starts one fresh tus upload and exposes race-safe cancellation.
export function createResumableRecordingUpload(
  input: CreateResumableRecordingUploadInput,
  dependencyOverrides: Partial<ResumableUploadDependencies> = {}
): ResumableRecordingUploadTask {
  const dependencies: ResumableUploadDependencies = {
    createBrowserClient: createClient,
    createTusUpload: (file, options) => new Upload(file, options),
    getSupabaseUrl: () => getPublicEnv().supabaseUrl,
    ...dependencyOverrides
  };
  const client = dependencies.createBrowserClient();
  let cancelled = false;
  let completed = false;
  let settled = false;
  let upload: TusUpload | null = null;
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  // rejectUpload settles the task once while preserving cancellation as the terminal result.
  function rejectUpload(error: Error) {
    if (settled) {
      return;
    }

    settled = true;
    rejectDone(cancelled ? new RecordingUploadCancelledError() : error);
  }

  // resolveUpload marks a completed upload before future cancellation attempts can abort it.
  function resolveUpload() {
    if (settled || cancelled) {
      return;
    }

    completed = true;
    settled = true;
    resolveDone();
  }

  // startUpload authenticates before creating a fresh tus upload for this recording path.
  async function startUpload() {
    try {
      await getSessionAccessToken(client);

      if (cancelled) {
        return;
      }

      upload = dependencies.createTusUpload(input.file, {
        chunkSize: RESUMABLE_UPLOAD_CHUNK_SIZE,
        endpoint: getResumableUploadEndpoint(dependencies.getSupabaseUrl()),
        metadata: {
          bucketName: RECORDINGS_BUCKET,
          cacheControl: "3600",
          contentType: input.contentType,
          objectName: input.objectName
        },
        onBeforeRequest: async (request: HttpRequest) => {
          const accessToken = await getSessionAccessToken(client);

          if (cancelled) {
            throw new RecordingUploadCancelledError();
          }

          request.setHeader("authorization", `Bearer ${accessToken}`);
        },
        onError: (error) => rejectUpload(error),
        onProgress: (bytesSent, bytesTotal) => {
          if (!cancelled) {
            input.onProgress?.(normalizeUploadProgress(bytesSent, bytesTotal));
          }
        },
        onSuccess: resolveUpload,
        removeFingerprintOnSuccess: true,
        retryDelays: RESUMABLE_UPLOAD_RETRY_DELAYS,
        uploadDataDuringCreation: true
      });

      if (cancelled) {
        return;
      }

      upload.start();
    } catch (error) {
      rejectUpload(error instanceof Error ? error : new Error("Nahrávání selhalo."));
    }
  }

  void startUpload();

  return {
    cancel() {
      if (completed || settled) {
        return;
      }

      cancelled = true;
      rejectUpload(new RecordingUploadCancelledError());

      if (upload) {
        void upload.abort(true).catch(() => undefined);
      }
    },
    done
  };
}
