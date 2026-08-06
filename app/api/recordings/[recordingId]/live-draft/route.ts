import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getLiveDraftAutosavePayload } from "@/lib/live-recording/recovery";
import { replaceTranscriptSearchChunks } from "@/lib/transcripts/search-index";
import { getTranscriptSearchWarningPayload } from "@/lib/transcripts/search-warning";
import { extractTranscriptSpeakerSummaries } from "@/lib/transcripts/speakers";

const routeParamsSchema = z.object({
  recordingId: z.uuid()
});

const bodySchema = z.object({
  elapsedSeconds: z.number().finite().nonnegative(),
  rawText: z.string(),
  segments: z.array(z.unknown()).default([])
});

type RouteContext = {
  params: Promise<{
    recordingId: string;
  }>;
};

// PUT persists the latest partial live transcript while recording is still in progress.
export async function PUT(request: NextRequest, context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: "Neplatné ID nahrávky." }, { status: 400 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return NextResponse.json({ error: "Neplatná data live konceptu." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  }

  const { data: recording, error: recordingError } = await supabase
    .from("recordings")
    .select("id,user_id")
    .eq("id", params.data.recordingId)
    .eq("user_id", user.id)
    .single();

  if (recordingError || !recording) {
    return NextResponse.json({ error: "Nahrávka nebyla nalezena." }, { status: 404 });
  }

  const payload = getLiveDraftAutosavePayload(body.data);
  const admin = createAdminClient();
  let indexWarningPayload = {};
  const { data: existingTranscript, error: existingTranscriptError } = await admin
    .from("transcripts")
    .select("id")
    .eq("recording_id", recording.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingTranscriptError) {
    return NextResponse.json({ error: "Nepodařilo se načíst koncept přepisu." }, { status: 500 });
  }

  if (payload.raw_text) {
    const speakers = extractTranscriptSpeakerSummaries(payload.segments);
    const transcriptWrite = existingTranscript
      ? await admin
        .from("transcripts")
        .update({
          raw_text: payload.raw_text,
          segments: payload.segments,
          speakers,
          transcription_job_id: null
        })
        .eq("id", existingTranscript.id)
        .eq("user_id", user.id)
        .select("id,recording_id,user_id,raw_text,segments,speakers")
        .single()
      : await admin
        .from("transcripts")
        .insert({
          raw_text: payload.raw_text,
          recording_id: recording.id,
          segments: payload.segments,
          speakers,
          transcription_job_id: null,
          user_id: user.id
        })
        .select("id,recording_id,user_id,raw_text,segments,speakers")
        .single();

    if (transcriptWrite.error || !transcriptWrite.data) {
      return NextResponse.json({ error: "Nepodařilo se uložit koncept přepisu." }, { status: 500 });
    }

    const indexResult = await replaceTranscriptSearchChunks(admin, transcriptWrite.data);
    indexWarningPayload = getTranscriptSearchWarningPayload(indexResult);
  }

  const { error: recordingUpdateError } = await admin
    .from("recordings")
    .update({ duration_seconds: payload.duration_seconds })
    .eq("id", recording.id)
    .eq("user_id", user.id);

  if (recordingUpdateError) {
    return NextResponse.json({ error: "Nepodařilo se uložit délku live nahrávky." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...indexWarningPayload });
}
