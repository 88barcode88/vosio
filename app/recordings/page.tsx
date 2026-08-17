import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import {
  canonicalizeRecordingOrganizationFilters,
  createRecordingSearchParams,
  type RecordingSearchParamsInput
} from "@/lib/recording-organization/filters";
import { canonicalizeRecordingStatusFilter } from "@/lib/recordings/list-filters";
import {
  countDeletedRecordings,
  countOwnRecordingStatuses,
  listRecordings
} from "@/lib/recordings/queries";
import {
  RECORDING_SEARCH_MAX_PAGE,
  RECORDING_SEARCH_PAGE_SIZE,
  buildRecordingSearchPageHref,
  canonicalizeRecordingSearchParams,
  normalizeRecordingSearchQuery,
  searchOwnRecordings
} from "@/lib/recordings/search";
import { listRecordingOrganizationOptions } from "@/lib/recording-organization/queries";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { createClient } from "@/lib/supabase/server";
import type { RecordingSearchPage, RecordingRow } from "@/lib/recordings/types";
import {
  TRANSCRIPT_SEARCH_INDEX_WARNING,
  isTranscriptSearchIndexWarningCode
} from "@/lib/transcripts/search-warning";

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
  const canonicalSearch = canonicalizeRecordingSearchParams(canonical.searchParams, searchQuery);
  const canonicalStatus = canonicalizeRecordingStatusFilter(canonicalSearch.searchParams);
  if (canonical.changed || canonicalSearch.changed || canonicalStatus.changed) {
    const queryString = canonicalStatus.searchParams.toString();
    redirect(queryString ? `/recordings?${queryString}` : "/recordings");
  }
  const emptyRecordingSearchPage: RecordingSearchPage | null = searchQuery ? {
    page: canonicalSearch.page,
    pageSize: RECORDING_SEARCH_PAGE_SIZE,
    results: [],
    totalCount: 0
  } : null;
  const recordingDataPromise: Promise<{
    recordings: RecordingRow[];
    searchError: string | null;
    searchPage: RecordingSearchPage | null;
  }> = searchQuery
    ? searchOwnRecordings(supabase, {
        organizationFilters: canonical.filters,
        page: canonicalSearch.page,
        searchQuery,
        status: canonicalStatus.status
      }).then(
        (searchPage) => ({ recordings: [], searchError: null, searchPage }),
        () => ({
          recordings: [],
          searchError: "Hledání se nepodařilo načíst. Zkuste to znovu.",
          searchPage: emptyRecordingSearchPage
        })
      )
    : listRecordings(supabase, {
        organizationFilters: canonical.filters,
        status: canonicalStatus.status
      }).then((recordings) => ({ recordings, searchError: null, searchPage: null }));
  const [statusCounts, deletedCount, recordingData] = await Promise.all([
    countOwnRecordingStatuses(supabase, {
      organizationFilters: canonical.filters,
      searchQuery
    }),
    countDeletedRecordings(supabase),
    recordingDataPromise
  ]);
  statusCounts.deleted = deletedCount;
  const {
    recordings,
    searchError: recordingSearchError,
    searchPage: recordingSearchPage
  } = recordingData;

  if (!recordingSearchError
    && searchQuery
    && canonicalSearch.page > 1
    && recordingSearchPage?.results.length === 0) {
    redirect(buildRecordingSearchPageHref(canonicalSearch.searchParams, 1));
  }

  const paginationParams = new URLSearchParams(canonicalStatus.searchParams);
  paginationParams.delete("warning", TRANSCRIPT_SEARCH_INDEX_WARNING);
  const recordingSearchPreviousHref = searchQuery && canonicalSearch.page > 1
    ? buildRecordingSearchPageHref(paginationParams, canonicalSearch.page - 1)
    : null;
  const recordingSearchNextHref = searchQuery
    && recordingSearchPage
    && canonicalSearch.page < RECORDING_SEARCH_MAX_PAGE
    && canonicalSearch.page * recordingSearchPage.pageSize < recordingSearchPage.totalCount
    ? buildRecordingSearchPageHref(paginationParams, canonicalSearch.page + 1)
    : null;

  return (
    <VosioWorkspace
      aiOutputs={[]}
      recordings={recordings}
      recordingsError={(Array.isArray(params.error) ? params.error[0] : params.error) ?? null}
      recordingOrganizationOptions={organizationOptions}
      recordingOrganizationFilters={canonical.filters}
      recordingStatus={canonicalStatus.status}
      recordingStatusCounts={statusCounts}
      recordingsSearchParams={canonicalStatus.searchParams.toString()}
      recordingsSearchQuery={searchQuery}
      recordingSearchError={recordingSearchError}
      recordingSearchNextHref={recordingSearchNextHref}
      recordingSearchPage={recordingSearchPage}
      recordingSearchPreviousHref={recordingSearchPreviousHref}
      transcripts={[]}
      transcriptSearchWarning={isTranscriptSearchIndexWarningCode(params.warning)}
      userSettings={getUserSettingsFromMetadata(user.user_metadata)}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="recordings"
    />
  );
}
