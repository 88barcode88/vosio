import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validatePromptsAiFixtureAccess } from "../../app/login/prompts-ai-e2e/development-runtime";

describe("prompts and AI E2E fixture guard", () => {
  it("accepts only scoped development template and archive views", () => {
    expect(validatePromptsAiFixtureAccess("development", "a1b2c3d4e5f6", "templates")?.view).toBe("templates");
    expect(validatePromptsAiFixtureAccess("development", "a1b2c3d4e5f6", "ai")?.view).toBe("ai");
    expect(validatePromptsAiFixtureAccess("development", "bad", "ai")).toBeNull();
    expect(validatePromptsAiFixtureAccess("development", "a1b2c3d4e5f6", "other")).toBeNull();
    expect(validatePromptsAiFixtureAccess("production", "a1b2c3d4e5f6", "templates")).toBeNull();
    expect(validatePromptsAiFixtureAccess("test", "a1b2c3d4e5f6", "templates")).toBeNull();
    expect(validatePromptsAiFixtureAccess(undefined, "a1b2c3d4e5f6", "templates")).toBeNull();
  });

  it("keeps fixture actions free of database, provider and HTTP clients", () => {
    const source = readFileSync(join(process.cwd(), "app", "login", "prompts-ai-e2e", "actions.ts"), "utf8");
    expect(source).not.toMatch(/supabase|createClient|fetch\s*\(|soniox|openai/iu);
    expect(source).toContain('process.env.NODE_ENV !== "development"');
  });
});
