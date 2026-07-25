import { describe, expect, it, vi } from "vitest";
import {
  UploadQueueCancelledError,
  createUploadOperationGuard,
  createUploadQueue
} from "@/lib/recordings/upload-queue";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

describe("recording upload queue", () => {
  it("runs files strictly one at a time", async () => {
    const first = createDeferred<string>();
    const started: number[] = [];
    const queue = createUploadQueue(["first", "second"], async (file, index) => {
      started.push(index);
      if (file === "first") {
        return first.promise;
      }

      return "second-result";
    });
    const completion = queue.run();

    expect(started).toEqual([0]);
    first.resolve("first-result");

    await expect(completion).resolves.toMatchObject({
      cancellationReason: null,
      cancelled: false,
      failed: [],
      succeeded: [
        { index: 0, value: "first-result" },
        { index: 1, value: "second-result" }
      ]
    });
    expect(started).toEqual([0, 1]);
  });

  it("continues after ordinary upload failures", async () => {
    const queue = createUploadQueue(["first", "second"], async (file) => {
      if (file === "first") {
        throw new Error("network failed");
      }

      return "second-result";
    });

    await expect(queue.run()).resolves.toMatchObject({
      cancellationReason: null,
      cancelled: false,
      failed: [{ index: 0 }],
      succeeded: [{ index: 1, value: "second-result" }]
    });
  });

  it("aborts the active task and never starts queued files after cancellation", async () => {
    const first = createDeferred<string>();
    const activeTask = { cancel: vi.fn() };
    const started: number[] = [];
    const queue = createUploadQueue(["first", "second"], async (file, index, control) => {
      started.push(index);
      control.setActiveTask(activeTask);
      if (file === "first") {
        return first.promise;
      }

      return "second-result";
    });
    const completion = queue.run();

    queue.cancel();
    first.reject(new UploadQueueCancelledError());

    await expect(completion).resolves.toMatchObject({
      cancellationReason: expect.any(UploadQueueCancelledError),
      cancelled: true,
      succeeded: [],
      failed: []
    });
    expect(activeTask.cancel).toHaveBeenCalledOnce();
    expect(started).toEqual([0]);
  });

  it("marks unmounted operations cancelled and prevents later UI effects", () => {
    const activeTask = { cancel: vi.fn() };
    const guard = createUploadOperationGuard();

    guard.setActiveTask(activeTask);
    guard.unmount();

    expect(guard.isCancelled()).toBe(true);
    expect(guard.canApplyEffects()).toBe(false);
    expect(activeTask.cancel).toHaveBeenCalledOnce();
  });
});
