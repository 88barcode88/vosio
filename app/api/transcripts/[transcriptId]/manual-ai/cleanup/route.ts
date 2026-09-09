import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { MANUAL_AI_CLEANUP_BATCH_LIMIT } from "@/lib/ai/manual-job-cleanup-contract";
import {
  cleanupManualAiJobs,
  listManualAiCleanupCandidates
} from "@/lib/ai/manual-job-cleanup.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const routeParamsSchema = z.object({ transcriptId: z.uuid() });
const cursorSchema = z.string().min(1).max(1_024).nullable();
const requestBodySchema = z.object({
  job_ids: z.array(z.uuid()).min(1).max(MANUAL_AI_CLEANUP_BATCH_LIMIT)
    .refine((ids) => new Set(ids).size === ids.length)
}).strict();
type RouteContext = { params: Promise<{ transcriptId: string }> };

// authorizeCleanupScope authenticates the request and verifies the exact transcript before admin creation.
async function authorizeCleanupScope(transcriptId: string) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { error: "unauthorized" as const };
  const { data: transcript } = await supabase.from("transcripts").select("id")
    .eq("id", transcriptId).eq("user_id", user.id).maybeSingle<{ id: string }>();
  if (!transcript) return { error: "not_found" as const };
  return { transcriptId: transcript.id, userId: user.id };
}

// GET returns a bounded keyset page of every historical manual job cleanup candidate.
export async function GET(request: NextRequest, context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);
  const cursor = cursorSchema.safeParse(request.nextUrl.searchParams.get("cursor"));
  if (!params.success) {
    return NextResponse.json({ error: "Přepis nebyl nalezen." }, { status: 404 });
  }
  if (!cursor.success) {
    return NextResponse.json({ error: "Neplatná stránka úklidu AI zpracování." }, { status: 400 });
  }
  const scope = await authorizeCleanupScope(params.data.transcriptId);
  if ("error" in scope) {
    return NextResponse.json(
      { error: scope.error === "unauthorized" ? "Nejste přihlášený." : "Přepis nebyl nalezen." },
      { status: scope.error === "unauthorized" ? 401 : 404 }
    );
  }
  try {
    const page = await listManualAiCleanupCandidates({
      admin: createAdminClient(), cursor: cursor.data, ...scope
    });
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const invalidCursor = error instanceof Error && error.message === "manual_ai_cleanup_invalid_cursor";
    return NextResponse.json(
      { error: invalidCursor ? "Neplatná stránka úklidu AI zpracování." : "Úklid AI zpracování se nepodařilo načíst." },
      { status: invalidCursor ? 400 : 503 }
    );
  }
}

// POST atomically evaluates and cleans only the exact requested owner-scoped manual job IDs.
export async function POST(request: NextRequest, context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);
  const body = requestBodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return NextResponse.json({ error: "Neplatný požadavek na úklid AI zpracování." }, { status: 400 });
  }
  const scope = await authorizeCleanupScope(params.data.transcriptId);
  if ("error" in scope) {
    return NextResponse.json(
      { error: scope.error === "unauthorized" ? "Nejste přihlášený." : "Přepis nebyl nalezen." },
      { status: scope.error === "unauthorized" ? 401 : 404 }
    );
  }
  try {
    const result = await cleanupManualAiJobs({
      admin: createAdminClient(), jobIds: body.data.job_ids, ...scope
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Úklid AI zpracování se nepodařilo dokončit." }, { status: 503 });
  }
}
