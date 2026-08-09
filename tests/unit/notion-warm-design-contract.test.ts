import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const baseStyles = readFileSync(join(process.cwd(), "app", "styles", "base.css"), "utf8");
const rootLayout = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8");
const timelineStyles = readFileSync(join(process.cwd(), "app", "styles", "timeline-ai-output.css"), "utf8");

const darkTokens = {
  "--bg": "#191918",
  "--surface": "#222220",
  "--surface-muted": "#2a2927",
  "--surface-raised": "#302f2c",
  "--border": "#3d3a36",
  "--border-strong": "#56514a",
  "--text": "#f3f0ea",
  "--text-secondary": "#c1bbb1",
  "--text-muted": "#989188",
  "--accent": "#5cc8bc",
  "--accent-hover": "#79d6cc",
  "--accent-text": "#10211f",
  "--success": "#7fc7a4",
  "--recording": "#ff8f8f",
  "--danger": "#ff8f8f",
  "--warning": "#e8b36a",
  "--info": "#86b7e8"
};

const lightTokens = {
  "--bg": "#f7f5f2",
  "--surface": "#fffefa",
  "--surface-muted": "#f0ede8",
  "--surface-raised": "#ffffff",
  "--border": "#ded9d1",
  "--border-strong": "#c8c1b7",
  "--text": "#252421",
  "--text-secondary": "#625f59",
  "--text-muted": "#817c74",
  "--accent": "#0f766e",
  "--accent-hover": "#0b5f59",
  "--accent-text": "#ffffff",
  "--success": "#2f7d56",
  "--recording": "#b83f3f",
  "--danger": "#b83f3f",
  "--warning": "#8a5a16",
  "--info": "#2f67a5",
  "--violet": "#6659c7"
};

const compatibilityAliases = {
  "--panel": "var(--surface)",
  "--panel-strong": "var(--surface-raised)",
  "--panel-soft": "var(--surface-muted)",
  "--text": "#f3f0ea",
  "--muted": "var(--text-secondary)",
  "--subtle": "var(--text-secondary)",
  "--teal": "var(--accent)",
  "--teal-strong": "var(--accent-hover)",
  "--green": "var(--success)",
  "--red": "var(--danger)",
  "--orange": "var(--warning)",
  "--blue": "var(--info)",
  "--accent-bg": "var(--accent)",
  "--accent-bg-hover": "var(--accent-hover)"
};

// Reads the global source contract so the approved theme and font foundations cannot drift unnoticed.
describe("Notion Warm design contract", () => {
  it("defines the approved dark and light semantic tokens", () => {
    for (const [token, value] of Object.entries(darkTokens)) {
      expect(baseStyles).toContain(`${token}: ${value};`);
    }

    const lightThemeStart = baseStyles.indexOf('[data-theme="light"]');
    expect(lightThemeStart).toBeGreaterThanOrEqual(0);
    const lightThemeStyles = baseStyles.slice(lightThemeStart);

    for (const [token, value] of Object.entries(lightTokens)) {
      expect(lightThemeStyles).toContain(`${token}: ${value};`);
    }
  });

  it("loads Inter and Newsreader into the approved UI and heading font variables", () => {
    expect(rootLayout).toContain('import { Inter, Newsreader } from "next/font/google";');
    expect(rootLayout).toMatch(/const inter = Inter\(\{[\s\S]*display: "swap",[\s\S]*subsets: \["latin", "latin-ext"\],[\s\S]*variable: "--font-ui"[\s\S]*\}\);/);
    expect(rootLayout).toMatch(/const newsreader = Newsreader\(\{[\s\S]*display: "swap",[\s\S]*subsets: \["latin", "latin-ext"\],[\s\S]*variable: "--font-heading"[\s\S]*\}\);/);
    expect(rootLayout).toContain('className={`${inter.variable} ${newsreader.variable}`}');
    expect(baseStyles).toMatch(/body\s*\{[^}]*font-family: var\(--font-ui\)/);
    expect(baseStyles).toMatch(/h1,\s*h2,\s*h3\s*\{[^}]*font-family: var\(--font-heading\)/);
  });

  it("uses an accessible semantic focus ring for global focus outlines", () => {
    expect(baseStyles.match(/--focus-ring: var\(--accent\);/g)).toHaveLength(2);
    expect(baseStyles).toContain("outline: 2px solid var(--focus-ring);");
  });

  it("defines the danger token used by existing AI output states", () => {
    expect(timelineStyles).toContain("color: var(--danger);");
    expect(baseStyles).toContain("--danger: #ff8f8f;");
  });

  it("keeps the complete active compatibility alias map tied to semantic tokens", () => {
    for (const [alias, value] of Object.entries(compatibilityAliases)) {
      expect(baseStyles).toContain(`${alias}: ${value};`);
    }
  });
});
