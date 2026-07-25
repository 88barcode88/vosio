import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { VosioWorkspace } from "@/components/vosio-workspace";
import {
  parseTranscriptTabCookieValue,
  VOSIO_ACTIVE_RECORDING_TAB_COOKIE
} from "@/components/transcript-tabs/tab-state";
import { listAiOutputsForTranscripts } from "@/lib/ai/queries";
import { listStructuredAiItemsForTranscripts } from "@/lib/ai/structured-queries";
import { getRecordingById } from "@/lib/recordings/queries";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { listTranscriptsForRecording } from "@/lib/transcripts/queries";
import { createClient } from "@/lib/supabase/server";

type RecordingDetailPageProps = {
  params: Promise<{
    recordingId: string;
  }>;
};

// RecordingDetailPage renders the workspace with a URL-selected active recording.
export default async function RecordingDetailPage({ params }: RecordingDetailPageProps) {
  const { recordingId } = await params;
  const cookieStore = await cookies();
  const persistedTranscriptTab = parseTranscriptTabCookieValue(
    recordingId,
    cookieStore.get(VOSIO_ACTIVE_RECORDING_TAB_COOKIE)?.value
  );
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/recordings/${recordingId}`);
  }

  const [recording, transcripts] = await Promise.all([
    getRecordingById(supabase, recordingId),
    listTranscriptsForRecording(supabase, recordingId)
  ]);

  if (!recording) {
    notFound();
  }

  const transcriptIds = transcripts.map((transcript) => transcript.id);
  const [aiOutputs, structuredItems] = await Promise.all([
    listAiOutputsForTranscripts(supabase, transcriptIds),
    listStructuredAiItemsForTranscripts(supabase, transcriptIds)
  ]);

  return (
    <VosioWorkspace
      activeRecordingId={recordingId}
      aiOutputs={aiOutputs}
      initialTranscriptTab={persistedTranscriptTab ?? "transcript"}
      initialTranscriptTabFromCookie={Boolean(persistedTranscriptTab)}
      recordings={[recording]}
      structuredItems={structuredItems}
      transcripts={transcripts}
      userSettings={getUserSettingsFromMetadata(user.user_metadata)}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="recordings"
    />
  );
}
