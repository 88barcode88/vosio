import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const currentInstallationDocs = [
  ".env.example",
  "README.md",
  "docs/api/environment.md",
  "docs/architecture.md",
  "docs/gotchas.md",
  "docs/requirements/real-workspace.md"
] as const;

const obsoleteSonioxEnvironmentNames = [
  "SONIOX_REGION",
  "SONIOX_TEMP_KEY_EXPIRES_SECONDS",
  "SONIOX_API_BASE_URL",
  "SONIOX_STT_WS_URL"
] as const;

describe("installation documentation contract", () => {
  it("keeps obsolete Soniox routing controls out of current installation documentation", () => {
    for (const path of currentInstallationDocs) {
      const source = readFileSync(path, "utf8");

      for (const name of obsoleteSonioxEnvironmentNames) {
        expect(source, `${path} still documents ${name}`).not.toContain(name);
      }
    }
  });

  it("documents one self-hosted installation flow and its safe diagnostics", () => {
    const readme = readFileSync("README.md", "utf8");
    const environment = readFileSync("docs/api/environment.md", "utf8");

    for (const name of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SONIOX_API_KEY",
      "OPENAI_API_KEY"
    ]) {
      expect(readme).toContain(name);
      expect(environment).toContain(name);
    }

    expect(readme).toMatch(/each person or company.+own Vercel deployment.+own Supabase, Soniox, and AI credentials/is);
    expect(environment).toMatch(/Production and Preview.+same required variable names/is);
    expect(environment).toMatch(/same data.+provider costs/is);
    expect(environment).toContain("/configuration");
    expect(environment).toContain("Technical information");
    expect(environment).toMatch(/names only/is);
    expect(environment).toMatch(/redeploy or restart/is);
  });

  it("documents app-managed Soniox regions and Supabase Preview callbacks", () => {
    const environment = readFileSync("docs/api/environment.md", "utf8");
    const requirements = readFileSync("docs/requirements/real-workspace.md", "utf8");

    for (const source of [environment, requirements]) {
      expect(source).toMatch(/Settings.+Global.+default/is);
      expect(source).toMatch(/EU-enabled Soniox project.+matching regional key/is);
      expect(source).toContain("support@soniox.com");
      expect(source).toMatch(/60 seconds.+not configurable/is);
    }

    expect(environment).toMatch(/Preview.+wildcard callback/is);
    expect(environment).toMatch(/redirect URLs?/is);
  });
});
