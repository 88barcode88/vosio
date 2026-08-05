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
import { listRecordingMarkers } from "@/lib/recording-markers/queries";
import {
  getRecordingOrganization,
  listRecordingOrganizationOptions
} from "@/lib/recording-organization/queries";
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

  const [recording, recordingMarkers, transcripts, organizationOptions] = await Promise.all([
    getRecordingById(supabase, recordingId),
    listRecordingMarkers(supabase, recordingId),
    listTranscriptsForRecording(supabase, recordingId),
    listRecordingOrganizationOptions(supabase)
  ]);

  if (!recording) {
    notFound();
  }

  const transcriptIds = transcripts.map((transcript) => transcript.id);
  const [aiOutputs, structuredItems, recordingOrganization] = await Promise.all([
    listAiOutputsForTranscripts(supabase, transcriptIds),
    listStructuredAiItemsForTranscripts(supabase, transcriptIds),
    getRecordingOrganization(supabase, recording)
  ]);

  return (
    <VosioWorkspace
      activeRecordingId={recordingId}
      aiOutputs={aiOutputs}
      initialTranscriptTab={persistedTranscriptTab ?? "transcript"}
      initialTranscriptTabFromCookie={Boolean(persistedTranscriptTab)}
      recordings={[recording]}
      recordingMarkers={recordingMarkers}
      recordingOrganization={recordingOrganization}
      recordingOrganizationOptions={organizationOptions}
      structuredItems={structuredItems}
      transcripts={transcripts}
      userSettings={getUserSettingsFromMetadata(user.user_metadata)}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="recordings"
    />
  );
}
