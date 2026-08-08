import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getContentAreaClassName } from "@/components/vosio-workspace";
import type { WorkspaceView } from "@/lib/workspace-data";

const layoutStyles = readFileSync(join(process.cwd(), "app", "styles", "workspace.css"), "utf8");

describe("Vosio workspace content area", () => {
  it("scrolls only the recordings list content area", () => {
    expect(getContentAreaClassName({
      hasActiveRecording: false,
      isCreatingRecording: false,
      view: "recordings"
    })).toBe("content-area content-area-recordings-list");

    const detailViews: WorkspaceView[] = ["recordings", "ai", "templates", "documentation", "trash", "settings"];
    for (const view of detailViews) {
      expect(getContentAreaClassName({
        hasActiveRecording: true,
        isCreatingRecording: false,
        view
      })).toBe("content-area");
    }
    expect(getContentAreaClassName({
      hasActiveRecording: false,
      isCreatingRecording: true,
      view: "recordings"
    })).toBe("content-area");
  });

  it("contains scrolling within the recordings list surface", () => {
    expect(layoutStyles).toMatch(
      /\.content-area-recordings-list\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior-y:\s*contain;/
    );
    expect(layoutStyles).toContain("overflow: hidden;");
  });
});
