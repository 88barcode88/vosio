import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { structuredTaskStatusSchema } from "@/lib/ai/structured-status";
import { createClient } from "@/lib/supabase/server";

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

// PATCH updates one user-owned structured checklist status without redirecting the page.
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

  const { error } = await supabase
    .from("transcript_tasks")
    .update({ status: body.data.status })
    .eq("id", params.data.taskId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Stav ukolu se nepodarilo ulozit." }, { status: 500 });
  }

  revalidatePath("/recordings");

  return NextResponse.json({ ok: true, status: body.data.status });
}
