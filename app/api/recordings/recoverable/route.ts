import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { RECORDINGS_BUCKET } from "@/lib/recordings/types";
import {
  getLiveStorageListPrefix,
  getRecoverableLiveStoragePrefix,
  listStorageObjectsToExhaustion,
  summarizeSafetyPartStorageObjects
} from "@/lib/live-recording/recovery";
import { InvalidSafetyPartListingError } from "@/lib/live-recording/safety-parts";

type RecoverableRecordingRow = {
  created_at: string;
  duration_seconds: number | null;
  id: string;
  source_type: string;
  status: string;
  storage_path: string | null;
  title: string;
};

type StorageObjectSummary = {
  count: number;
  newestUpdatedAt: string | null;
  totalBytes: number;
};

type TranscriptSummary = {
  count: number;
  rawTextChars: number;
};

// TranscriptSummaryQueryError marks a failed metadata read so recovery cannot treat it as empty.
class TranscriptSummaryQueryError extends Error {}

// summarizeStorageObjects returns compact metadata for live audio parts without signed URLs.
export async function summarizeStorageObjects(input: {
  admin: ReturnType<typeof createAdminClient>;
  storagePrefix: string | null;
}) {
  if (!input.storagePrefix) {
    return { count: 0, newestUpdatedAt: null, totalBytes: 0 } satisfies StorageObjectSummary;
  }

  const folder = getLiveStorageListPrefix(input.storagePrefix);
  const bucket = input.admin.storage.from(RECORDINGS_BUCKET);
  const data = await listStorageObjectsToExhaustion({
    folder,
    listPage: (path, options) => bucket.list(path, options)
  });

  return summarizeSafetyPartStorageObjects(data) satisfies StorageObjectSummary;
}

// summarizeTranscript reads only transcript metadata needed for recovery UI.
async function summarizeTranscript(input: {
  admin: ReturnType<typeof createAdminClient>;
  recordingId: string;
  userId: string;
}) {
  const { data, error } = await input.admin
    .from("transcripts")
    .select("id,raw_text")
    .eq("recording_id", input.recordingId)
    .eq("user_id", input.userId);

  if (error) {
    throw new TranscriptSummaryQueryError("Transcript summary query failed.");
  }

  return (data ?? []).reduce<TranscriptSummary>(
    (summary, transcript) => ({
      count: summary.count + 1,
      rawTextChars: summary.rawTextChars + (transcript.raw_text?.length ?? 0)
    }),
    { count: 0, rawTextChars: 0 }
  );
}

// GET lists recoverable unfinished live recordings for the current user.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  }

  const { data: rows, error } = await supabase
    .from("recordings")
    .select("id,created_at,duration_seconds,source_type,status,storage_path,title")
    .eq("user_id", user.id)
    .in("source_type", ["in_app_recording", "realtime"])
    .in("status", ["uploading", "failed", "transcribing"])
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    return NextResponse.json({ error: "Nepodařilo se načíst nedokončené nahrávky." }, { status: 500 });
  }

  const admin = createAdminClient();
  let recoverableRows;

  try {
    recoverableRows = await Promise.all(
      ((rows ?? []) as RecoverableRecordingRow[]).map(async (row) => {
        const storagePrefix =
          row.storage_path ?? (row.source_type === "in_app_recording" ? getRecoverableLiveStoragePrefix(user.id, row.id) : null);
        const [storage, transcript] = await Promise.all([
          summarizeStorageObjects({ admin, storagePrefix }),
          summarizeTranscript({ admin, recordingId: row.id, userId: user.id })
        ]);

        return {
          created_at: row.created_at,
          duration_seconds: row.duration_seconds,
          id: row.id,
          segment_count: storage.count,
          storage_bytes: storage.totalBytes,
          storage_updated_at: storage.newestUpdatedAt,
          title: row.title,
          transcript_chars: transcript.rawTextChars,
          transcript_count: transcript.count
        };
      })
    );
  } catch (listingError) {
    if (listingError instanceof TranscriptSummaryQueryError) {
      return NextResponse.json(
        { error: "Nepodařilo se načíst obnovitelnou nahrávku. Zkuste to znovu." },
        { status: 503 }
      );
    }

    if (listingError instanceof InvalidSafetyPartListingError) {
      return NextResponse.json({ error: listingError.message }, { status: 409 });
    }

    return NextResponse.json({ error: "Nepodařilo se načíst nedokončené nahrávky." }, { status: 500 });
  }
  const recordings = recoverableRows.filter(
    (recording) => recording.segment_count > 0 || recording.transcript_chars > 0
  );

  return NextResponse.json({ ownerId: user.id, recordings });
}
