import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import {
  canonicalizeRecordingOrganizationFilters,
  createRecordingSearchParams,
  type RecordingOrganizationFilters,
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
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";
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

type RecordingData = {
  recordings: RecordingRow[];
  searchError: string | null;
  searchPage: RecordingSearchPage | null;
};

type RecordingReadPhase = {
  canonicalSearch: ReturnType<typeof canonicalizeRecordingSearchParams>;
  canonicalStatus: ReturnType<typeof canonicalizeRecordingStatusFilter>;
  deletedCount: number;
  filters: RecordingOrganizationFilters;
  organizationOptions: RecordingOrganizationOptions;
  recordingData: RecordingData;
  statusCounts: Awaited<ReturnType<typeof countOwnRecordingStatuses>>;
} | {
  redirectHref: string;
};

// hasOrganizationFilterValues keeps no-filter loads independent from owner lookup options.
function hasOrganizationFilterValues(searchParams: URLSearchParams) {
  return ["client", "project", "folder", "tag"].some((key) => searchParams.has(key));
}

// loadWithSingleRetry repeats only a rejected idempotent server read once.
async function loadWithSingleRetry<T>(load: () => Promise<T>) {
  try {
    return await load();
  } catch {
    return load();
  }
}

// loadRecordingData preserves search RPC failures as inline workspace state rather than route failures.
function loadRecordingData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: RecordingOrganizationFilters,
  searchQuery: string,
  page: number,
  status: ReturnType<typeof canonicalizeRecordingStatusFilter>["status"]
): Promise<RecordingData> {
  const emptyRecordingSearchPage: RecordingSearchPage | null = searchQuery ? {
    page,
    pageSize: RECORDING_SEARCH_PAGE_SIZE,
    results: [],
    totalCount: 0
  } : null;

  return searchQuery
    ? loadWithSingleRetry(() => searchOwnRecordings(supabase, {
        organizationFilters: filters,
        page,
        searchQuery,
        status
      })).then(
        (searchPage) => ({ recordings: [], searchError: null, searchPage }),
        () => ({
          recordings: [],
          searchError: "Hledání se nepodařilo načíst. Zkuste to znovu.",
          searchPage: emptyRecordingSearchPage
        })
      )
    : listRecordings(supabase, { organizationFilters: filters, status })
      .then((recordings) => ({ recordings, searchError: null, searchPage: null }));
}

// loadRecordingReadPhase canonicalizes filtered URLs before reads and starts no-filter reads together.
async function loadRecordingReadPhase(
  supabase: Awaited<ReturnType<typeof createClient>>,
  searchParams: URLSearchParams,
  searchQuery: string
): Promise<RecordingReadPhase> {
  if (hasOrganizationFilterValues(searchParams)) {
    const organizationOptions = await listRecordingOrganizationOptions(supabase);
    const canonical = canonicalizeRecordingOrganizationFilters(searchParams, organizationOptions);
    const canonicalSearch = canonicalizeRecordingSearchParams(canonical.searchParams, searchQuery);
    const canonicalStatus = canonicalizeRecordingStatusFilter(canonicalSearch.searchParams);

    if (canonical.changed || canonicalSearch.changed || canonicalStatus.changed) {
      const queryString = canonicalStatus.searchParams.toString();
      return { redirectHref: queryString ? `/recordings?${queryString}` : "/recordings" };
    }

    const [statusCounts, deletedCount, recordingData] = await Promise.all([
      countOwnRecordingStatuses(supabase, {
        organizationFilters: canonical.filters,
        searchQuery
      }),
      countDeletedRecordings(supabase),
      loadRecordingData(
        supabase,
        canonical.filters,
        searchQuery,
        canonicalSearch.page,
        canonicalStatus.status
      )
    ]);
    return {
      canonicalSearch,
      canonicalStatus,
      deletedCount,
      filters: canonical.filters,
      organizationOptions,
      recordingData,
      statusCounts
    };
  }

  const canonicalSearch = canonicalizeRecordingSearchParams(searchParams, searchQuery);
  const canonicalStatus = canonicalizeRecordingStatusFilter(canonicalSearch.searchParams);
  if (canonicalSearch.changed || canonicalStatus.changed) {
    const queryString = canonicalStatus.searchParams.toString();
    return { redirectHref: queryString ? `/recordings?${queryString}` : "/recordings" };
  }

  const filters: RecordingOrganizationFilters = {
    clientId: null,
    folderId: null,
    projectId: null,
    tagIds: []
  };
  const [organizationOptions, statusCounts, deletedCount, recordingData] = await Promise.all([
    listRecordingOrganizationOptions(supabase),
    countOwnRecordingStatuses(supabase, { organizationFilters: filters, searchQuery }),
    countDeletedRecordings(supabase),
    loadRecordingData(supabase, filters, searchQuery, canonicalSearch.page, canonicalStatus.status)
  ]);
  return {
    canonicalSearch,
    canonicalStatus,
    deletedCount,
    filters,
    organizationOptions,
    recordingData,
    statusCounts
  };
}

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

  const initialSearchParams = createRecordingSearchParams(params);
  const readPhase = await loadWithSingleRetry(() =>
    loadRecordingReadPhase(supabase, initialSearchParams, searchQuery)
  );
  if ("redirectHref" in readPhase) {
    redirect(readPhase.redirectHref);
  }
  const {
    canonicalSearch,
    canonicalStatus,
    deletedCount,
    filters,
    organizationOptions,
    recordingData,
    statusCounts
  } = readPhase;
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
    redirect(buildRecordingSearchPageHref(canonicalStatus.searchParams, 1));
  }

  const paginationSearchParams = new URLSearchParams(canonicalStatus.searchParams);
  paginationSearchParams.delete("warning", TRANSCRIPT_SEARCH_INDEX_WARNING);
  const recordingSearchPreviousHref = searchQuery && canonicalSearch.page > 1
    ? buildRecordingSearchPageHref(paginationSearchParams, canonicalSearch.page - 1)
    : null;
  const recordingSearchNextHref = searchQuery
    && recordingSearchPage
    && canonicalSearch.page < RECORDING_SEARCH_MAX_PAGE
    && canonicalSearch.page * recordingSearchPage.pageSize < recordingSearchPage.totalCount
    ? buildRecordingSearchPageHref(paginationSearchParams, canonicalSearch.page + 1)
    : null;

  return (
    <VosioWorkspace
      aiOutputs={[]}
      recordings={recordings}
      recordingsError={(Array.isArray(params.error) ? params.error[0] : params.error) ?? null}
      recordingOrganizationOptions={organizationOptions}
      recordingOrganizationFilters={filters}
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
