import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const claimSchema = z.object({ recording_id: z.uuid(), storage_prefix: z.string(), claim_id: z.uuid() });
type Claim = z.infer<typeof claimSchema>;
const PAGE_SIZE = 100;
const CLEANUP_ROUNDS = 3;

// Accepts only the exact canonical prefix returned by the receipt-bound service RPC.
function validateClaim(value: unknown): Claim {
  const claim = claimSchema.parse(value);
  const parts = claim.storage_prefix.split("/");
  if (parts.length !== 3 || !z.uuid().safeParse(parts[0]).success || parts[1] !== claim.recording_id || parts[2] !== "") throw new Error("Invalid purge prefix");
  return claim;
}

// Collects all pages and validates each child before any recursion or destructive call.
async function listPrefix(supabase: SupabaseClient, prefix: string) {
  const folders = [prefix.slice(0, -1)];
  const objects = new Set<string>();
  const bucket = supabase.storage.from("recordings");
  for (let index = 0; index < folders.length; index += 1) {
    const folder = folders[index]!;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await bucket.list(folder, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
      if (error || !Array.isArray(data)) throw new Error("Purge listing failed");
      for (const item of data) {
        if (typeof item.name !== "string" || !item.name || item.name === "." || item.name === ".." || /[/\\]/.test(item.name) || item.name.includes(String.fromCharCode(0))) throw new Error("Unsafe purge entry");
        const path = `${folder}/${item.name}`;
        if (item.id === null) folders.push(path);
        else if (typeof item.id === "string" && item.id) objects.add(path);
        else throw new Error("Invalid purge entry");
      }
      if (data.length < PAGE_SIZE) break;
    }
  }
  return [...objects];
}

// Acquires or refreshes one receipt token, never a legacy retention claim.
async function acquire(supabase: SupabaseClient, operationId: string, claim?: Claim) {
  const { data, error } = await supabase.rpc("acquire_recording_purge_work_v1", { p_operation_id: operationId, p_claim_id: claim?.claim_id ?? null });
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error("Purge claim unavailable");
  const next = validateClaim(data[0]);
  if (claim && (next.claim_id !== claim.claim_id || next.recording_id !== claim.recording_id || next.storage_prefix !== claim.storage_prefix)) throw new Error("Purge claim changed");
  return next;
}

// Finishes accepted work with token fencing and full-prefix verification; failures never release it.
export async function processManualPurge(supabase: SupabaseClient, operationId: string, discoveredClaim?: Claim) {
  if (!z.uuid().safeParse(operationId).success) throw new Error("Invalid operation");
  const claim = discoveredClaim ? validateClaim(discoveredClaim) : await acquire(supabase, operationId);
  for (let round = 0; round <= CLEANUP_ROUNDS; round += 1) {
    await acquire(supabase, operationId, claim);
    const objects = await listPrefix(supabase, claim.storage_prefix);
    if (objects.length === 0) {
      await acquire(supabase, operationId, claim);
      const { data, error } = await supabase.rpc("finalize_recording_purge_work_v1", { p_operation_id: operationId, p_claim_id: claim.claim_id });
      if (error || data !== true) throw new Error("Purge finalize failed");
      return true;
    }
    if (round === CLEANUP_ROUNDS) break;
    for (let offset = 0; offset < objects.length; offset += PAGE_SIZE) {
      await acquire(supabase, operationId, claim);
      const { error } = await supabase.storage.from("recordings").remove(objects.slice(offset, offset + PAGE_SIZE));
      if (error) throw new Error("Purge removal failed");
    }
  }
  throw new Error("Purge prefix not empty");
}

// Recovers bounded started-only work from the durable DB queue with two workers, including lost app responses.
export async function discoverManualPurges(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("claim_started_recording_purge_work_v1", { p_limit: 5 });
  if (error || !Array.isArray(data) || data.length > 5) throw new Error("Purge discovery failed");
  const summary = { claimed: data.length, completed: 0, failed: 0 };
  let cursor = 0;
  // Each worker owns one receipt at a time and exposes only aggregate results.
  async function worker() {
    while (cursor < data.length) {
      const row = data[cursor++];
      try { await processManualPurge(supabase, row.operation_id, validateClaim(row)); summary.completed += 1; }
      catch { summary.failed += 1; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, data.length) }, () => worker()));
  return summary;
}
