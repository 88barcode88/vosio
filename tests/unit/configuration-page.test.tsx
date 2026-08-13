import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfigurationPage from "../../app/configuration/page";

afterEach(() => {
  vi.unstubAllEnvs();
});

// configurePublicEnvironment provides valid fake public values for safe render tests.
function configurePublicEnvironment() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
}

describe("configuration diagnostics page", () => {
  it("renders only missing public names, the safe environment enum and restart guidance", () => {
    configurePublicEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://secret-value.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VERCEL_ENV", "preview");

    const markup = renderToStaticMarkup(createElement(ConfigurationPage));

    expect(markup).toContain("Konfigurace aplikace");
    expect(markup).toContain("Preview");
    expect(markup).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(markup).toContain("znovu nasaďte");
    expect(markup).not.toContain("https://secret-value.invalid");
    expect(markup).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(markup).not.toContain("SONIOX_API_KEY");
  });

  it("renders a safe ready state without echoing configured values", () => {
    configurePublicEnvironment();
    vi.stubEnv("VERCEL_ENV", "production");

    const markup = renderToStaticMarkup(createElement(ConfigurationPage));

    expect(markup).toContain("Veřejná konfigurace je připravená");
    expect(markup).toContain("Vosio · Produkce");
    expect(markup).not.toContain("test-publishable-key");
    expect(markup).not.toContain("https://example.supabase.co");
  });

  it("stays renderable and reports only the URL name for an unsupported scheme", () => {
    configurePublicEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "ftp://secret-marker.invalid");

    const markup = renderToStaticMarkup(createElement(ConfigurationPage));

    expect(markup).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(markup).not.toContain("ftp://secret-marker.invalid");
  });

  it.each([
    ["development", "Vývoj"],
    ["preview", "Preview"],
    ["production", "Produkce"],
    ["unsupported", "Neznámé"]
  ] as const)("renders the %s environment with the Settings label", (vercelEnvironment, label) => {
    configurePublicEnvironment();
    vi.stubEnv("VERCEL_ENV", vercelEnvironment);
    vi.stubEnv("NODE_ENV", "test");

    const markup = renderToStaticMarkup(createElement(ConfigurationPage));

    expect(markup).toContain(`Vosio · ${label}`);
  });

  it("does not import a Supabase client and keeps the route stylesheet overflow-safe", () => {
    const pageSource = readFileSync("app/configuration/page.tsx", "utf8");
    const diagnosticsSource = readFileSync("app/configuration/configuration-diagnostics.tsx", "utf8");
    const stylesheet = readFileSync("app/configuration/page.module.css", "utf8");

    expect(pageSource).not.toMatch(/from ["'][^"']*supabase[^"']*["']/iu);
    expect(diagnosticsSource).not.toMatch(/from ["'][^"']*supabase[^"']*["']/iu);
    expect(stylesheet).toMatch(/overflow-x:\s*hidden/u);
    expect(stylesheet).toMatch(/overflow-wrap:\s*anywhere/u);
  });
});
