import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260923000000_add_bulk_recording_sharing.sql";
const sql = existsSync(path) ? readFileSync(path, "utf8") : "";
const body = sql.split("$bulk$")[1] ?? "";

describe("bulk sharing SQL source contract (not runtime authorization proof)", () => {
  it("bounds raw inputs and canonicalizes the complete payload before receipt lookup", () => {
    expect(body).toContain("cardinality(p_recording_ids)>100");
    expect(body).toContain("cardinality(p_recording_ids)<1");
    expect(body).toContain("array_ndims(p_recording_ids) is distinct from 1");
    expect(body).toContain("array_position(p_recording_ids,null)");
    expect(body).toContain("jsonb_array_length(p_recipients)>100");
    expect(body).toContain("public.canonical_recording_recipients_v1(p_recipients)");
    expect(body.indexOf("v_fingerprint:=")).toBeLessThan(body.indexOf("into v_receipt"));
  });

  it("replays only the actor-scoped exact immutable payload without current access dependency", () => {
    const replay = body.slice(body.indexOf("into v_receipt"), body.indexOf("-- New requests"));
    expect(replay).toContain("b.actor_id=v_actor and b.request_id=p_request_id");
    expect(replay).toContain("v_receipt.payload_fingerprint<>v_fingerprint");
    expect(replay).toContain("order by x.id");
    expect(replay).not.toMatch(/can_manage|validate_recording_recipients|update |insert |delete /i);
    expect(sql).toContain("force row level security");
    expect(sql).toContain("primary key(actor_id,request_id)");
    expect(sql).not.toMatch(/references public.recordings|grant .* on (table )?public.recording_bulk_share_receipts/i);
  });

  it("locks globally then projects then recordings and preauthorizes the whole set before writes", () => {
    const lock = body.indexOf("perform public.recording_sharing_lock_v1()");
    const project = body.indexOf("order by p.id for update");
    const recording = body.indexOf("order by r.id for update");
    const authorizationEnd = body.indexOf("-- All rows and transitions authorized");
    expect(lock).toBeGreaterThan(-1);
    expect(project).toBeGreaterThan(lock);
    expect(recording).toBeGreaterThan(project);
    expect(authorizationEnd).toBeGreaterThan(recording);
    expect(body.slice(0, authorizationEnd)).not.toMatch(/^\s*(insert into|update public|delete from)/m);
    expect(body).toContain("public.can_manage_recording(v_record.id)");
    expect(body).toContain("public.can_capture_in_recording_project(v_record.project_id)");
    expect(body).not.toContain("perform public.share_recording_v1");
  });

  it("preserves exact grants/invite revocation and limits mutation to visibility plus sharing tables", () => {
    expect(body).toContain("update public.recordings r set visibility=p_visibility");
    expect(body).toContain("x.recording_id=any(v_ids)");
    expect(body).toContain("r.id,(x->>'userId')::uuid,x->>'role',r.project_id");
    expect(body).toContain("insert into public.recording_sharing_audit");
    expect(body).toContain("insert into public.recording_bulk_share_receipts");
    expect(body).not.toMatch(/set\s+(user_id|created_by|project_id|client_id|folder_id|tag_ids|storage_path)/i);
    expect(sql).toContain("security definer set search_path = ''");
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).toContain("owner to %I");
    expect(sql).toContain("to authenticated;");
  });

  it("ships executable semantic and concurrency artifacts with bounded valid fixtures", () => {
    const tap = readFileSync("supabase/tests/bulk_recording_sharing.sql", "utf8");
    const isolation = readFileSync("supabase/tests/bulk_recording_sharing_concurrency.spec", "utf8");
    expect(tap).toContain("generate_series(1,100)n");
    expect(tap).toContain("'userId',pg_temp.uid(16000000,999)");
    expect(tap).toContain("when n in(4,9) then 'selected'");
    expect(tap).toContain("Historical replay survives recording purge and recipient account deletion");
    expect(tap).toContain("Every non-sharing recording field preserved byte-for-byte");
    for (const line of tap.split("\n").filter((line) => line.startsWith("select throws_ok"))) {
      expect(line.match(/\$\$/g)).toHaveLength(2);
    }
    expect(isolation.match(/^permutation /gm)).toHaveLength(8);
    expect(isolation).toContain("revoke-first must reject without partial writes");
    expect(isolation).toContain("concurrent replay duplicated work");
  });
});
