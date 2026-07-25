import { describe, expect, it } from "vitest";
import { getRetranscriptionCleanupTranscriptId } from "@/lib/transcripts/retranscription";

describe("retranscription cleanup policy", () => {
  it("keeps the existing transcript while the replacement Soniox job is still pending or failed", () => {
    expect(
      getRetranscriptionCleanupTranscriptId({
        existingTranscriptId: "transcript-id",
        replacementTranscriptReady: false
      })
    ).toBeNull();
  });

  it("allows dependent AI cleanup only when a replacement transcript is ready to save", () => {
    expect(
      getRetranscriptionCleanupTranscriptId({
        existingTranscriptId: "transcript-id",
        replacementTranscriptReady: true
      })
    ).toBe("transcript-id");
  });
});
