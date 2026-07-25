import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { RECORDINGS_BUCKET } from "@/lib/recordings/types";
import {
  getRecoveredLiveRecordingUpdate,
  getLiveStorageListPrefix,
  getRecoverableLiveStoragePrefix,
  isRecoverableLiveRecording
} from "@/lib/live-recording/recovery";

const routeParamsSchema = z.object({
  recordingId: z.uuid()
});

type RouteContext = {
  params: Promise<{
    recordingId: string;
  }>;
};

type RecoverableRecording = {
  duration_seconds: number | null;
  id: string;
  source_type: string;
  status: string;
  storage_path: string | null;
  user_id: string;
};

type SegmentSummary = {
  count: number;
  totalBytes: number;
};

// getStorageObjectSize safely reads Supabase object metadata size.
function getStorageObjectSize(item: { metadata?: unknown }) {
  if (typeof item.metadata !== "object" || item.metadata === null || !("size" in item.metadata)) {
    return 0;
  }

  const size = (item.metadata as { size?: unknown }).size;

  return typeof size === "number" && Number.isFinite(size) ? size : 0;
}

// summarizeSegments counts recoverable live audio parts under one Storage prefix.
async function summarizeSegments(input: {
  admin: ReturnType<typeof createAdminClient>;
  storagePrefix: string | null;
}) {
  if (!input.storagePrefix) {
    return { count: 0, totalBytes: 0 } satisfies SegmentSummary;
  }

  const { data, error } = await input.admin.storage
    .from(RECORDINGS_BUCKET)
    .list(getLiveStorageListPrefix(input.storagePrefix));

  if (error) {
    throw new Error("Nepodařilo se načíst části live nahrávky.");
  }

  return (data ?? []).reduce<SegmentSummary>(
    (summary, item) => {
      if (!item.name || item.name.endsWith("/")) {
        return summary;
      }

      return {
        count: summary.count + 1,
        totalBytes: summary.totalBytes + getStorageObjectSize(item)
      };
    },
    { count: 0, totalBytes: 0 }
  );
}

// getTranscriptSummary checks whether a recoverable recording has a saved transcript draft.
async function getTranscriptSummary(input: {
  admin: ReturnType<typeof createAdminClient>;
  recordingId: string;
  userId: string;
}) {
  const { data, error } = await input.admin
    .from("transcripts")
    .select("id,raw_text")
    .eq("recording_id", input.recordingId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    throw new Error("Nepodařilo se načíst koncept přepisu.");
  }

  return {
    hasTranscript: Boolean(data?.raw_text?.trim()),
    transcriptId: data?.id ?? null
  };
}

// POST finalizes an unfinished live recording from saved transcript draft or audio parts.
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const params = routeParamsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json({ error: "Neplatné ID nahrávky." }, { status: 400 });
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
      .select("id,user_id,source_type,status,storage_path,duration_seconds")
      .eq("id", params.data.recordingId)
      .eq("user_id", user.id)
      .single();

    if (recordingError || !recording) {
      return NextResponse.json({ error: "Nahrávka nebyla nalezena." }, { status: 404 });
    }

    const recoverableRecording = recording as RecoverableRecording;

    if (!isRecoverableLiveRecording(recoverableRecording)) {
      return NextResponse.json({ error: "Nahrávka není v obnovitelném stavu." }, { status: 409 });
    }

    const admin = createAdminClient();
    const storagePrefix =
      recoverableRecording.storage_path ??
      (recoverableRecording.source_type === "in_app_recording"
        ? getRecoverableLiveStoragePrefix(user.id, recoverableRecording.id)
        : null);
    const [segments, transcript] = await Promise.all([
      summarizeSegments({ admin, storagePrefix }),
      getTranscriptSummary({
        admin,
        recordingId: recoverableRecording.id,
        userId: user.id
      })
    ]);

    if (!transcript.hasTranscript && segments.count === 0) {
      return NextResponse.json({ error: "Není co obnovit." }, { status: 409 });
    }

    const recordingUpdate = getRecoveredLiveRecordingUpdate({
      hasTranscript: transcript.hasTranscript,
      segmentCount: segments.count,
      storagePrefix,
      totalBytes: segments.totalBytes
    });
    const { error: updateError } = await admin
      .from("recordings")
      .update(recordingUpdate)
      .eq("id", recoverableRecording.id)
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json({ error: "Obnova nahrávky selhala." }, { status: 500 });
    }

    return NextResponse.json({
      recording: {
        id: recoverableRecording.id,
        status: recordingUpdate.status,
        transcriptId: transcript.transcriptId
      }
    });
  } catch {
    return NextResponse.json({ error: "Obnova nahrávky selhala." }, { status: 500 });
  }
}
