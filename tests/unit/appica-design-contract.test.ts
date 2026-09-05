import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const baseStyles = readFileSync(join(process.cwd(), "app", "styles", "base.css"), "utf8");
const globalsStyles = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const rootLayout = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8");
const uiPrimitives = readFileSync(join(process.cwd(), "app", "styles", "ui-primitives.css"), "utf8");
const manifest = readFileSync(join(process.cwd(), "public", "manifest.webmanifest"), "utf8");
const designDirection = readFileSync(join(process.cwd(), "docs", "requirements", "ui-direction.md"), "utf8");

const darkTokens = {
  "--bg": "#171717",
  "--surface": "#202020",
  "--surface-muted": "#282828",
  "--surface-raised": "#242424",
  "--border": "#3a3a3a",
  "--border-strong": "#575757",
  "--text": "#f5f5f3",
  "--accent": "#f5f5f3",
  "--accent-text": "#171717",
  "--focus-ring": "#74a7ff"
};

const lightTokens = {
  "--bg": "#f4f4f2",
  "--surface": "#ffffff",
  "--surface-muted": "#ececea",
  "--surface-raised": "#ffffff",
  "--border": "#d8d8d4",
  "--border-strong": "#aaa9a4",
  "--text": "#171717",
  "--accent": "#171717",
  "--accent-text": "#ffffff",
  "--focus-ring": "#245bd7"
};

// Reads the source contract so the neutral Appica direction cannot regress into the replaced warm theme.
describe("Appica-inspired design contract", () => {
  it("defines neutral graphite and light-canvas semantic tokens with accessible status roles", () => {
    for (const [token, value] of Object.entries(darkTokens)) {
      expect(baseStyles).toContain(`${token}: ${value};`);
    }

    const lightThemeStart = baseStyles.indexOf('[data-theme="light"]');
    expect(lightThemeStart).toBeGreaterThanOrEqual(0);
    const lightThemeStyles = baseStyles.slice(lightThemeStart);
    for (const [token, value] of Object.entries(lightTokens)) {
      expect(lightThemeStyles).toContain(`${token}: ${value};`);
    }

    for (const themeStyles of [baseStyles.slice(0, lightThemeStart), lightThemeStyles]) {
      for (const token of ["--success", "--danger", "--warning", "--info"]) {
        expect(themeStyles).toMatch(new RegExp(`${token}: #[0-9a-f]{6};`, "u"));
      }
    }
    expect(baseStyles).toContain("--control-hit-size: 44px;");
    expect(baseStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(baseStyles).toContain("outline: 2px solid var(--focus-ring);");
  });

  it("uses Inter alone for interface and headings without a warm display font", () => {
    expect(rootLayout).toContain('import { Inter } from "next/font/google";');
    expect(rootLayout).not.toContain("Newsreader");
    expect(rootLayout).toContain('variable: "--font-ui"');
    expect(rootLayout).toContain('className={inter.variable}');
    expect(baseStyles).toMatch(/body\s*\{[^}]*font-family: var\(--font-ui\)/u);
    expect(baseStyles).toMatch(/h1,\s*h2,\s*h3\s*\{[^}]*font-family: var\(--font-ui\)/u);
  });

  it("keeps the PWA chrome neutral and the root provider contract unchanged", () => {
    expect(rootLayout).toContain('themeColor: "#171717"');
    expect(manifest).toContain('"background_color": "#171717"');
    expect(manifest).toContain('"theme_color": "#171717"');
    expect(rootLayout.indexOf("<RecordingNavigationGuardProvider>"))
      .toBeLessThan(rootLayout.indexOf("<PersistentRecordingSessionProvider>"));
    expect(rootLayout.indexOf("<PersistentRecordingSessionProvider>"))
      .toBeLessThan(rootLayout.indexOf("{children}"));
    expect(rootLayout).toContain("<ThemeStorageMigration />");
    expect(rootLayout).toContain("<PwaRegistration />");
  });

  it("imports the frozen lane hook order before the final hit-target contract", () => {
    const foundation = '@import "./styles/appica-foundation.css";';
    const recordings = '@import "./styles/appica-recordings.css";';
    const workflow = '@import "./styles/appica-workflow.css";';
    const utilities = '@import "./styles/appica-utilities.css";';
    const hitTargets = '@import "./styles/control-hit-targets.css";';

    expect(globalsStyles).toContain(foundation);
    expect(globalsStyles).toContain(recordings);
    expect(globalsStyles).toContain(workflow);
    expect(globalsStyles).toContain(utilities);
    expect(globalsStyles).toContain(hitTargets);
    expect(globalsStyles.indexOf(foundation)).toBeLessThan(globalsStyles.indexOf(recordings));
    expect(globalsStyles.indexOf(recordings)).toBeLessThan(globalsStyles.indexOf(workflow));
    expect(globalsStyles.indexOf(workflow)).toBeLessThan(globalsStyles.indexOf(utilities));
    expect(globalsStyles.indexOf(utilities)).toBeLessThan(globalsStyles.indexOf(hitTargets));
  });

  it("keeps shared panels, overlays and status badges restrained and semantic", () => {
    expect(uiPrimitives).toContain("border-radius: 8px;");
    expect(uiPrimitives).toContain("box-shadow: var(--shadow);");
    for (const tone of ["success", "warning", "danger", "info"]) {
      expect(uiPrimitives).toContain(`.ui-status-${tone}`);
      expect(uiPrimitives).toContain(`var(--${tone === "danger" ? "danger" : tone})`);
    }
  });

  it("documents the approved direction and one document scroll for recording detail", () => {
    expect(designDirection).toContain("neutrální Appica-inspired");
    expect(designDirection).toContain("jediný dokumentový scroll celé detailové stránky");
    expect(designDirection).not.toContain("Notion Warm");
    expect(designDirection).not.toContain("teal/cyan");
  });
});
