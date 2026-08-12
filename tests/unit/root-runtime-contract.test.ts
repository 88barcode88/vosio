import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("root runtime contracts", () => {
  it("keeps Soniox region and temporary-key lifetime out of deployment configuration", () => {
    const source = readFileSync("src/lib/env.server.ts", "utf8");

    expect(source).toContain("SONIOX_API_KEY");
    expect(source).toContain("SONIOX_ASYNC_MODEL");
    expect(source).not.toContain("SONIOX_API_BASE_URL");
    expect(source).not.toContain("SONIOX_REGION");
    expect(source).not.toContain("SONIOX_STT_WS_URL");
    expect(source).not.toContain("SONIOX_TEMP_KEY_EXPIRES_SECONDS");
    expect(source).not.toContain("optionalPositiveInteger");
    expect(source).not.toContain("optionalSonioxRegion");
    expect(source).not.toContain("parseSonioxRealtimeTarget");
    expect(source).not.toContain("getSonioxApiBaseUrl");
  });

  it("renders the cookie-selected theme without a hydration-time script", () => {
    const source = readFileSync("app/layout.tsx", "utf8");

    expect(source).toContain("await cookies()");
    expect(source).toContain("cookieStore.get(VOSIO_THEME_COOKIE)?.value");
    expect(source).toContain("<html data-theme={initialTheme}");
    expect(source).toContain("data-theme-source={themeSource}");
    expect(source).toContain("<ThemeStorageMigration />");
    expect(source).not.toContain('from "next/script"');
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toMatch(/<script\b/u);
  });

  it("keeps the root error boundary sanitized and its recovery target touch-safe", () => {
    const source = readFileSync("app/error.tsx", "utf8");

    expect(source).not.toContain("console.error");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("error.digest");
    expect(source).toMatch(/minHeight:\s*"44px"/u);
  });
});
