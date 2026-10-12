import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260922210000_add_shared_ai_output_types.sql";
const migration = existsSync(path) ? readFileSync(path, "utf8") : "";

describe("shared AI output types source contract (not runtime RLS proof)", () => {
  it("exposes exactly output ID and the authoritative job type", () => {
    expect(migration).toMatch(/create function public\.get_accessible_ai_output_types_v1\(p_output_ids uuid\[\]\)/);
    expect(migration).toMatch(/returns table\(output_id uuid, processing_type public\.ai_processing_type\)/);
    expect(migration).toContain("select o.id, j.processing_type");
    expect(migration).not.toMatch(/output_json|prompt_text|provider_config|error_message|grant select|create policy/i);
  });

  it("bounds raw input before deduplicated exact-ID authorization and projection", () => {
    expect(migration).toContain("pg_catalog.cardinality(p_output_ids) > 1000");
    expect(migration).toContain("pg_catalog.array_ndims(p_output_ids) > 1");
    expect(migration).toContain("errcode = '22023'");
    expect(migration.indexOf("cardinality")).toBeLessThan(migration.indexOf("return query"));
    expect(migration).toContain("select distinct requested.id");
    expect(migration).toContain("where requested.id is not null");
    expect(migration).toContain("join public.ai_outputs o on o.id = requested.id");
    expect(migration).toContain("public.can_read_recording(t.recording_id)");
    expect(migration).toContain("j.transcript_id = o.transcript_id");
    expect(migration).toContain("j.user_id = o.user_id");
  });

  it("uses the canonical stable snapshot and session-only trusted-definer ACL", () => {
    expect(migration).toContain("language plpgsql stable security definer set search_path = ''");
    expect(migration).toContain("if auth.uid() is null then return; end if;");
    expect(migration).toContain("'public.can_read_recording(uuid)'::regprocedure");
    expect(migration).toContain("alter function public.get_accessible_ai_output_types_v1(uuid[]) owner to %I");
    expect(migration).toMatch(/revoke all on function public\.get_accessible_ai_output_types_v1\(uuid\[\]\)\s+from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/grant execute on function public\.get_accessible_ai_output_types_v1\(uuid\[\]\) to authenticated/);
    expect(migration).not.toMatch(/volatile|pg_advisory|for update|create table|alter table/i);
  });
});
