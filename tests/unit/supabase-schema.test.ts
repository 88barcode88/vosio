import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const baselineMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260617000000_initial_schema.sql"),
  "utf8"
);

describe("Supabase schema migrations", () => {
  it("adds ownership and forced RLS for structured AI tables", () => {
    for (const tableName of ["transcript_tasks", "transcript_chapters", "transcript_decisions", "transcript_risks"]) {
      expect(baselineMigration).toContain(`create table public.${tableName}`);
      expect(baselineMigration).toContain("user_id uuid not null references auth.users(id) on delete cascade");
      expect(baselineMigration).toContain(`alter table public.${tableName} enable row level security`);
      expect(baselineMigration).toContain(`alter table public.${tableName} force row level security`);
      expect(baselineMigration).toContain(`revoke all on table public.${tableName} from anon`);
    }
  });

  it("cascades structured AI rows from ai_outputs and keeps owner-safe foreign keys", () => {
    expect(baselineMigration).toContain("add constraint ai_outputs_id_user_id_unique unique (id, user_id)");
    expect(baselineMigration.match(/references public\.ai_outputs\(id, user_id\) on delete cascade/g)).toHaveLength(4);
    expect(baselineMigration.match(/references public\.transcripts\(id, user_id\) on delete cascade/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("indexes structured rows for transcript detail loading", () => {
    expect(baselineMigration).toContain("transcript_tasks_transcript_position_idx");
    expect(baselineMigration).toContain("transcript_chapters_transcript_position_idx");
    expect(baselineMigration).toContain("transcript_decisions_transcript_position_idx");
    expect(baselineMigration).toContain("transcript_risks_transcript_position_idx");
  });

  it("keeps authenticated writes limited to checklist status updates", () => {
    expect(baselineMigration).toContain("grant select on public.transcript_tasks to authenticated");
    expect(baselineMigration).toContain("grant update (status) on public.transcript_tasks to authenticated");
    expect(baselineMigration).toContain("grant select on public.transcript_chapters to authenticated");
    expect(baselineMigration).toContain("grant select on public.transcript_decisions to authenticated");
    expect(baselineMigration).toContain("grant select on public.transcript_risks to authenticated");
    expect(baselineMigration).not.toContain("grant select, insert, update, delete on public.transcript_tasks");
    expect(baselineMigration).not.toContain("transcript chapters update own");
    expect(baselineMigration).not.toContain("transcript decisions delete own");
    expect(baselineMigration).not.toContain("transcript risks insert own");
  });

  it("keeps the baseline aligned with current provider and storage requirements", () => {
    expect(baselineMigration).toContain("create type public.ai_provider as enum ('openai', 'gemini')");
    expect(baselineMigration).toContain("provider_config jsonb not null default '{}'::jsonb");
    expect(baselineMigration).toContain("52428800");
    expect(baselineMigration).toContain("'video/mp4'");
    expect(baselineMigration).toContain("'audio/aiff'");
    expect(baselineMigration).toContain("'video/x-ms-asf'");
  });
});
