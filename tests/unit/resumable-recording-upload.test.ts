import { describe, expect, it, vi } from "vitest";
import {
  RecordingUploadCancelledError,
  createResumableRecordingUpload,
  getResumableUploadEndpoint,
  normalizeUploadProgress,
  type ResumableUploadDependencies
} from "@/lib/recordings/resumable-upload";

type UploadOptions = {
  chunkSize?: number;
  endpoint?: string | null;
  headers?: Record<string, string>;
  metadata?: Record<string, string>;
  onBeforeRequest?: (request: MockRequest) => Promise<void> | void;
  onError?: (error: Error) => void;
  onProgress?: (bytesSent: number, bytesTotal: number) => void;
  onSuccess?: () => void;
  removeFingerprintOnSuccess?: boolean;
  retryDelays?: number[] | null;
  uploadDataDuringCreation?: boolean;
};

type MockRequest = {
  setHeader: ReturnType<typeof vi.fn>;
};

// createDeferred lets cancellation tests hold authentication until the task is cancelled.
function createDeferred<T>() {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

// createUploadTestHarness isolates tus and Supabase behavior through the uploader's dependency injection.
function createUploadTestHarness(accessTokens = ["initial-token", "refreshed-token"]) {
  let options: UploadOptions | undefined;
  const upload = {
    abort: vi.fn<(shouldTerminate?: boolean) => Promise<void>>().mockResolvedValue(undefined),
    findPreviousUploads: vi.fn<() => Promise<unknown[]>>(),
    start: vi.fn<() => void>()
  };
  const getSession = vi.fn();

  for (const accessToken of accessTokens) {
    getSession.mockResolvedValueOnce({ data: { session: { access_token: accessToken } } });
  }
  getSession.mockResolvedValue({
    data: { session: { access_token: accessTokens.at(-1) ?? "initial-token" } }
  });

  const dependencies: ResumableUploadDependencies = {
    createBrowserClient: () => ({ auth: { getSession } }),
    createTusUpload: (_file, nextOptions) => {
      options = nextOptions as UploadOptions;
      return upload;
    },
    getSupabaseUrl: () => "https://project-ref.supabase.co"
  };

  return { dependencies, getSession, getUpload: () => upload, getOptions: () => options };
}

// flushPromises advances the authentication task without relying on a timer.
async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("resumable recording upload", () => {
  it("uses the Supabase Storage resumable endpoint for hosted and self-hosted URLs", () => {
    expect(getResumableUploadEndpoint("https://project-ref.supabase.co")).toBe(
      "https://project-ref.storage.supabase.co/storage/v1/upload/resumable"
    );
    expect(getResumableUploadEndpoint("https://storage.internal.example:5443")).toBe(
      "https://storage.internal.example:5443/storage/v1/upload/resumable"
    );
  });

  it("normalizes raw tus progress into a stable percentage", () => {
    expect(normalizeUploadProgress(3, 12)).toEqual({
      bytesSent: 3,
      bytesTotal: 12,
      percentage: 25
    });
    expect(normalizeUploadProgress(1, 0)).toEqual({
      bytesSent: 1,
      bytesTotal: 0,
      percentage: 0
    });
  });

  it("creates a fresh pre-authenticated upload with Supabase metadata and retry settings", async () => {
    const harness = createUploadTestHarness();
    createResumableRecordingUpload(
      {
        contentType: "audio/webm",
        file: new Blob(["audio"]),
        objectName: "user/recording/call.webm"
      },
      harness.dependencies
    );

    await flushPromises();

    expect(harness.getUpload().start).toHaveBeenCalledOnce();
    expect(harness.getUpload().findPreviousUploads).not.toHaveBeenCalled();
    expect(harness.getOptions()).toMatchObject({
      chunkSize: 6 * 1024 * 1024,
      endpoint: "https://project-ref.storage.supabase.co/storage/v1/upload/resumable",
      metadata: {
        bucketName: "recordings",
        cacheControl: "3600",
        contentType: "audio/webm",
        objectName: "user/recording/call.webm"
      },
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadDataDuringCreation: true
    });
    expect(harness.getOptions()?.headers).toBeUndefined();
    expect(harness.getSession).toHaveBeenCalledOnce();
    expect(harness.getOptions()).not.toHaveProperty("headers.x-upsert");
  });

  it("refreshes the authorization header before every tus request and reports normalized progress", async () => {
    const harness = createUploadTestHarness();
    const onProgress = vi.fn();
    createResumableRecordingUpload(
      {
        contentType: "audio/webm",
        file: new Blob(["audio"]),
        objectName: "user/recording/call.webm",
        onProgress
      },
      harness.dependencies
    );

    await flushPromises();
    const options = harness.getOptions();
    const request: MockRequest = { setHeader: vi.fn() };

    await options?.onBeforeRequest?.(request);
    options?.onProgress?.(3, 12);

    expect(request.setHeader).toHaveBeenCalledWith("authorization", "Bearer refreshed-token");
    expect(onProgress).toHaveBeenCalledWith({ bytesSent: 3, bytesTotal: 12, percentage: 25 });
  });

  it("sends exactly one refreshed authorization value on the initial tus request", async () => {
    const harness = createUploadTestHarness();
    createResumableRecordingUpload(
      {
        contentType: "audio/x-m4a",
        file: new Blob(["audio"]),
        objectName: "user/recording/call.m4a"
      },
      harness.dependencies
    );

    await flushPromises();
    const options = harness.getOptions();
    const effectiveHeaders = new Map(
      Object.entries(options?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])
    );
    const request: MockRequest = {
      setHeader: vi.fn((name: string, value: string) => {
        const normalizedName = name.toLowerCase();
        const currentValue = effectiveHeaders.get(normalizedName);
        effectiveHeaders.set(normalizedName, currentValue ? `${currentValue}, ${value}` : value);
      })
    };

    await options?.onBeforeRequest?.(request);

    expect(effectiveHeaders.get("authorization")).toBe("Bearer refreshed-token");
  });

  it("cancels before authentication without creating a tus upload", async () => {
    const session = createDeferred<{ data: { session: { access_token: string } } }>();
    const createTusUpload = vi.fn();
    const task = createResumableRecordingUpload(
      {
        contentType: "audio/webm",
        file: new Blob(["audio"]),
        objectName: "user/recording/call.webm"
      },
      {
        createBrowserClient: () => ({ auth: { getSession: () => session.promise } }),
        createTusUpload,
        getSupabaseUrl: () => "https://project-ref.supabase.co"
      }
    );
    const completion = task.done.catch((error: unknown) => error);

    task.cancel();
    session.resolve({ data: { session: { access_token: "initial-token" } } });

    await expect(completion).resolves.toBeInstanceOf(RecordingUploadCancelledError);
    await flushPromises();
    expect(createTusUpload).not.toHaveBeenCalled();
  });

  it("maps abort races to cancellation and ignores late tus events", async () => {
    const harness = createUploadTestHarness();
    const onProgress = vi.fn();
    const task = createResumableRecordingUpload(
      {
        contentType: "audio/webm",
        file: new Blob(["audio"]),
        objectName: "user/recording/call.webm",
        onProgress
      },
      harness.dependencies
    );

    await flushPromises();
    harness.getUpload().abort.mockRejectedValueOnce(new Error("abort raced with request failure"));
    task.cancel();
    harness.getOptions()?.onProgress?.(6, 12);
    harness.getOptions()?.onError?.(new Error("late tus failure"));

    await expect(task.done).rejects.toBeInstanceOf(RecordingUploadCancelledError);
    expect(harness.getUpload().abort).toHaveBeenCalledOnce();
    expect(harness.getUpload().abort).toHaveBeenCalledWith(true);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("does not abort after successful completion", async () => {
    const harness = createUploadTestHarness();
    const task = createResumableRecordingUpload(
      {
        contentType: "audio/webm",
        file: new Blob(["audio"]),
        objectName: "user/recording/call.webm"
      },
      harness.dependencies
    );

    await flushPromises();
    harness.getOptions()?.onSuccess?.();
    await expect(task.done).resolves.toBeUndefined();

    task.cancel();

    expect(harness.getUpload().abort).not.toHaveBeenCalled();
  });
});
