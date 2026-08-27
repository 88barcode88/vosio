import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("automatic timeline completion entry points", () => {
  it.each([
    ["async and segmented", "app/api/recordings/[recordingId]/transcription/route.ts", ["kind: \"async\"", "kind: \"segmented\""]],
    ["live", "app/api/recordings/[recordingId]/live-transcript/route.ts", ["kind: \"live\""]],
    ["import", "app/api/recordings/import-transcript/route.ts", ["kind: \"import\""]]
  ])("enqueues only after persisted %s completion", (_label, path, identities) => {
    const source = readFileSync(path, "utf8");
    const completionIndex = source.lastIndexOf('status: "completed"');
    const enqueueIndex = source.lastIndexOf("enqueueAutomaticTimelineAfterCompletion");

    expect(enqueueIndex).toBeGreaterThan(completionIndex);
    for (const identity of identities) {
      expect(source).toContain(identity);
    }
  });

  it("regular and segmented repeats reconcile durable intent without resnapshotting current consent", () => {
    const source = readFileSync(
      "app/api/recordings/[recordingId]/transcription/route.ts",
      "utf8"
    );

    expect(source).toContain("isNewCompletedGeneration");
    expect(source).toContain("reconcileAutomaticTimeline");
  });

  it("live repeats reconcile durable intent while each new import snapshots completion consent", () => {
    const liveSource = readFileSync(
      "app/api/recordings/[recordingId]/live-transcript/route.ts",
      "utf8"
    );
    const importSource = readFileSync("app/api/recordings/import-transcript/route.ts", "utf8");

    expect(liveSource).toContain("isNewCompletedGeneration");
    expect(liveSource).toContain("reconcileAutomaticTimeline");
    expect(importSource).toContain("enqueueAutomaticTimelineAfterCompletion");
  });
});
