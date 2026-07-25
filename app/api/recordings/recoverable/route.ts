import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { RECORDINGS_BUCKET } from "@/lib/recordings/types";
import {
  getLiveStorageListPrefix,
  getRecoverableLiveStoragePrefix
} from "@/lib/live-recording/recovery";

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

// getStorageObjectSize safely reads Supabase object metadata size.
function getStorageObjectSize(item: { metadata?: unknown }) {
  if (typeof item.metadata !== "object" || item.metadata === null || !("size" in item.metadata)) {
    return 0;
  }

  const size = (item.metadata as { size?: unknown }).size;

  return typeof size === "number" && Number.isFinite(size) ? size : 0;
}

// summarizeStorageObjects returns compact metadata for live audio parts without signed URLs.
async function summarizeStorageObjects(input: {
  admin: ReturnType<typeof createAdminClient>;
  storagePrefix: string | null;
}) {
  if (!input.storagePrefix) {
    return { count: 0, newestUpdatedAt: null, totalBytes: 0 } satisfies StorageObjectSummary;
  }

  const { data, error } = await input.admin.storage
    .from(RECORDINGS_BUCKET)
    .list(getLiveStorageListPrefix(input.storagePrefix));

  if (error) {
    return { count: 0, newestUpdatedAt: null, totalBytes: 0 } satisfies StorageObjectSummary;
  }

  return (data ?? []).reduce<StorageObjectSummary>(
    (summary, item) => {
      if (!item.name || item.name.endsWith("/")) {
        return summary;
      }

      const updatedAt = item.updated_at ?? item.created_at ?? null;
      const newestUpdatedAt =
        updatedAt && (!summary.newestUpdatedAt || updatedAt > summary.newestUpdatedAt)
          ? updatedAt
          : summary.newestUpdatedAt;

      return {
        count: summary.count + 1,
        newestUpdatedAt,
        totalBytes: summary.totalBytes + getStorageObjectSize(item)
      };
    },
    { count: 0, newestUpdatedAt: null, totalBytes: 0 }
  );
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
    return { count: 0, rawTextChars: 0 } satisfies TranscriptSummary;
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
  const recoverableRows = await Promise.all(
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
  const recordings = recoverableRows.filter(
    (recording) => recording.segment_count > 0 || recording.transcript_chars > 0
  );

  return NextResponse.json({ recordings });
}
