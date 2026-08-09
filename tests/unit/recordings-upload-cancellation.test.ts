import { describe, expect, it } from "vitest";
import { getCancelledUploadMessage } from "@/components/recording-upload-form";
import { createUploadQueue } from "@/lib/recordings/upload-queue";
import { RecordingUploadCancelledError } from "@/lib/recordings/resumable-upload";

describe("cancelled recording upload result", () => {
  it("surfaces failed cancellation persistence from the queue in the form message", async () => {
    const cancellation = new RecordingUploadCancelledError();
    cancellation.message = "Nahrávání bylo zrušeno. Záznam se nepodařilo označit jako neúspěšný.";
    const queue = createUploadQueue(["call.webm"], async () => {
      throw cancellation;
    });

    const result = await queue.run();

    expect(result).toMatchObject({
      cancellationReason: cancellation,
      cancelled: true
    });
    expect(
      getCancelledUploadMessage({
        cancellationReason: result.cancellationReason,
        succeededCount: result.succeeded.length,
        totalCount: 1
      })
    ).toBe("Nahrávání bylo zrušeno. Záznam se nepodařilo označit jako neúspěšný.");
  });

  it("does not expose unexpected cancellation details after a familiar prefix", () => {
    const cancellation = new RecordingUploadCancelledError();
    cancellation.message = "Nahrávání bylo zrušeno. request-id=secret-123";

    expect(
      getCancelledUploadMessage({
        cancellationReason: cancellation,
        succeededCount: 0,
        totalCount: 1
      })
    ).toBe("Nahrávání bylo zrušeno.");
  });
});
