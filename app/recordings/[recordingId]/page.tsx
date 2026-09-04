import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { VosioWorkspace } from "@/components/vosio-workspace";
import {
  parseTranscriptTabSearchParams,
  parseTranscriptTabCookieValue,
  VOSIO_ACTIVE_RECORDING_TAB_COOKIE
} from "@/components/transcript-tabs/tab-state";
import { getRecordingById } from "@/lib/recordings/queries";
import { listRecordingMarkers } from "@/lib/recording-markers/queries";
import {
  getRecordingOrganization,
  listRecordingOrganizationOptions
} from "@/lib/recording-organization/queries";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { listTranscriptsForRecording } from "@/lib/transcripts/queries";
import {
  parseTranscriptDeepLink,
  resolveTranscriptDeepLink
} from "@/lib/transcripts/deep-link";
import { getTranscriptSpeakerBlocks } from "@/components/transcript-tabs/speaker-blocks";
import { createClient } from "@/lib/supabase/server";
import { isTranscriptSearchIndexWarningCode } from "@/lib/transcripts/search-warning";

type RecordingDetailPageProps = {
  params: Promise<{
    recordingId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// RecordingDetailPage renders the workspace with a URL-selected active recording.
export default async function RecordingDetailPage({ params, searchParams }: RecordingDetailPageProps) {
  const { recordingId } = await params;
  const query = await searchParams;
  const parsedDeepLink = parseTranscriptDeepLink(query);
  const parsedUrlTab = parseTranscriptTabSearchParams(query);
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

  if (!parsedUrlTab.valid) {
    const canonicalQuery = createCanonicalDetailSearchParams(query);
    canonicalQuery.delete("tab");
    canonicalQuery.delete("at");
    canonicalQuery.delete("highlight");
    const suffix = canonicalQuery.toString();
    redirect(`/recordings/${encodeURIComponent(recordingId)}${suffix ? `?${suffix}` : ""}`);
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

  const currentTranscript = transcripts[0] ?? null;
  const initialDeepLink = parsedDeepLink.request && currentTranscript
    ? resolveTranscriptDeepLink({
        rawText: currentTranscript.raw_text,
        recordingId,
        request: parsedDeepLink.request,
        speakerBlocks: getTranscriptSpeakerBlocks(
          currentTranscript.segments,
          currentTranscript.speakers
        ),
        transcriptId: currentTranscript.id
      })
    : null;
  const recordingOrganization = await getRecordingOrganization(supabase, recording);

  return (
    <VosioWorkspace
      activeRecordingId={recordingId}
      aiOutputs={[]}
      initialTranscriptDeepLink={initialDeepLink}
      initialTranscriptTab={parsedDeepLink.explicitTranscriptTab
        ? "transcript"
        : parsedUrlTab.explicit
          ? parsedUrlTab.tab
          : persistedTranscriptTab ?? "transcript"}
      initialTranscriptTabFromCookie={!parsedUrlTab.explicit && Boolean(persistedTranscriptTab)}
      initialTranscriptTabFromUrl={parsedUrlTab.explicit}
      recordings={[recording]}
      recordingMarkers={recordingMarkers}
      recordingOrganization={recordingOrganization}
      recordingOrganizationOptions={organizationOptions}
      transcripts={transcripts}
      transcriptSearchWarning={isTranscriptSearchIndexWarningCode(query.warning)}
      userSettings={getUserSettingsFromMetadata(user.user_metadata)}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="recordings"
    />
  );
}

// createCanonicalDetailSearchParams preserves unrelated safe values while retaining duplicates for removal.
function createCanonicalDetailSearchParams(
  query: Record<string, string | string[] | undefined>
) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : typeof value === "string" ? [value] : []) {
      searchParams.append(key, item);
    }
  }
  return searchParams;
}
