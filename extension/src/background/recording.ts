// Recording state machine in the service worker: one recording at a time, start/stop orchestration, auto-stop signals, crash recovery.

import { FALLBACK_BITRATE, FALLBACK_MAX_PART_BYTES, RECORDER_MIME } from "../shared/constants.ts";
import { timing } from "../shared/format.ts";
import type { OffscreenStartResult } from "../shared/messages.ts";
import { leftMeetingUrl } from "../shared/platforms.ts";
import { readActiveRecording, readPairing, writeActiveRecording } from "../shared/storage.ts";
import type { ActiveRecording, CaptureConfig, PlatformId, StoredSession } from "../shared/types.ts";
import { getStore } from "../db/store.ts";
import { describeStatus } from "./pairing.ts";
import { finalizeSession, newSession, recoverOrphans } from "./sessions.ts";

export interface CaptureStartParams {
  sessionId: string;
  streamId: string;
  audioBitsPerSecond: number;
  maxPartBytes: number;
  recorderMimeType: string;
}

// Abstraction of the offscreen document that performs the actual capture (replaced by a fake in tests).
export interface CaptureBackend {
  start(params: CaptureStartParams): Promise<OffscreenStartResult>;
  stop(): Promise<void>;
  status(): Promise<string | null>;
  close(): Promise<void>;
}

export interface RecordingDeps {
  backend: CaptureBackend;
  getConfig(): Promise<CaptureConfig | null>;
  onChange(): void;
  kickUpload(): void;
}

export interface StartInput {
  tabId: number;
  streamId: string;
  tabTitle: string;
  tabUrl: string;
  platform: PlatformId;
  platformLabel: string;
  replaceExisting?: boolean;
}

export type StopReason = "manual" | "left-meeting" | "tab-closed" | "url-left" | "capture-ended" | "replaced";

export class RecordingController {
  private readonly deps: RecordingDeps;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(deps: RecordingDeps) {
    this.deps = deps;
  }

  // Serializes state transitions so start/stop calls from different events never interleave.
  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.catch(() => undefined);
    return result;
  }

  // Returns the active recording descriptor or null when idle.
  getActive(): Promise<ActiveRecording | null> {
    return readActiveRecording();
  }

  // Starts recording the given tab; refuses when unpaired or already recording (unless replaceExisting stops the old one first).
  start(input: StartInput): Promise<{ ok: boolean; error?: string }> {
    return this.run(async () => {
      if (await readActiveRecording()) {
        if (!input.replaceExisting) return { ok: false, error: "Už probíhá jiná nahrávka." };
        await this.stopInner("replaced");
      }
      const pairing = await readPairing();
      if (pairing.status !== "paired") return { ok: false, error: describeStatus(pairing.status) };
      const config = await this.deps.getConfig();
      const sessionId = crypto.randomUUID();
      const startedAt = timing.now();
      const store = getStore();
      await store.putSession(newSession({ id: sessionId, platform: input.platform, platformLabel: input.platformLabel, startedAt }));
      let result: OffscreenStartResult;
      try {
        result = await this.deps.backend.start({
          sessionId,
          streamId: input.streamId,
          audioBitsPerSecond: config?.audioBitsPerSecond ?? FALLBACK_BITRATE,
          maxPartBytes: config?.maxPartBytes ?? FALLBACK_MAX_PART_BYTES,
          recorderMimeType: config?.recorderMimeType ?? RECORDER_MIME
        });
      } catch (error) {
        result = { ok: false, micAvailable: false, error: error instanceof Error ? error.message : "Nahrávání se nepodařilo spustit." };
      }
      if (!result.ok) {
        await store.deleteSession(sessionId);
        await this.deps.backend.close().catch(() => undefined);
        return { ok: false, error: result.error ?? "Nahrávání se nepodařilo spustit." };
      }
      await writeActiveRecording({
        sessionId, tabId: input.tabId, platform: input.platform, platformLabel: input.platformLabel,
        tabTitle: input.tabTitle, startedAt, micAvailable: result.micAvailable, tabUrl: input.tabUrl
      });
      this.deps.onChange();
      return { ok: true };
    });
  }

  // Stops the current recording (if any), persists it as a pending upload and kicks the upload queue.
  stop(_reason: StopReason): Promise<StoredSession | null> {
    return this.run(() => this.stopInner(_reason));
  }

  // Body of stop(); runs inside the serialized chain.
  private async stopInner(_reason: StopReason): Promise<StoredSession | null> {
    const active = await readActiveRecording();
    if (!active) return null;
    await this.deps.backend.stop().catch(() => undefined);
    const session = await finalizeSession(active.sessionId, timing.now());
    await writeActiveRecording(null);
    await this.deps.backend.close().catch(() => undefined);
    this.deps.onChange();
    if (session) this.deps.kickUpload();
    return session;
  }

  // Stops when the recorded tab was closed.
  async handleTabRemoved(tabId: number): Promise<void> {
    const active = await readActiveRecording();
    if (active && active.tabId === tabId) await this.stop("tab-closed");
  }

  // Stops when the recorded tab navigated away from the meeting pattern of its platform.
  async handleUrlChange(tabId: number, url: string): Promise<void> {
    const active = await readActiveRecording();
    if (active && active.tabId === tabId && leftMeetingUrl(active.platform, active.tabUrl, url)) await this.stop("url-left");
  }

  // Stops when the content script saw the user leave the call.
  async handleLeftCall(tabId: number): Promise<void> {
    const active = await readActiveRecording();
    if (active && active.tabId === tabId) await this.stop("left-meeting");
  }

  // Stops when the offscreen document reports that the captured tab stream ended.
  async handleCaptureEnded(sessionId: string): Promise<void> {
    const active = await readActiveRecording();
    if (active && active.sessionId === sessionId) await this.stop("capture-ended");
  }

  // Startup recovery: keeps a still-running capture, otherwise converts orphaned sessions into pending uploads.
  recover(): Promise<StoredSession[]> {
    return this.run(async () => {
      const active = await readActiveRecording();
      const live = await this.deps.backend.status().catch(() => null);
      if (active && live === active.sessionId) return [];
      if (active) await writeActiveRecording(null);
      if (!live) await this.deps.backend.close().catch(() => undefined);
      const recovered = await recoverOrphans(live);
      this.deps.onChange();
      this.deps.kickUpload();
      return recovered;
    });
  }
}
