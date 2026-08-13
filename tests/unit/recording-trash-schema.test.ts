import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260810005550_restore_recordings_from_trash.sql"
);
const migration = readFileSync(migrationPath, "utf8");
const normalized = migration.toLowerCase().replace(/\s+/g, " ");

describe("recording trash restore migration", () => {
  it("adds typed restore metadata and deterministic legacy backfill", () => {
    expect(normalized).toContain("add column deleted_from_status public.recording_status");
    expect(normalized).toContain("add column deleted_at timestamptz");
    expect(normalized).toContain("add column purge_started_at timestamptz");
    expect(normalized).toContain("add column purge_claim_id uuid");
    expect(normalized).toContain("where recordings.status = 'deleted'::public.recording_status");
    expect(normalized).toContain("exists ( select 1 from public.transcripts");
    expect(normalized).toContain("then 'completed'::public.recording_status");
    expect(normalized).toContain("when recordings.storage_path is not null then 'uploaded'::public.recording_status");
    expect(normalized).toContain("else 'failed'::public.recording_status");
    expect(normalized).toContain("deleted_at = recordings.updated_at");
    expect(normalized).toContain("disable trigger recordings_set_updated_at");
    expect(normalized).toContain("enable trigger recordings_set_updated_at");
  });

  it("enforces a non-deleted sentinel and consistent trash metadata", () => {
    expect(normalized).toMatch(/deleted_from_status\s*(?:<>|!=)\s*'deleted'::public\.recording_status/);
    expect(normalized).toContain("status = 'deleted'::public.recording_status and deleted_from_status is not null and deleted_at is not null");
    expect(normalized).toContain("status <> 'deleted'::public.recording_status and deleted_from_status is null and deleted_at is null");
    expect(normalized).toContain("status = 'deleted'::public.recording_status or (purge_started_at is null and purge_claim_id is null)");
    expect(normalized).toContain("(purge_started_at is null and purge_claim_id is null) or (purge_started_at is not null and purge_claim_id is not null)");
  });

  it("uses a security-invoker trigger to capture, preserve, and restore exact status", () => {
    expect(normalized).toContain("security invoker");
    expect(normalized).not.toContain("security definer");
    expect(normalized).toContain("new.deleted_from_status := old.status");
    expect(normalized).toContain("new.deleted_at := now()");
    expect(normalized).toContain("new.purge_started_at := null");
    expect(normalized).toContain("new.purge_claim_id := null");
    expect(normalized).toContain("new.deleted_from_status := old.deleted_from_status");
    expect(normalized).toContain("new.deleted_at := old.deleted_at");
    expect(normalized).toContain("new.status := old.deleted_from_status");
    expect(normalized).toContain("old.purge_started_at is not null");
    expect(normalized).toContain("raise exception");
    expect(normalized).toContain("current_user = 'service_role'");
    expect(normalized).not.toContain("auth.role()");
    expect(normalized).toContain("new.purge_started_at := old.purge_started_at");
    expect(normalized).toContain("new.purge_claim_id := old.purge_claim_id");
    expect(normalized).toContain("new.deleted_from_status := null");
    expect(normalized).toContain("new.deleted_at := null");
    expect(normalized).toContain("before update on public.recordings");
  });

  it("does not alter recording ownership, RLS policies, or auth metadata", () => {
    expect(normalized).not.toContain("user_metadata");
    expect(normalized).not.toContain("auth.users");
    expect(normalized).not.toContain("security definer");
  });

  it("replaces authenticated Storage writes with recording-aware late-upload fences", () => {
    expect(normalized).toContain('drop policy if exists "recordings storage insert own folder" on storage.objects');
    expect(normalized).toContain('drop policy if exists "recordings storage update own folder" on storage.objects');
    expect(normalized).toContain('create policy "recordings storage insert own folder" on storage.objects for insert to authenticated');
    expect(normalized).toContain('create policy "recordings storage update own folder" on storage.objects for update to authenticated');
    expect(normalized).toContain("(storage.foldername(name))[1] = (select auth.uid())::text");
    expect(normalized).toContain("(storage.foldername(name))[2] = recordings.id::text");
    expect(normalized).toContain("recordings.user_id = (select auth.uid())");
    expect(normalized).toContain("recordings.status <> 'deleted'::public.recording_status");
    expect(normalized).toContain("recordings.purge_started_at is null");
    expect(normalized).toContain("recordings.purge_claim_id is null");
    expect(normalized).not.toContain("to service_role");
  });
});
