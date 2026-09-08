import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260908101824_add_mistral_ai_provider.sql";

describe("Mistral AI provider migration", () => {
  it("adds only the Mistral enum value without rewriting historical migrations", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("alter type public.ai_provider add value if not exists 'mistral'");
    expect(migration).not.toMatch(/drop\s+type|delete\s+from|update\s+/iu);
  });
});
