import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("trash query contract", () => {
  it("uses the frozen accessible list order and manager-only deletion metadata", () => {
    const queries = readFileSync(join(process.cwd(), "src", "lib", "recordings", "queries.ts"), "utf8");
    const manager = readFileSync(
      join(process.cwd(), "src", "components", "workspace", "trash-recordings-manager.tsx"),
      "utf8"
    );

    expect(queries).toContain('"list_accessible_recordings_v1"');
    expect(queries).toContain('"get_managed_recording_trash_v2"');
    expect(queries).toContain('p_before_created_at');
    expect(queries).not.toContain('.from("recordings")');
    expect(manager).toContain("recording.deleted_at");
    expect(manager).not.toContain("formatRecordingDate(recording.updated_at)");
    expect(manager).toContain("Automatické smazání");
    expect(manager).toContain("Trvalé smazání je dostupné 24 hodin");
  });
});
