import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { scheduleAutomaticOutputs, scheduleCaptureTimelineIntent } from "@/lib/ai/automatic-timeline.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveRecordingCapabilities } from "@/lib/recording-sharing/resolve-capabilities";
import { resolveAutomaticOutputTypes } from "@/lib/settings/metadata";

const routeParamsSchema = z.object({
  transcriptId: z.uuid()
});
// Next requires a statically analyzable literal; the runtime contract test locks it to the shared budget.
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{
    transcriptId: string;
  }>;
};

// POST requires current personal AI authority before creating any admin/provider recovery path.
export async function POST(_request: NextRequest, context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: "Neplatné ID přepisu." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  }

  const { data: transcript, error: transcriptError } = await supabase
    .from("transcripts")
    .select("id,recording_id")
    .eq("id", params.data.transcriptId)
    .single();

  if (transcriptError || !transcript) {
    return NextResponse.json({ error: "Přepis nebyl nalezen." }, { status: 404 });
  }
  if (!(await resolveRecordingCapabilities(supabase, transcript.recording_id)).runPersonalAi) {
    return NextResponse.json({ error: "AI zpracování není povoleno." }, { status: 403 });
  }

  try {
    await scheduleCaptureTimelineIntent(supabase, transcript.id, user);
    const result = await scheduleAutomaticOutputs({
      admin: createAdminClient(),
      transcriptId: transcript.id,
      userId: user.id,
      allowedProcessingTypes: resolveAutomaticOutputTypes(user.user_metadata)
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Automatickou časovou osu se teď nepodařilo obnovit." },
      { status: 503 }
    );
  }
}
