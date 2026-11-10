// Recording engine: wraps MediaRecorder, stores every chunk immediately and rotates to a new part at 90 % of the part size limit.

import { CHUNK_TIMESLICE_MS, PART_ROTATION_RATIO } from "../shared/constants.ts";
import type { ChunkRecord } from "../shared/types.ts";

export interface RecorderLike {
  state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(timeslice: number): void;
  stop(): void;
}

export interface RecorderEnv {
  createRecorder(): RecorderLike;
  saveChunk(chunk: ChunkRecord): Promise<void>;
  now(): number;
  onError(error: unknown): void;
}

interface PartContext {
  recorder: RecorderLike;
  part: number | null;
  bytes: number;
}

// Tells whether the current part reached the rotation threshold (90 % of the server's per-part limit).
export function shouldRotate(partBytes: number, maxPartBytes: number): boolean {
  return partBytes >= maxPartBytes * PART_ROTATION_RATIO;
}

export class SessionRecorder {
  private readonly env: RecorderEnv;
  private readonly sessionId: string;
  private readonly maxPartBytes: number;
  private current: PartContext | null = null;
  private storedParts = 0;
  private seq = 0;
  private rotating = false;
  private stopping = false;
  private writes: Promise<void> = Promise.resolve();
  private resolveStopped: (() => void) | null = null;

  constructor(env: RecorderEnv, params: { sessionId: string; maxPartBytes: number }) {
    this.env = env;
    this.sessionId = params.sessionId;
    this.maxPartBytes = params.maxPartBytes;
  }

  // Starts recording the first part.
  start(): void {
    this.begin();
  }

  // Creates a recorder for a new part; its part number is assigned on the first stored chunk so numbering stays contiguous.
  private begin(): void {
    const recorder = this.env.createRecorder();
    const context: PartContext = { recorder, part: null, bytes: 0 };
    this.current = context;
    recorder.ondataavailable = (event) => this.onData(context, event.data);
    recorder.onstop = () => this.onStopped();
    recorder.start(CHUNK_TIMESLICE_MS);
  }

  // Queues a chunk write (serialized) and triggers rotation when the part is nearly full.
  private onData(context: PartContext, blob: Blob): void {
    if (blob.size === 0) return;
    if (context.part === null) {
      context.part = this.storedParts;
      this.storedParts += 1;
    }
    context.bytes += blob.size;
    const chunk: ChunkRecord = { sessionId: this.sessionId, part: context.part, seq: this.seq, t: this.env.now(), blob };
    this.seq += 1;
    this.writes = this.writes.then(() => this.env.saveChunk(chunk)).catch((error) => this.env.onError(error));
    if (!this.stopping && !this.rotating && shouldRotate(context.bytes, this.maxPartBytes)) {
      this.rotating = true;
      context.recorder.stop();
    }
  }

  // Continues with a fresh recorder after a rotation stop, or resolves a pending stop().
  private onStopped(): void {
    if (this.rotating && !this.stopping) {
      this.rotating = false;
      this.begin();
      return;
    }
    this.resolveStopped?.();
  }

  // Stops recording, waits until every chunk is persisted and returns the number of stored parts.
  async stop(): Promise<number> {
    this.stopping = true;
    const recorder = this.current?.recorder;
    // A rotation stop may still be in flight (state already inactive but the final chunk/stop event pending).
    if (recorder && (recorder.state !== "inactive" || this.rotating)) {
      const stopped = new Promise<void>((resolve) => {
        this.resolveStopped = resolve;
      });
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
    }
    await this.writes;
    return this.storedParts;
  }

  // Number of parts that already hold audio.
  get parts(): number {
    return this.storedParts;
  }
}
