import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { structuredTaskStatusSchema } from "@/lib/ai/structured-status";
import { createClient } from "@/lib/supabase/server";
import { ContentEditError, setContentTaskStatus } from "@/lib/recording-sharing/content-edits.server";

const routeParamsSchema = z.object({
  taskId: z.uuid()
});

const bodySchema = z.object({
  status: structuredTaskStatusSchema
});

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

// PATCH authorizes the recording, uses the locked status-only RPC, then requires a matched persisted result.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: "Neplatne ID ukolu." }, { status: 400 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return NextResponse.json({ error: "Neplatny stav ukolu." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Nejste prihlaseny." }, { status: 401 });
  }

  let saved;
  try {
    saved = await setContentTaskStatus(supabase, { taskId: params.data.taskId, status: body.data.status });
  } catch (error) {
    const failure = error instanceof ContentEditError ? error : new ContentEditError("unavailable");
    const status = failure.stage === "lookup" ? 404 : failure.code === "denied" ? 403 : failure.code === "conflict" ? 409 : 500;
    const message = failure.stage === "lookup" ? "Úkol nebyl nalezen." : failure.stage === "permission" ? "Úprava není povolena." : failure.stage === "readback" ? "Uložení úkolu se nepodařilo potvrdit." : "Stav ukolu se nepodarilo ulozit.";
    return NextResponse.json({ error: message }, { status });
  }

  revalidatePath("/recordings");

  return NextResponse.json({ ok: true, status: saved.status });
}
