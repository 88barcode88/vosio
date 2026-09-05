// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppError from "../../app/error";
import GlobalError from "../../app/global-error";

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
    expect(source).toContain('data-utility-route-state="error"');
  });

  it("renders the root error boundary inside the utility route surface", () => {
    const markup = renderToStaticMarkup(
      createElement(AppError, { error: new Error("private root detail"), reset: () => undefined }),
    );

    expect(markup).toContain('class="utility-route-state utility-route-state-error"');
    expect(markup).toContain('data-utility-route-state="error"');
    expect(markup).toContain('min-height:44px');
    expect(markup).not.toContain("private root detail");
  });

  it("lets the lane stylesheet keep root error content in a vertical grid", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("app/styles/appica-utilities.css", "utf8");
    document.head.append(style);

    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createElement(AppError, { error: new Error("private layout detail"), reset: () => undefined }),
    );
    document.body.append(host);

    const main = host.querySelector("main");
    const content = host.querySelector(".utility-route-state-content");
    expect(main).not.toBeNull();
    expect(content).not.toBeNull();
    expect(window.getComputedStyle(main as HTMLElement).display).toBe("grid");
    expect(window.getComputedStyle(content as HTMLElement).display).toBe("grid");

    host.remove();
    style.remove();
  });

  it("renders the global error boundary with a self-contained touch-safe surface", () => {
    const markup = renderToStaticMarkup(
      createElement(GlobalError, { error: new Error("private global detail"), reset: () => undefined }),
    );
    const source = readFileSync("app/global-error.tsx", "utf8");

    expect(markup).toContain('class="utility-route-state utility-route-state-global-error"');
    expect(markup).toContain('data-utility-route-state="global-error"');
    expect(markup).toContain('min-height:44px');
    expect(markup).not.toContain("private global detail");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("error.digest");
  });
});
