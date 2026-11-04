import "server-only";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDecisionDedupeKey, getRiskDedupeKey } from "@/lib/ai/structured-dedupe";
import type { StructuredOwnerCategory } from "@/lib/ai/structured-types";
import { resolveRecordingCapabilities } from "@/lib/recording-sharing/resolve-capabilities";
import { managedMutationError } from "@/lib/recordings/trash-service.server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";

export type StructuredItemGroupKind = "decision" | "risk";

type GroupCandidate = {
  id: string;
  transcript_id: string;
  updated_at: string;
  title: string;
  status?: string | null;
  owner_category?: StructuredOwnerCategory | null;
  impact?: string | null;
};

type GroupConfig = {
  columns: string;
  dedupeKey: (row: GroupCandidate) => string;
  labels: { failed: string; unavailable: string };
  rpc: string;
  rpcArgs: (id: string, updatedAt: string, ids: string[]) => Record<string, unknown>;
  table: "transcript_decisions" | "transcript_risks";
};

const MAX_GROUP_SIZE = 1000;
const itemIdSchema = z.uuid();

// Per-kind table, dedupe key and RPC contract for logical decision/risk group deletion.
const groupConfigs: Record<StructuredItemGroupKind, GroupConfig> = {
  decision: {
    columns: "id,transcript_id,title,status,owner_category,updated_at",
    dedupeKey: (row) => getDecisionDedupeKey({ owner_category: row.owner_category ?? null, status: row.status ?? null, title: row.title }),
    labels: { failed: "Rozhodnutí se nepodařilo smazat.", unavailable: "Rozhodnutí není dostupné." },
    rpc: "delete_managed_transcript_decision_group_v1",
    rpcArgs: (id, updatedAt, ids) => ({ p_decision_id: id, p_decision_ids: ids, p_expected_updated_at: updatedAt }),
    table: "transcript_decisions"
  },
  risk: {
    columns: "id,transcript_id,title,impact,updated_at",
    dedupeKey: (row) => getRiskDedupeKey({ impact: row.impact ?? null, title: row.title }),
    labels: { failed: "Riziko se nepodařilo smazat.", unavailable: "Riziko není dostupné." },
    rpc: "delete_managed_transcript_risk_group_v1",
    rpcArgs: (id, updatedAt, ids) => ({ p_expected_updated_at: updatedAt, p_risk_id: id, p_risk_ids: ids }),
    table: "transcript_risks"
  }
};

// Deletes one logical decision or risk group (all repeated AI projections) under current recording-manager authority.
export async function deleteStructuredItemGroup(kind: StructuredItemGroupKind, rawItemId: string) {
  const config = groupConfigs[kind];
  const itemId = itemIdSchema.safeParse(rawItemId);

  if (!itemId.success) {
    return NextResponse.json({ error: "Neplatné ID položky." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  }

  try {
    const { data: target, error: targetError } = await supabase.from(config.table)
      .select(config.columns).eq("id", itemId.data).maybeSingle<GroupCandidate>();
    if (targetError) return NextResponse.json({ error: config.labels.failed }, { status: 500 });
    if (!target) return NextResponse.json({ error: config.labels.unavailable }, { status: 403 });

    const { data: transcript, error: transcriptError } = await supabase.from("transcripts")
      .select("recording_id").eq("id", target.transcript_id).maybeSingle<{ recording_id: string }>();
    if (transcriptError) return NextResponse.json({ error: config.labels.failed }, { status: 500 });
    if (!transcript || !(await resolveRecordingCapabilities(supabase, transcript.recording_id)).delete) {
      return NextResponse.json({ error: "Smazání není povoleno." }, { status: 403 });
    }

    const candidates = await fetchAllRows<GroupCandidate>("Unable to load item group", (from, to) => supabase
      .from(config.table).select(`${config.columns},transcripts!inner(recording_id)`)
      .eq("transcripts.recording_id", transcript.recording_id).order("id").range(from, to)
      .returns<GroupCandidate[]>());
    const targetKey = config.dedupeKey(target);
    const matchingIds = [...new Set(candidates
      .filter((candidate) => config.dedupeKey(candidate) === targetKey)
      .map((candidate) => candidate.id))];

    if (!matchingIds.includes(target.id) || matchingIds.length > MAX_GROUP_SIZE) {
      return NextResponse.json({ error: "Položky se změnily nebo je skupina příliš velká." }, { status: 409 });
    }

    const { data, error } = await supabase.rpc(config.rpc, config.rpcArgs(target.id, target.updated_at, matchingIds));

    if (error) {
      const code = managedMutationError(error).code;
      const status = code === "forbidden" ? 403 : code === "conflict" ? 409 : code === "invalid_item" ? 400 : 500;
      return NextResponse.json({ error: config.labels.failed }, { status });
    }

    if (data?.recordingId !== transcript.recording_id || data?.deletedCount !== matchingIds.length) {
      return NextResponse.json({ error: "Položky se změnily." }, { status: 409 });
    }

    revalidatePath("/recordings");
    revalidatePath(`/recordings/${transcript.recording_id}`);

    return NextResponse.json({ deleted: data.deletedCount, ids: matchingIds, ok: true });
  } catch {
    return NextResponse.json({ error: config.labels.failed }, { status: 500 });
  }
}
