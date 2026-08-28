import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createAutomaticTimelineGenerationIdentity,
  persistTranscriptCompletionTransition,
  reconcileAutomaticTimeline
} from "@/lib/ai/automatic-timeline.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { extractImportedTranscriptFromFile } from "@/lib/transcripts/import-file";
import { replaceTranscriptSearchChunks } from "@/lib/transcripts/search-index";
import { getTranscriptSearchWarningPayload } from "@/lib/transcripts/search-warning";
import {
  getImportedTranscriptValidationError,
  normalizeImportedTranscriptText,
  normalizeImportedTranscriptTitle
} from "@/lib/transcripts/manual-import";

export const runtime = "nodejs";

const bodySchema = z.object({
  rawText: z.string(),
  title: z.string().optional()
});

type ParsedImportRequest = {
  rawText: string;
  title: string | null;
};

// parseImportRequest reads either JSON pasted text or multipart transcript file uploads.
async function parseImportRequest(request: NextRequest): Promise<ParsedImportRequest | { error: NextResponse }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const title = String(formData.get("title") ?? "");
    const rawText = String(formData.get("rawText") ?? "");
    const file = formData.get("transcriptFile");

    if (file instanceof File && file.size > 0) {
      try {
        return {
          rawText: await extractImportedTranscriptFromFile(file),
          title: title || file.name.replace(/\.[^.]+$/, "")
        };
      } catch (error) {
        return {
          error: NextResponse.json(
            { error: error instanceof Error ? error.message : "Soubor s přepisem nejde přečíst." },
            { status: 400 }
          )
        };
      }
    }

    return { rawText: normalizeImportedTranscriptText(rawText), title };
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return { error: NextResponse.json({ error: "Neplatná data přepisu." }, { status: 400 }) };
  }

  return {
    rawText: normalizeImportedTranscriptText(body.data.rawText),
    title: body.data.title ?? null
  };
}

// POST creates a completed text-only recording from a pasted or uploaded transcript.
export async function POST(request: NextRequest) {
  const parsed = await parseImportRequest(request);

  if ("error" in parsed) {
    return parsed.error;
  }

  const validationError = getImportedTranscriptValidationError(parsed.rawText);

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: recording, error: recordingError } = await admin
    .from("recordings")
    .insert({
      file_size_bytes: 0,
      source_type: "realtime",
      status: "transcribing",
      title: normalizeImportedTranscriptTitle(parsed.title),
      user_id: user.id
    })
    .select("id")
    .single();

  if (recordingError || !recording) {
    return NextResponse.json({ error: "Nepodařilo se vytvořit záznam přepisu." }, { status: 500 });
  }

  const { data: transcript, error: transcriptError } = await admin
    .from("transcripts")
    .insert({
      raw_text: parsed.rawText,
      recording_id: recording.id,
      segments: [],
      speakers: [],
      transcription_job_id: null,
      user_id: user.id
    })
    .select("id,recording_id,user_id,raw_text,segments,speakers")
    .single();

  if (transcriptError || !transcript) {
    await admin.from("recordings").delete().eq("id", recording.id).eq("user_id", user.id);
    return NextResponse.json({ error: "Nepodařilo se uložit přepis." }, { status: 500 });
  }

  const indexResult = await replaceTranscriptSearchChunks(admin, transcript);

  const completion = await persistTranscriptCompletionTransition({
    admin,
    durationSeconds: null,
    generationIdentity: createAutomaticTimelineGenerationIdentity({
      kind: "import",
      transcriptId: transcript.id
    }),
    generationKind: "import",
    transcriptId: transcript.id,
    transcriptionJobId: null,
    user
  }).catch(() => null);

  if (!completion) {
    return NextResponse.json({
      error: "Nepodařilo se atomicky dokončit import přepisu.",
      recordingId: recording.id
    }, { status: 503 });
  }

  if (completion.automatic_timeline_scheduled) {
    await reconcileAutomaticTimeline({
      admin,
      transcriptId: transcript.id,
      userId: user.id
    }).catch(() => {
      console.error("[Vosio automatic timeline] Post-completion enqueue failed.");
    });
  }

  return NextResponse.json({
    recordingId: recording.id,
    transcriptId: transcript.id,
    ...getTranscriptSearchWarningPayload(indexResult)
  });
}
