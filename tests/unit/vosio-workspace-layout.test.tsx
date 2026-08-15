import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getContentAreaClassName } from "@/components/vosio-workspace";
import type { WorkspaceView } from "@/lib/workspace-data";

const layoutStyles = readFileSync(join(process.cwd(), "app", "styles", "workspace.css"), "utf8");
const baseStyles = readFileSync(join(process.cwd(), "app", "styles", "base.css"), "utf8");
const responsiveStyles = readFileSync(join(process.cwd(), "app", "styles", "responsive.css"), "utf8");
const globalsStyles = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const controlHitTargetStyles = readFileSync(
  join(process.cwd(), "app", "styles", "control-hit-targets.css"),
  "utf8"
);

describe("Vosio workspace content area", () => {
  it("uses one main scroll owner for recording lists, detail documents and new recording", () => {
    expect(getContentAreaClassName({
      hasActiveRecording: false,
      isCreatingRecording: false,
      view: "recordings"
    })).toBe("content-area content-area-recordings-list");

    expect(getContentAreaClassName({
      hasActiveRecording: true,
      isCreatingRecording: false,
      view: "recordings"
    })).toBe("content-area content-area-document");

    const utilityViews: WorkspaceView[] = ["ai", "templates", "documentation", "trash", "settings"];
    for (const view of utilityViews) {
      expect(getContentAreaClassName({
        hasActiveRecording: true,
        isCreatingRecording: false,
        view
      })).toBe("content-area content-area-document");
    }
    expect(getContentAreaClassName({
      hasActiveRecording: false,
      isCreatingRecording: true,
      view: "recordings"
    })).toBe("content-area content-area-document");
  });

  it("contains scrolling within the recordings list surface", () => {
    expect(layoutStyles).toMatch(
      /\.content-area-recordings-list\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior-y:\s*contain;/
    );
    expect(layoutStyles).toContain("overflow: hidden;");
    expect(layoutStyles).toMatch(
      /\.content-area-document\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior-y:\s*contain;/
    );
  });

  it("switches short desktop shells to one document scroll owner without a sidebar scroller", () => {
    expect(responsiveStyles).toContain("@media (min-width: 901px) and (max-height: 640px)");
    expect(responsiveStyles).toMatch(
      /@media \(min-width: 901px\) and \(max-height: 640px\)[\s\S]*?\.sidebar\s*\{[\s\S]*?position:\s*static;[\s\S]*?height:\s*auto;[\s\S]*?overflow-y:\s*visible;/u
    );
    expect(responsiveStyles).toMatch(
      /@media \(min-width: 901px\) and \(max-height: 640px\)[\s\S]*?\.content-area[\s\S]*?\{[\s\S]*?height:\s*auto;[\s\S]*?overflow-y:\s*visible;/u
    );
  });

  it("keeps the desktop sidebar rail compact while preserving 44px icon targets", () => {
    expect(baseStyles).toMatch(
      /\.sidebar\[data-collapsed="true"\][\s\S]*?padding-inline:\s*10px;/u
    );
    expect(baseStyles).toMatch(
      /\.sidebar\[data-collapsed="true"\] :is\(\.nav-item, \.new-recording-button, \.sidebar-support-link\)[\s\S]*?width:\s*44px;[\s\S]*?min-width:\s*44px;/u
    );
    expect(baseStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.workspace-shell\s*\{[\s\S]*?transition:\s*none;/u
    );
  });

  it("defines one shared 44px hit-target contract for real app controls", () => {
    expect(baseStyles).toContain("--control-hit-size: 44px");
    expect(globalsStyles.trimEnd()).toMatch(/@import "\.\/styles\/control-hit-targets\.css";$/u);
    expect(controlHitTargetStyles).toMatch(/:root :is\(\.workspace-shell[\s\S]*?\.not-found-page\) :is\([\s\S]*?button[\s\S]*?input:not\(\[type="hidden"\]\)[\s\S]*?select[\s\S]*?textarea[\s\S]*?summary[\s\S]*?\)[\s\S]*?min-height:\s*var\(--control-hit-size\);/u);
    expect(controlHitTargetStyles).toMatch(/:root :is\(\.workspace-shell[\s\S]*?:is\(button, \[role="button"\], \[role="tab"\], \.icon-button\)[\s\S]*?min-width:\s*var\(--control-hit-size\);/u);
    expect(controlHitTargetStyles).toMatch(/label:has\(input\[type="checkbox"\]\)[\s\S]*?min-height:\s*var\(--control-hit-size\);/u);
    expect(controlHitTargetStyles).toContain('[data-touch-target="action"]');
    expect(controlHitTargetStyles).toContain("Inline prose links remain text-sized unless explicitly marked as actions");
    expect(controlHitTargetStyles).not.toContain("touch-target-exception");
  });
});
