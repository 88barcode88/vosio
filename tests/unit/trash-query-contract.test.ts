import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("trash query contract", () => {
  it("selects, orders and displays the immutable deletion timestamp", () => {
    const queries = readFileSync(join(process.cwd(), "src", "lib", "recordings", "queries.ts"), "utf8");
    const manager = readFileSync(
      join(process.cwd(), "src", "components", "workspace", "trash-recordings-manager.tsx"),
      "utf8"
    );

    expect(queries).toMatch(/recordingColumns[\s\S]*deleted_at/u);
    expect(queries).toContain('.order("deleted_at", { ascending: false })');
    expect(manager).toContain("recording.deleted_at");
    expect(manager).not.toContain("formatRecordingDate(recording.updated_at)");
  });
});
