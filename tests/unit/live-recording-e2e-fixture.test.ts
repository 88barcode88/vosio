import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("live recording development fixture", () => {
  it("keeps failure, limit, cleanup, and recovery evidence on the production recorder lifecycle", () => {
    const fixture = readFileSync("app/login/live-marker-e2e/live-marker-e2e-fixture.tsx", "utf8");
    const page = readFileSync("app/login/live-marker-e2e/page.tsx", "utf8");
    const spec = readFileSync("tests/e2e/live-recording-markers.spec.ts", "utf8");

    expect(fixture).toContain("PersistentRecorderSlot");
    expect(fixture).toContain("options.source");
    expect(fixture).toContain("Simulovat výpadek přepisu");
    expect(fixture).toContain("LiveRecordingRecoveryPanel");
    expect(page).toContain('"audio-limit"');
    expect(spec).toContain("restart=1");
    expect(spec).toContain("storageEvents");
    expect(spec).toContain("safety-upload");
    expect(spec).toContain("archive-upload");
    expect(spec).toContain("remote-cleanup");
    expect(spec).toContain("reload keeps a locally durable safety part recoverable");
  });
});
