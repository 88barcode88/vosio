import { describe, expect, it } from "vitest";
import {
  getEstimatedLiveRecordingBytes,
  getLiveAudioFallbackMessage,
  getRecorderFeedbackAnnouncement,
  getRecordingActiveMessage,
  getStableLiveCaptionTokens,
  getRealtimeRecordingOptions,
  getRealtimeErrorMessage,
  getRealtimeStateWarning,
  getSaveModeLabel,
  getWakeLockWarning,
  shouldDiscardLiveRecordingAudio,
  tokensToCaptionBlocks,
  type LiveCaptionToken
} from "@/components/browser-recorder/helpers";

const token = (text: string, overrides: Partial<LiveCaptionToken> = {}): LiveCaptionToken => ({
  text,
  ...overrides
} as LiveCaptionToken);

describe("browser recorder helpers", () => {
  it("estimates the buffered audio size from the recorder bitrate", () => {
    expect(getEstimatedLiveRecordingBytes(128_000, 10)).toBe(160_000);
    expect(getEstimatedLiveRecordingBytes(0, 10)).toBe(160_000);
  });

  it("switches a long live recording to transcript-only at the audio limit", () => {
    const maxAudioFileSizeBytes = 100 * 1024 * 1024;
    const cutoffSeconds = (maxAudioFileSizeBytes * 8) / 128_000;

    expect(
      shouldDiscardLiveRecordingAudio(128_000, cutoffSeconds - 1, maxAudioFileSizeBytes)
    ).toBe(false);
    expect(shouldDiscardLiveRecordingAudio(128_000, cutoffSeconds, maxAudioFileSizeBytes)).toBe(true);
  });

  it("explains that live audio is saved only up to the Storage limit", () => {
    expect(getSaveModeLabel("audio_and_transcript", 100 * 1024 * 1024)).toBe(
      "Audio do 100 MB + přepis"
    );
    expect(getSaveModeLabel("audio_and_transcript", null)).toBe("Audio není dostupné");
  });

  it("explains whether audio was discarded early or the final Blob could not be saved", () => {
    const maxAudioFileSizeBytes = 128 * 1024 * 1024;

    expect(getLiveAudioFallbackMessage({
      audioDiscardedForSize: true,
      maxAudioFileSizeBytes
    })).toContain("zastaveno s rezervou před limitem");
    expect(getLiveAudioFallbackMessage({
      audioDiscardedForSize: false,
      maxAudioFileSizeBytes
    })).toContain("prázdný, neplatný nebo překročil limit");
  });

  it("keeps the active recording message independent from wake lock and realtime warnings", () => {
    expect(getRecordingActiveMessage("audio_and_transcript", 128 * 1024 * 1024)).toContain(
      "Audio se uloží do 128 MB"
    );
    expect(getRecordingActiveMessage("transcript_only", null)).toBe(
      "Přepisuji živě bez ukládání audio souboru."
    );
    expect(getWakeLockWarning(true)).toBeNull();
    expect(getWakeLockWarning(false)).toContain("telefon nezamykejte");
  });

  it("announces capture errors assertively and progress politely", () => {
    expect(getRecorderFeedbackAnnouncement("error")).toEqual({
      ariaLive: "assertive",
      role: "alert"
    });
    expect(getRecorderFeedbackAnnouncement("working")).toEqual({
      ariaLive: "polite",
      role: "status"
    });
  });

  it("reports Soniox reconnecting, errors, and cancellation without claiming audio stopped", () => {
    expect(getRealtimeStateWarning("reconnecting", "audio_and_transcript")).toContain(
      "Nahrávání pokračuje"
    );
    expect(getRealtimeStateWarning("error", "audio_and_transcript")).toContain(
      "Lokální audio se může dál nahrávat"
    );
    expect(getRealtimeStateWarning("canceled", "transcript_only")).toContain(
      "Textový režim nebude dostávat další přepis"
    );
    expect(getRealtimeErrorMessage(new Error("síť"), "audio_and_transcript")).toContain(
      "Lokální audio může dál pokračovat"
    );
  });

  it("uses long-running realtime options for live call capture", () => {
    expect(getRealtimeRecordingOptions("stt-rt-v5")).toMatchObject({
      auto_reconnect: true,
      enable_endpoint_detection: false,
      enable_language_identification: true,
      enable_speaker_diarization: true,
      language_hints: ["cs"],
      model: "stt-rt-v5"
    });
  });

  it("joins character-level live caption tokens without inserting spaces between letters", () => {
    expect(tokensToCaptionBlocks([
      token("V", { speaker: "1" }),
      token("l", { speaker: "1" }),
      token("o", { speaker: "1" }),
      token("ž", { speaker: "1" }),
      token("t", { speaker: "1" }),
      token("e", { speaker: "1" })
    ])).toMatchObject([{ text: "Vložte" }]);
  });

  it("preserves provider spacing and punctuation for live caption tokens", () => {
    expect(tokensToCaptionBlocks([
      token("Vložte", { speaker: "1" }),
      token(" hotový", { speaker: "1" }),
      token(" přepis", { speaker: "1" }),
      token(".", { speaker: "1" })
    ])).toMatchObject([{ text: "Vložte hotový přepis." }]);
  });

  it("keeps speaker blocks separate while joining text naturally", () => {
    expect(tokensToCaptionBlocks([
      token("Ahoj", { speaker: "1" }),
      token(".", { speaker: "1" }),
      token("Jasně", { speaker: "2" })
    ])).toMatchObject([
      { speaker: "Mluvčí 1", text: "Ahoj." },
      { speaker: "Mluvčí 2", text: "Jasně" }
    ]);
  });

  it("shows only stable live caption tokens by Soniox timing or arrival timing", () => {
    expect(getStableLiveCaptionTokens([
      token("staré", { end_ms: 1000 }),
      token("nové", { end_ms: 4500 }),
      token("fallback", { received_at_ms: 2000 })
    ], 5000, 2000).map((item) => item.text)).toEqual(["staré", "fallback"]);
  });
});
