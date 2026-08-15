import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const baselineMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260617000000_initial_schema.sql"),
  "utf8"
);
const evidenceLocationMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260804100000_add_evidence_locations.sql"),
  "utf8"
);
const recordingOrganizationMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260804110000_add_recording_organization.sql"),
  "utf8"
);
const recordingMarkersMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260804120000_add_recording_markers.sql"),
  "utf8"
);
const transcriptSearchMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260804130000_add_transcript_fulltext_search.sql"),
  "utf8"
);
const recordingStatusFiltersMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260813000000_add_recording_status_filters.sql"),
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

  it("adds nullable evidence ranges without changing grants or policies", () => {
    const normalizedMigration = evidenceLocationMigration.replace(/\s+/g, " ");

    for (const tableName of ["transcript_tasks", "transcript_decisions", "transcript_risks"]) {
      expect(evidenceLocationMigration).toContain(`alter table public.${tableName}`);
      expect(evidenceLocationMigration).toContain("add column evidence_start_ms bigint");
      expect(evidenceLocationMigration).toContain("add column evidence_end_ms bigint");
      expect(evidenceLocationMigration).toContain(`constraint ${tableName}_evidence_range_check check`);
      expect(normalizedMigration).toContain(
        `constraint ${tableName}_evidence_range_check check ( `
        + "(evidence_start_ms is null and evidence_end_ms is null) or ( "
        + "evidence_start_ms is not null and evidence_end_ms is not null "
        + "and evidence_start_ms >= 0 and evidence_end_ms >= evidence_start_ms ) )"
      );
    }

    expect(evidenceLocationMigration).toContain("alter table public.transcript_risks\n  add column evidence_quote text");
    expect(evidenceLocationMigration.match(/evidence_start_ms >= 0/g)).toHaveLength(3);
    expect(evidenceLocationMigration.match(/evidence_end_ms >= evidence_start_ms/g)).toHaveLength(3);
    expect(evidenceLocationMigration).not.toMatch(/or\s*\(\s*evidence_start_ms\s*>=\s*0/i);
    expect(evidenceLocationMigration).not.toMatch(/\bgrant\b/i);
    expect(evidenceLocationMigration).not.toMatch(/\bpolicy\b/i);
    expect(baselineMigration.match(/grant update \(status\) on public\.transcript_tasks to authenticated;/g)).toHaveLength(1);
  });

  it("adds the owner-safe recording marker forward migration", () => {
    const normalizedMigration = recordingMarkersMigration.replace(/\s+/g, " ");

    expect(recordingMarkersMigration).toContain("create table public.recording_markers");
    expect(normalizedMigration).toContain(
      "foreign key (recording_id, user_id) references public.recordings(id, user_id) on delete cascade"
    );
    expect(normalizedMigration).toContain(
      "alter table public.recording_markers force row level security"
    );
    expect(recordingMarkersMigration.match(/create policy "recording markers [^"]+"/g)).toHaveLength(4);
  });

  it("adds the owner-safe recording organization forward migration", () => {
    const normalizedMigration = recordingOrganizationMigration.replace(/\s+/g, " ");

    for (const tableName of [
      "recording_clients",
      "recording_projects",
      "recording_folders",
      "recording_tags",
      "recording_tag_links"
    ]) {
      expect(recordingOrganizationMigration).toContain(`create table public.${tableName}`);
      expect(normalizedMigration).toContain(
        `alter table public.${tableName} force row level security`
      );
    }

    expect(normalizedMigration).toContain(
      "foreign key (project_id, client_id, user_id) references public.recording_projects(id, client_id, user_id) on delete set null (project_id)"
    );
    expect(normalizedMigration).toContain(
      "create or replace function public.assign_recording_organization_v1("
    );
    expect(normalizedMigration).toContain(
      "create or replace function public.list_own_recordings_v1("
    );
  });

  it("adds owner-safe indexed transcript search after recording organization", () => {
    const normalizedMigration = transcriptSearchMigration.replace(/\s+/g, " ");

    expect(normalizedMigration).toContain(
      "constraint transcripts_id_recording_id_user_id_unique unique (id, recording_id, user_id)"
    );
    expect(transcriptSearchMigration).toContain("create table public.transcript_search_chunks");
    expect(normalizedMigration).toContain(
      "foreign key (transcript_id, recording_id, user_id) references public.transcripts(id, recording_id, user_id) on delete cascade"
    );
    expect(normalizedMigration).toContain(
      "create or replace function public.search_own_recordings_v1("
    );
    expect(normalizedMigration).toContain(
      "create or replace function public.replace_transcript_search_chunks_v1("
    );
    expect(normalizedMigration).toContain(
      "create trigger transcripts_refresh_search_fallback"
    );
  });

  it("adds status-aware RPC versions without replacing the V1 contracts", () => {
    expect(recordingOrganizationMigration).toContain("create or replace function public.list_own_recordings_v1(");
    expect(transcriptSearchMigration).toContain("create or replace function public.search_own_recordings_v1(");
    expect(recordingStatusFiltersMigration).toContain("create or replace function public.list_own_recordings_v2(");
    expect(recordingStatusFiltersMigration).toContain("create or replace function public.search_own_recordings_v2(");
    expect(recordingStatusFiltersMigration).not.toContain("create or replace function public.list_own_recordings_v1(");
    expect(recordingStatusFiltersMigration).not.toContain("create or replace function public.search_own_recordings_v1(");
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
