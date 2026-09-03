import {
  formatSafetyPartName,
  getSafetyPartExtension,
  type SafetyPartExtension
} from "@/lib/live-recording/safety-parts";

export type FinalizedSafetyPart = {
  blob: Blob;
  extension: SafetyPartExtension;
  index: number;
  mimeType: string;
  name: string;
  offsetMs: number;
  size: number;
};

type TimerHandle = unknown;

type RotatingSafetyRecorderInput = {
  clearTimer?: (handle: TimerHandle) => void;
  createRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  mimeType: string;
  now?: () => number;
  onPartFinalized: (part: FinalizedSafetyPart) => Promise<void> | void;
  partDurationMs: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  stream: MediaStream;
};

// createDefaultRecorder creates the browser recorder for one isolated cloned stream.
function createDefaultRecorder(stream: MediaStream, options: MediaRecorderOptions) {
  return new MediaRecorder(stream, options);
}

// scheduleDefaultTimer schedules exactly one rotation boundary.
function scheduleDefaultTimer(callback: () => void, delayMs: number) {
  return globalThis.setTimeout(callback, delayMs);
}

// clearDefaultTimer clears a rotation timer without affecting application timers.
function clearDefaultTimer(handle: TimerHandle) {
  globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
}

// RotatingSafetyRecorder owns one stream clone and fully stops every MediaRecorder part.
class RotatingSafetyRecorder {
  private active: MediaRecorder | null = null;
  private activeOffsetMs = 0;
  private chunks: Blob[] = [];
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly createRecorder: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  private readonly extension: SafetyPartExtension;
  private index = 0;
  private readonly mimeType: string;
  private readonly now: () => number;
  private operation = Promise.resolve();
  private readonly onPartFinalized: (part: FinalizedSafetyPart) => Promise<void> | void;
  private readonly partDurationMs: number;
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private startedAt: number | null = null;
  private readonly stream: MediaStream;
  private stopPromise: Promise<void> | null = null;
  private stopping = false;
  private timer: TimerHandle | null = null;

  // constructor validates the format before cloning the caller-owned stream.
  constructor(input: RotatingSafetyRecorderInput) {
    const extension = getSafetyPartExtension(input.mimeType);

    if (!extension) {
      throw new Error("Podporovaný bezpečnostní formát je pouze WebM nebo M4A.");
    }

    if (!Number.isFinite(input.partDurationMs) || input.partDurationMs <= 0) {
      throw new RangeError("Safety part duration must be positive.");
    }

    this.clearTimer = input.clearTimer ?? clearDefaultTimer;
    this.createRecorder = input.createRecorder ?? createDefaultRecorder;
    this.extension = extension;
    this.mimeType = input.mimeType;
    this.now = input.now ?? Date.now;
    this.onPartFinalized = input.onPartFinalized;
    this.partDurationMs = input.partDurationMs;
    this.setTimer = input.setTimer ?? scheduleDefaultTimer;
    this.stream = input.stream.clone();
  }

  // start opens the first complete part and its one-shot rotation timer.
  start() {
    if (this.startedAt !== null || this.stopping) {
      return;
    }

    this.startedAt = this.now();
    this.startPart();
  }

  // stop is idempotent and resolves only after the final complete part is persisted.
  stop() {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopping = true;
    this.clearRotationTimer();
    this.stopPromise = this.operation
      .then(() => this.finalizeActivePart(false))
      .finally(() => {
        for (const track of this.stream.getTracks()) {
          track.stop();
        }
      });

    return this.stopPromise;
  }

  // startPart creates a fresh recorder so no partially open Blob becomes durable.
  private startPart() {
    this.chunks = [];
    this.activeOffsetMs = Math.max(0, Math.round(this.now() - (this.startedAt ?? this.now())));
    const recorder = this.createRecorder(this.stream, { mimeType: this.mimeType });
    recorder.addEventListener("dataavailable", this.handleData);
    this.active = recorder;
    recorder.start();
    this.timer = this.setTimer(() => this.queueRotation(), this.partDurationMs);
  }

  // handleData retains browser chunks only until their recorder emits its final stop event.
  private readonly handleData = (event: Event) => {
    const blob = (event as BlobEvent).data;

    if (blob?.size > 0) {
      this.chunks.push(blob);
    }
  };

  // queueRotation serializes timer boundaries so two recorders never own the clone concurrently.
  private queueRotation() {
    this.timer = null;
    this.operation = this.operation.then(async () => {
      await this.finalizeActivePart(true);
    });
  }

  // finalizeActivePart waits for a full MediaRecorder stop before exposing one immutable Blob.
  private async finalizeActivePart(restartAfterStop: boolean) {
    const recorder = this.active;

    if (!recorder) {
      return;
    }

    this.active = null;
    this.clearRotationTimer();
    const offsetMs = this.activeOffsetMs;
    await new Promise<void>((resolve, reject) => {
      const handleStop = () => {
        recorder.removeEventListener("dataavailable", this.handleData);
        const chunks = this.chunks;
        this.chunks = [];
        const mimeType = recorder.mimeType || this.mimeType;
        const blob = new Blob(chunks, { type: mimeType });
        const part = blob.size > 0 ? {
          blob,
          extension: this.extension,
          index: this.index,
          mimeType,
          name: formatSafetyPartName(this.index, this.extension),
          offsetMs,
          size: blob.size
        } satisfies FinalizedSafetyPart : null;

        if (part) {
          this.index += 1;
        }

        if (restartAfterStop && !this.stopping) {
          this.startPart();
        }

        Promise.resolve(part ? this.onPartFinalized(part) : undefined).then(() => {
          resolve();
        }, reject);
      };

      recorder.addEventListener("stop", handleStop, { once: true });

      if (recorder.state === "inactive") {
        handleStop();
      } else {
        recorder.stop();
      }
    });
  }

  // clearRotationTimer cancels only this recorder's current boundary timer.
  private clearRotationTimer() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}

// createRotatingSafetyRecorder exposes lifecycle control without acquiring media or application state.
export function createRotatingSafetyRecorder(input: RotatingSafetyRecorderInput) {
  return new RotatingSafetyRecorder(input);
}
