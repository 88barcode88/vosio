import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync("supabase/migrations/20260915170017_add_automatic_ai_outputs.sql", "utf8");
describe("automatic AI additive migration boundary (runtime evidence belongs to Management API proof)", () => {
  it("preserves the old completion result and restricts its selection to timeline", () => {
    expect(sql).toContain("create or replace function public.complete_transcript_generation_v1");
    expect(sql).toContain("case when p_automatic_timeline_enabled then array['timeline_chapters'] else array[]::text[] end");
    expect(sql).toContain("update public.automatic_timeline_intents set completion_generation_key = automatic_idempotency_key");
  });
  it("keeps every generic protocol invoker-only with an empty search path and explicit service-role grants", () => {
    for (const name of ["complete_transcript_generation_v2", "enqueue_automatic_ai_job_v2", "claim_automatic_ai_job_v2", "settle_automatic_ai_job_v2", "publish_automatic_ai_output_v2"]) {
      expect(sql).toContain(`revoke all on function public.${name}(`);
      expect(sql).toContain(`grant execute on function public.${name}(`);
    }
    expect(sql).not.toContain("security definer");
    expect(sql).not.toContain("disable row level security");
  });
  it("places locked authority and every linkage validation before raw publication", () => {
    const publish = sql.split("create function public.publish_automatic_ai_output_v2")[1];
    expect(publish.indexOf("for update")).toBeLessThan(publish.indexOf("insert into public.ai_outputs"));
    expect(publish.indexOf("automatic projection ownership mismatch")).toBeLessThan(publish.indexOf("insert into public.ai_outputs"));
    expect(publish).toContain("automatic publication lease conflict");
  });
});
