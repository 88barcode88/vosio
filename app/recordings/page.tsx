import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import {
  canonicalizeRecordingOrganizationFilters,
  createRecordingSearchParams,
  type RecordingSearchParamsInput
} from "@/lib/recording-organization/filters";
import { listRecordings, normalizeRecordingSearchQuery } from "@/lib/recordings/queries";
import { listRecordingOrganizationOptions } from "@/lib/recording-organization/queries";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { createClient } from "@/lib/supabase/server";
import { isTranscriptSearchIndexWarningCode } from "@/lib/transcripts/search-warning";

type RecordingsPageProps = {
  searchParams: Promise<RecordingSearchParamsInput>;
};

// RecordingsPage renders the protected recordings workspace list entry point.
export default async function RecordingsPage({ searchParams }: RecordingsPageProps) {
  const params = await searchParams;
  const searchQuery = normalizeRecordingSearchQuery(Array.isArray(params.q) ? params.q[0] : params.q);
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/recordings");
  }

  const organizationOptions = await listRecordingOrganizationOptions(supabase);
  const canonical = canonicalizeRecordingOrganizationFilters(
    createRecordingSearchParams(params),
    organizationOptions
  );
  if (canonical.changed) {
    const queryString = canonical.searchParams.toString();
    redirect(queryString ? `/recordings?${queryString}` : "/recordings");
  }
  const recordings = await listRecordings(supabase, {
    organizationFilters: canonical.filters,
    searchQuery
  });

  return (
    <VosioWorkspace
      aiOutputs={[]}
      recordings={recordings}
      recordingsError={(Array.isArray(params.error) ? params.error[0] : params.error) ?? null}
      recordingOrganizationOptions={organizationOptions}
      recordingOrganizationFilters={canonical.filters}
      recordingsSearchQuery={searchQuery}
      transcripts={[]}
      transcriptSearchWarning={isTranscriptSearchIndexWarningCode(params.warning)}
      userSettings={getUserSettingsFromMetadata(user.user_metadata)}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="recordings"
    />
  );
}
