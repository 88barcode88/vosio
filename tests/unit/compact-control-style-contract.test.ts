import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const recordingStyles = readFileSync(
  join(process.cwd(), "app", "styles", "documentation-recordings.css"),
  "utf8"
);
const workspaceStyles = readFileSync(join(process.cwd(), "app", "styles", "workspace.css"), "utf8");
const baseStyles = readFileSync(join(process.cwd(), "app", "styles", "base.css"), "utf8");
const sidebarSource = readFileSync(
  join(process.cwd(), "src", "components", "workspace", "sidebar.tsx"),
  "utf8"
);
const themeToggleSource = readFileSync(
  join(process.cwd(), "src", "components", "theme-toggle.tsx"),
  "utf8"
);
const transcriptionControlsSource = readFileSync(
  join(process.cwd(), "src", "components", "transcription-controls.tsx"),
  "utf8"
);
const aiProcessingControlsSource = readFileSync(
  join(process.cwd(), "src", "components", "ai-processing-controls.tsx"),
  "utf8"
);
const exportControlsSource = readFileSync(
  join(process.cwd(), "src", "components", "transcript-tabs", "export-controls.tsx"),
  "utf8"
);

// getRuleBody isolates one exact selector block for compact visual-contract assertions.
function getRuleBody(source: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "u"))?.[1] ?? "";
}

describe("compact workspace control styling", () => {
  it("gives the recordings search and management trigger explicit semantic control styling", () => {
    const management = getRuleBody(
      recordingStyles,
      ".recordings-toolbar > .organization-manager-trigger"
    );
    const search = getRuleBody(recordingStyles, ".recording-filter-search input");

    for (const rule of [management, search]) {
      expect(rule).toContain("border: 1px solid var(--border)");
      expect(rule).toContain("border-radius: 6px");
      expect(rule).toContain("color: var(--text)");
    }
    expect(management).toContain("background: var(--surface-muted)");
    expect(search).toContain("background: var(--surface)");
    expect(recordingStyles).toMatch(
      /\.recordings-toolbar > \.organization-manager-trigger:hover,[\s\S]*?\.recording-filter-search input:hover,[\s\S]*?\{[^}]*?border-color:\s*var\(--border-strong\);/u
    );
    expect(recordingStyles).toMatch(
      /\.recording-filter-search input:focus-visible\s*\{[^}]*?border-color:\s*var\(--focus-ring\);/u
    );
    expect(recordingStyles).toMatch(
      /\.recordings-toolbar > \.organization-manager-trigger:focus-visible,[\s\S]*?\.recording-filter-advanced \.ui-disclosure-trigger:focus-visible\s*\{[^}]*?border-color:\s*var\(--focus-ring\);/u
    );
  });

  it("keeps sidebar utility icon buttons square, compact and visually aligned", () => {
    const themeToggle = getRuleBody(workspaceStyles, ".theme-toggle-compact");
    const collapseButton = getRuleBody(baseStyles, ".sidebar-collapse-button");
    const signOutButton = getRuleBody(baseStyles, ".sign-out-form button");

    for (const rule of [themeToggle, collapseButton, signOutButton]) {
      expect(rule).toContain("width: 44px");
      expect(rule).toContain("height: 44px");
      expect(rule).toContain("border-radius: 6px");
    }
    expect(sidebarSource).not.toMatch(/PanelLeft(?:Open|Close) size=\{17\}/u);
    expect(sidebarSource).toMatch(/PanelLeftOpen size=\{16\}/u);
    expect(sidebarSource).toMatch(/PanelLeftClose size=\{16\}/u);
    expect(themeToggleSource).not.toMatch(/(?:Sun|Moon) size=\{17\}/u);
    expect(themeToggleSource).toMatch(/Sun size=\{16\}/u);
    expect(themeToggleSource).toMatch(/Moon size=\{16\}/u);
  });

  it("uses one 44px and 6px action geometry in the recording header and AI quick actions", () => {
    expect(recordingStyles).toMatch(
      /\.recording-object-header \.recording-detail-actions :is\([^)]+\),[\s\S]*?\.recording-object-header \.recording-header-operations \.command-button\s*\{[^}]*?min-height:\s*44px;[^}]*?border-radius:\s*6px;/u
    );
    expect(recordingStyles).toMatch(
      /\.ai-tab-actions \.quick-grid button\s*\{[^}]*?min-height:\s*44px;[^}]*?border-radius:\s*6px;/u
    );
    expect(recordingStyles).toMatch(
      /\.ai-tab-actions \.quick-grid svg\s*\{[^}]*?width:\s*16px;[^}]*?height:\s*16px;/u
    );
    expect(transcriptionControlsSource).not.toContain("size={18}");
    expect(transcriptionControlsSource.match(/size=\{16\}/gu)).toHaveLength(3);
    expect(aiProcessingControlsSource).toContain("<action.icon size={16} />");
    expect(exportControlsSource).toContain("<Download size={16} />");
  });
});
