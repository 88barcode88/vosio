import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BASELINE_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260617000000_initial_schema.sql"
);
const baselineSql = readFileSync(BASELINE_PATH, "utf8");

const expectedPublicTables = [
  "ai_outputs",
  "ai_processing_jobs",
  "audit_logs",
  "prompt_templates",
  "recordings",
  "transcript_chapters",
  "transcript_decisions",
  "transcript_risks",
  "transcript_tasks",
  "transcription_jobs",
  "transcripts",
] as const;

describe("Supabase public baseline", () => {
  it.each(expectedPublicTables)("enables and forces RLS for %s", (table) => {
    expect(baselineSql).toContain(
      `alter table public.${table} enable row level security;`
    );
    expect(baselineSql).toContain(
      `alter table public.${table} force row level security;`
    );
  });

  it("keeps the recordings bucket private and owner-scoped", () => {
    expect(baselineSql).toMatch(
      /values\s*\(\s*'recordings',\s*'recordings',\s*false,\s*52428800,/u
    );

    for (const operation of ["select", "insert", "update", "delete"]) {
      expect(baselineSql).toContain(
        `create policy "recordings storage ${operation} own folder"`
      );
    }

    expect(baselineSql).toContain(
      "(storage.foldername(name))[1] = (select auth.uid())::text"
    );
  });

  it("does not grant the anonymous role access to application tables", () => {
    expect(baselineSql).not.toMatch(/\bgrant\b[^;]*\bto\s+anon\b/iu);
  });

  it("keeps seeded Czech prompt text valid UTF-8", () => {
    expect(baselineSql).toContain("Moje práce");
    expect(baselineSql).not.toMatch(/Ã|Ä.|Å.|â.|Â/u);
  });
});
