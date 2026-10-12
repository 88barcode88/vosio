import type { CaptureAttempt } from "@/lib/recordings/capture";

const writes = new WeakMap<CaptureAttempt, Promise<unknown>>();

// Serialize every revision-changing write for one immutable live session, including audio completion.
export function queueLiveCapture<T>(capture: CaptureAttempt, write: () => Promise<T>): Promise<T> {
  const pending = (writes.get(capture) ?? Promise.resolve()).catch(() => undefined).then(write);
  writes.set(capture, pending);
  return pending;
}
