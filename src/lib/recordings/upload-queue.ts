export type CancelableUploadTask = {
  cancel: () => void;
};

export type UploadQueueControl = {
  isCancelled: () => boolean;
  setActiveTask: (task: CancelableUploadTask | null) => void;
};

export type UploadQueueSuccess<Result> = {
  index: number;
  value: Result;
};

export type UploadQueueFailure = {
  error: unknown;
  index: number;
};

export type UploadQueueResult<Result> = {
  cancellationReason: unknown | null;
  cancelled: boolean;
  failed: UploadQueueFailure[];
  succeeded: UploadQueueSuccess<Result>[];
};

// UploadQueueCancelledError lets queue callers identify deliberate cancellation without transport coupling.
export class UploadQueueCancelledError extends Error {
  constructor() {
    super("Nahrávání bylo zrušeno.");
    this.name = "UploadQueueCancelledError";
  }
}

// isUploadQueueCancellation accepts the queue error and the resumable adapter's cancellation error.
function isUploadQueueCancellation(error: unknown) {
  return error instanceof UploadQueueCancelledError ||
    (error instanceof Error && error.name === "RecordingUploadCancelledError");
}

// createUploadQueue runs upload work one item at a time and stops only for cancellation.
export function createUploadQueue<Item, Result>(
  items: Item[],
  upload: (item: Item, index: number, control: UploadQueueControl) => Promise<Result>
) {
  let cancellationRequested = false;
  let activeTask: CancelableUploadTask | null = null;

  // cancel aborts the current transport and prevents the next queued item from starting.
  function cancel() {
    if (cancellationRequested) {
      return;
    }

    cancellationRequested = true;
    activeTask?.cancel();
  }

  const control: UploadQueueControl = {
    isCancelled: () => cancellationRequested,
    setActiveTask: (task) => {
      activeTask = task;

      if (cancellationRequested) {
        task?.cancel();
      }
    }
  };

  return {
    cancel,
    // run keeps later files independent from ordinary transfer failures.
    async run(): Promise<UploadQueueResult<Result>> {
      let cancellationReason: unknown | null = null;
      const failed: UploadQueueFailure[] = [];
      const succeeded: UploadQueueSuccess<Result>[] = [];

      for (const [index, item] of items.entries()) {
        if (cancellationRequested) {
          break;
        }

        try {
          const value = await upload(item, index, control);
          succeeded.push({ index, value });

          if (cancellationRequested) {
            break;
          }
        } catch (error) {
          if (cancellationRequested || isUploadQueueCancellation(error)) {
            cancellationRequested = true;
            cancellationReason = error;
            break;
          }

          failed.push({ error, index });
        } finally {
          activeTask = null;
        }
      }

      return { cancellationReason, cancelled: cancellationRequested, failed, succeeded };
    }
  };
}

// createUploadOperationGuard prevents cancelled or unmounted work from updating a React view.
export function createUploadOperationGuard() {
  let activeTask: CancelableUploadTask | null = null;
  let cancelled = false;
  let mounted = true;

  // cancel aborts active work without changing the mounted state.
  function cancel() {
    if (cancelled) {
      return;
    }

    cancelled = true;
    activeTask?.cancel();
  }

  return {
    // setActiveTask makes the current queue or transport abortable during unmount.
    setActiveTask(task: CancelableUploadTask | null) {
      activeTask = task;

      if (cancelled) {
        task?.cancel();
      }
    },
    cancel,
    // unmount cancels active work and makes all later UI and router effects no-ops.
    unmount() {
      mounted = false;
      cancel();
    },
    // isCancelled exposes the operation terminal state to async callers.
    isCancelled: () => cancelled,
    // canApplyEffects ensures a completed promise cannot affect an unmounted component.
    canApplyEffects: () => mounted
  };
}
