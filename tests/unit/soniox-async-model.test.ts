import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ sonioxAsyncModel: "stt-async-v6" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => env }));

import { DEFAULT_SONIOX_ASYNC_MODEL, isApprovedSonioxAsyncModel } from "@/lib/model-options";
import { assertTranscriptionModel } from "@/lib/recordings/transcription-worker.server";

afterEach(() => { env.sonioxAsyncModel = "stt-async-v6"; });

describe("Soniox async model allowlist", () => {
  it("defaults new transcriptions to v6 and still accepts frozen v5 work", () => {
    expect(DEFAULT_SONIOX_ASYNC_MODEL).toBe("stt-async-v6");
    expect(isApprovedSonioxAsyncModel("stt-async-v6")).toBe(true);
    expect(isApprovedSonioxAsyncModel("stt-async-v5")).toBe(true);
    expect(isApprovedSonioxAsyncModel("stt-async-v7")).toBe(false);
  });

  it("rejects an unreviewed environment model before any provider work", () => {
    expect(assertTranscriptionModel()).toBe("stt-async-v6");
    env.sonioxAsyncModel = "stt-async-preview";
    expect(() => assertTranscriptionModel()).toThrow("Transcription model configuration requires review");
  });
});
