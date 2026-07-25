import { describe, expect, it } from "vitest";
import { createUploadProgressTracker } from "@/lib/recordings/upload-progress";

describe("recording upload aggregate progress", () => {
  it("weights progress by file bytes instead of file count", () => {
    const tracker = createUploadProgressTracker([{ size: 10 }, { size: 90 }]);

    tracker.updateFileProgress(0, 10);
    tracker.updateFileProgress(1, 45);

    expect(tracker.getSnapshot()).toEqual({ bytesSent: 55, bytesTotal: 100, percentage: 55 });
  });

  it("keeps aggregate progress at its high-water mark when transports report stale bytes", () => {
    const tracker = createUploadProgressTracker([{ size: 100 }]);

    tracker.updateFileProgress(0, 80);
    tracker.updateFileProgress(0, 20);

    expect(tracker.getSnapshot()).toEqual({ bytesSent: 80, bytesTotal: 100, percentage: 80 });
  });

  it("caps file progress to known bytes and completes a finished file", () => {
    const tracker = createUploadProgressTracker([{ size: 12 }, { size: 8 }]);

    tracker.updateFileProgress(0, 99);
    tracker.completeFile(1);

    expect(tracker.getSnapshot()).toEqual({ bytesSent: 20, bytesTotal: 20, percentage: 100 });
  });
});
