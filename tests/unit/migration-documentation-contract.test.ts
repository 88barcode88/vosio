import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const restoreMigration = "20260810005550_restore_recordings_from_trash.sql";

describe("migration documentation contract", () => {
  it("lists the C7 restore migration in every current canonical chain document", () => {
    for (const path of [
      "supabase/README.md",
      "docs/requirements/real-workspace.md",
      "docs/api/supabase-schema.md",
      "docs/gotchas.md",
      "docs/decisions/0004-private-vosio-manual-forward-migrations.md"
    ]) {
      expect(readFileSync(path, "utf8"), path).toContain(restoreMigration);
    }
  });

  it("does not claim the unverified C7 migration is already live", () => {
    const readme = readFileSync("supabase/README.md", "utf8");

    expect(readme).toContain("05550");
    expect(readme).toMatch(/05550[^\n]*(unverified|neověřen|not applied|unapplied)/iu);
  });
});
