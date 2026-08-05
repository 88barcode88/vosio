import { describe, expect, it, vi } from "vitest";
import {
  clampSeekSeconds,
  createPlaybackController,
  toAudioSeconds
} from "@/components/transcript-tabs/playback-controller";

// createAudioDouble provides the media fields used by the pure playback controller.
function createAudioDouble() {
  return {
    currentTime: 0,
    duration: Number.NaN,
    play: vi.fn().mockResolvedValue(undefined),
    readyState: 0
  };
}

describe("transcript playback controller", () => {
  it("converts milliseconds and clamps seeks against a finite duration", () => {
    expect(toAudioSeconds(12_345)).toBe(12.345);
    expect(toAudioSeconds(-500)).toBe(0);
    expect(clampSeekSeconds(15, 10)).toBe(10);
    expect(clampSeekSeconds(-2, 10)).toBe(0);
    expect(clampSeekSeconds(15, Number.NaN)).toBe(15);
    expect(toAudioSeconds(Number.NaN)).toBe(0);
    expect(toAudioSeconds(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampSeekSeconds(Number.POSITIVE_INFINITY, 10)).toBe(0);
    expect(clampSeekSeconds(15, Number.POSITIVE_INFINITY)).toBe(15);
  });

  it("queues a seek until metadata exists and preserves direct-click play", async () => {
    const audio = createAudioDouble();
    const controller = createPlaybackController(() => audio);

    await controller.seekToMs(12_345, { play: true });

    expect(audio.currentTime).toBe(0);
    expect(audio.play).not.toHaveBeenCalled();

    audio.duration = 10;
    audio.readyState = 1;
    await controller.flushPendingSeek();

    expect(audio.currentTime).toBe(10);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("keeps only the latest pending seek so an older play request cannot win a race", async () => {
    const audio = createAudioDouble();
    const controller = createPlaybackController(() => audio);

    await controller.seekToMs(1_000, { play: true });
    await controller.seekToMs(9_000, { play: false });
    audio.duration = 20;
    audio.readyState = 1;
    await controller.flushPendingSeek();

    expect(audio.currentTime).toBe(9);
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("seeks immediately after metadata and never plays without an explicit option", async () => {
    const audio = createAudioDouble();
    audio.duration = 30;
    audio.readyState = 1;
    const controller = createPlaybackController(() => audio);

    await controller.seekToMs(5_500);

    expect(audio.currentTime).toBe(5.5);
    expect(audio.play).not.toHaveBeenCalled();
  });
});
