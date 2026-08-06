import { describe, expect, it } from "vitest";
import { getAudioPlaybackEligibility } from "@/lib/recordings/audio-playback";

describe("recording audio playback eligibility", () => {
  it("rejects recordings without one stored audio object", () => {
    expect(getAudioPlaybackEligibility({ storage_path: null })).toEqual({
      eligible: false,
      reason: "no_audio"
    });
    expect(getAudioPlaybackEligibility({ storage_path: "u/r/live/" })).toEqual({
      eligible: false,
      reason: "segmented"
    });
  });

  it("accepts one stored audio object", () => {
    expect(getAudioPlaybackEligibility({ storage_path: "u/r/audio.webm" })).toEqual({
      eligible: true
    });
  });
});
