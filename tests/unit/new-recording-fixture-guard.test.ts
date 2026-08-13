import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateNewRecordingFixtureAccess } from "../../app/login/new-recording-e2e/development-runtime";

describe("new recording E2E fixture guard", () => {
  it("accepts only scoped development success or error modes", () => {
    expect(validateNewRecordingFixtureAccess("development", "a1b2c3d4e5f6", "success")).toEqual({
      mode: "success",
      scope: "a1b2c3d4e5f6"
    });
    expect(validateNewRecordingFixtureAccess("development", "a1b2c3d4e5f6", "error")?.mode).toBe("error");
    expect(validateNewRecordingFixtureAccess("development", "invalid", "success")).toBeNull();
    expect(validateNewRecordingFixtureAccess("development", "a1b2c3d4e5f6", "other")).toBeNull();
    expect(validateNewRecordingFixtureAccess("production", "a1b2c3d4e5f6", "success")).toBeNull();
  });

  it("uses only inert live and transcript slots in fixture source", () => {
    const source = readFileSync(
      join(process.cwd(), "app", "login", "new-recording-e2e", "new-recording-fixture.tsx"),
      "utf8"
    );

    expect(source).not.toMatch(/BrowserRecorder|PersistentRecorderSlot|PersistentRecordingSessionProvider/u);
    expect(source).not.toMatch(/TranscriptImportForm/u);
    expect(source).not.toMatch(/fetch\s*\(|\/api\/|supabase|soniox/iu);
  });
});
