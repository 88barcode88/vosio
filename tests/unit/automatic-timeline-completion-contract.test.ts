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
});
