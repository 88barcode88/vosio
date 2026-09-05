import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runManualAiJob } from "@/lib/ai/manual-processing.server";
import { reconcileManualAiJob } from "@/lib/ai/manual-reconciliation.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Next requires a statically analyzable literal; the runtime contract test locks it to the shared budget.
export const maxDuration = 300;
const routeParamsSchema = z.object({ transcriptId: z.uuid() });
const requestBodySchema = z.object({
  action: z.enum(["reconcile", "interrupt"]),
  jobId: z.uuid()
});
type RouteContext = { params: Promise<{ transcriptId: string }> };

// POST reconciles one exact manual job only after request-session ownership verification.
export async function POST(request: NextRequest, context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);
  const body = requestBodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return NextResponse.json({ error: "Neplatný požadavek na obnovu AI zpracování." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  const { data: transcript } = await supabase.from("transcripts").select("id")
    .eq("id", params.data.transcriptId).eq("user_id", user.id).maybeSingle<{ id: string }>();
  if (!transcript) return NextResponse.json({ error: "Přepis nebyl nalezen." }, { status: 404 });

  const admin = createAdminClient();
  try {
    const result = await reconcileManualAiJob({
      action: body.data.action,
      admin,
      jobId: body.data.jobId,
      transcriptId: transcript.id,
      userId: user.id
    });
    if (result.status === "schedule") {
      try {
        after(() => runManualAiJob({ jobId: result.jobId, transcriptId: transcript.id, userId: user.id }));
      } catch {
        await reconcileManualAiJob({ action: "interrupt", admin, jobId: result.jobId, transcriptId: transcript.id, userId: user.id });
        return NextResponse.json({ error: "AI zpracování se nepodařilo naplánovat." }, { status: 503 });
      }
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
      status: body.data.action === "interrupt" && result.status === "busy" ? 409 : 200
    });
  } catch {
    return NextResponse.json({ error: "AI stav se nepodařilo obnovit." }, { status: 503 });
  }
}
