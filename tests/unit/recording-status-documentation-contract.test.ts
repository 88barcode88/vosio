import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reads one canonical document for assertions that prevent UI-contract drift.
const read = (path: string) => readFileSync(path, "utf8");

describe("recording status documentation contract", () => {
  it("documents V1 list and search RPCs as compatibility-only and the current UI as V2", () => {
    const documents = [
      "docs/gotchas.md",
      "docs/requirements/real-workspace.md",
      "docs/api/supabase-schema.md",
      "docs/architecture.md"
    ];

    for (const path of documents) {
      const source = read(path);

      expect(source, path).toContain("list_own_recordings_v2");
      expect(source, path).toContain("search_own_recordings_v2");
      expect(source, path).toContain("count_own_recording_statuses_v1");
      expect(source, path).toMatch(/V1[^\n]*(compatibility-only|pouze pro kompatibilitu)/iu);
      expect(source, path).toMatch(/(current|současné) UI[^\n]*(unconditionally|bezpodmínečně)[^\n]*V2/iu);
    }
  });

  it("keeps facets full-scope and the deleted count separate", () => {
    for (const path of [
      "docs/gotchas.md",
      "docs/requirements/real-workspace.md",
      "docs/api/supabase-schema.md",
      "docs/architecture.md"
    ]) {
      const source = read(path);

      expect(source, path).toMatch(/facet[^\n]*`q`[^\n]*(organization|organizační)[^\n]*(tag|štít)/iu);
      expect(source, path).toMatch(/facet[^\n]*(ignore|ignor)[^\n]*(active|aktivní)[^\n]*status/iu);
      expect(source, path).toMatch(/(deleted|Smazáno)[^\n]*(separate|samostat)/iu);
    }
  });

  it("keeps the organization editor in a right Drawer and the sidebar label current", () => {
    const architecture = read("docs/architecture.md");
    const design = read("DESIGN.md");

    expect(architecture).toContain("keep-mounted pravý Drawer");
    expect(architecture).not.toContain("aktuální stránky search RPC");
    expect(design).toContain("- `AI prompty`,");
    expect(design).not.toContain("- `Prompty`,");
  });

  it("documents the current flat recordings inbox geometry and unchanged filter scope", () => {
    const architecture = read("docs/architecture.md");
    const design = read("DESIGN.md");
    const gotchas = read("docs/gotchas.md");
    const uiDirection = read("docs/requirements/ui-direction.md");

    for (const [path, source] of [
      ["DESIGN.md", design],
      ["docs/architecture.md", architecture],
      ["docs/gotchas.md", gotchas],
      ["docs/requirements/ui-direction.md", uiDirection]
    ]) {
      expect(source, path).toContain("128 px");
      expect(source, path).toMatch(/680 px/u);
    }

    expect(design).toContain("jeden vnější rámeček");
    expect(uiDirection).toContain("jeden kompaktní toolbar");
    expect(architecture).toContain("`q`, `status`, `client`, `project`, `folder` a opakovatelný `tag`");
    expect(gotchas).toContain("Zdroj a datum");
    expect(gotchas).toContain("nejsou součástí tohoto UI-only řezu");
  });
});
