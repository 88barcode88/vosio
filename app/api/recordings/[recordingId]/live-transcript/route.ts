import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { extractTranscriptSpeakerSummaries } from "@/lib/transcripts/speakers";

const routeParamsSchema = z.object({
  recordingId: z.uuid()
});

const bodySchema = z.object({
  audioStorage: z
    .enum(["supabase_recording_upload", "supabase_recording_segments", "transcript_only"])
    .default("supabase_recording_upload"),
  rawText: z.string().trim().min(1),
  segments: z.array(z.unknown()).default([])
});

type RouteContext = {
  params: Promise<{
    recordingId: string;
  }>;
};

// POST stores or refreshes a final transcript captured from Soniox realtime recording.
export async function POST(request: NextRequest, context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: "Neplatné ID nahrávky." }, { status: 400 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return NextResponse.json({ error: "Neplatná data live přepisu." }, { status: 400 });
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

  const admin = createAdminClient();
  const speakers = extractTranscriptSpeakerSummaries(body.data.segments);
  const { data: existingTranscript, error: existingTranscriptError } = await admin
    .from("transcripts")
    .select("id")
    .eq("recording_id", recording.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingTranscriptError) {
    return NextResponse.json({ error: "Nepodařilo se načíst uložený live přepis." }, { status: 500 });
  }

  const transcriptWrite = existingTranscript
    ? await admin
      .from("transcripts")
      .update({
        raw_text: body.data.rawText,
        segments: body.data.segments,
        speakers,
        transcription_job_id: null
      })
      .eq("id", existingTranscript.id)
      .eq("user_id", user.id)
      .select("id")
      .single()
    : await admin
      .from("transcripts")
      .insert({
        raw_text: body.data.rawText,
        recording_id: recording.id,
        segments: body.data.segments,
        speakers,
        transcription_job_id: null,
        user_id: user.id
      })
      .select("id")
      .single();

  if (transcriptWrite.error || !transcriptWrite.data) {
    return NextResponse.json({ error: "Nepodařilo se uložit live přepis." }, { status: 500 });
  }

  const audioSource =
    body.data.audioStorage === "transcript_only"
      ? "browser_microphone_text_only"
      : "browser_microphone";
  const { data: job, error: jobError } = await admin
    .from("transcription_jobs")
    .insert({
      completed_at: new Date().toISOString(),
      mode: "realtime",
      provider: "soniox",
      provider_config: {
        audio_source: audioSource,
        storage: body.data.audioStorage
      },
      recording_id: recording.id,
      started_at: new Date().toISOString(),
      status: "done",
      user_id: user.id
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Nepodařilo se uložit realtime přepisovací job." }, { status: 500 });
  }

  await admin
    .from("transcripts")
    .update({ transcription_job_id: job.id })
    .eq("id", transcriptWrite.data.id)
    .eq("user_id", user.id);

  const { error: recordingUpdateError } = await admin
    .from("recordings")
    .update({ error_message: null, status: "completed" })
    .eq("id", recording.id)
    .eq("user_id", user.id);

  if (recordingUpdateError) {
    return NextResponse.json({ error: "Nepodařilo se aktualizovat stav live nahrávky." }, { status: 500 });
  }

  return NextResponse.json({ transcript: transcriptWrite.data });
}
