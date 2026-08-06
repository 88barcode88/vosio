import { notFound } from "next/navigation";
import { TranscriptTabs } from "@/components/transcript-tabs";
import { getTranscriptSpeakerBlocks } from "@/components/transcript-tabs/speaker-blocks";
import { RecordingsManager } from "@/components/workspace/recordings-manager";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";
import type { RecordingSearchPage } from "@/lib/recordings/types";
import {
  buildRecordingSearchPageHref,
  normalizeRecordingSearchQuery,
  RECORDING_SEARCH_PAGE_SIZE
} from "@/lib/recordings/search";
import { defaultUserSettings } from "@/lib/settings/types";
import {
  parseTranscriptDeepLink,
  resolveTranscriptDeepLink
} from "@/lib/transcripts/deep-link";
import { validateRecordingSearchFixtureAccess } from "./development-runtime";
import {
  createSearchFixtureTranscriptCandidates,
  searchFixtureRecordingId,
  searchFixtureUserId,
  selectCurrentOwnedSearchFixtureCandidate,
  type SearchFixtureCandidate
} from "./fixture-data";

export const dynamic = "force-dynamic";

const clientId = "00000000-0000-4000-8000-000000000204";
const tagId = "00000000-0000-4000-8000-000000000205";

type SearchFixtureParams = Record<string, string | string[] | undefined>;

const emptyStructuredItems: StructuredAiItems = {
  chapters: [],
  decisions: [],
  risks: [],
  tasks: []
};

const organizationOptions: RecordingOrganizationOptions = {
  clients: [{
    color: null,
    created_at: "2026-08-05T10:00:00.000Z",
    id: clientId,
    name: "Vlastní klient",
    updated_at: "2026-08-05T10:00:00.000Z",
    user_id: searchFixtureUserId
  }],
  folders: [],
  projects: [],
  tags: [{
    color: null,
    created_at: "2026-08-05T10:00:00.000Z",
    id: tagId,
    name: "Důležité",
    updated_at: "2026-08-05T10:00:00.000Z",
    user_id: searchFixtureUserId
  }]
};

// createSearchFixturePage models one bounded ranked page without foreign, deleted or older rows.
function createSearchFixturePage(
  page: number,
  selected: SearchFixtureCandidate
): RecordingSearchPage {
  const { recording } = selected;

  return {
    page,
    pageSize: RECORDING_SEARCH_PAGE_SIZE,
    results: [{
      clientId,
      createdAt: recording.created_at,
      durationSeconds: recording.duration_seconds,
      fileSizeBytes: recording.file_size_bytes,
      folderId: null,
      id: recording.id,
      matchedExcerpt: "Řešíme [[H]]Lucern CRM[[/H]] <img src=x onerror=alert(1)>",
      matchEndMs: 9_000,
      matchStartMs: 8_000,
      mimeType: recording.mime_type,
      projectId: null,
      sourceType: recording.source_type,
      status: recording.status,
      title: recording.title,
      updatedAt: recording.updated_at
    }],
    totalCount: RECORDING_SEARCH_PAGE_SIZE + 1
  };
}

// RecordingSearchE2EPage runs real search and transcript components over an isolated dev-only adapter.
export default async function RecordingSearchE2EPage({
  searchParams
}: {
  searchParams: Promise<SearchFixtureParams>;
}) {
  const query = await searchParams;
  const access = validateRecordingSearchFixtureAccess(process.env.NODE_ENV, query.scope);

  if (!access.ok) notFound();

  const candidates = createSearchFixtureTranscriptCandidates();
  const selected = selectCurrentOwnedSearchFixtureCandidate(
    candidates,
    searchFixtureRecordingId,
    searchFixtureUserId
  );

  if (!selected) notFound();

  if (query.view === "detail") {
    const transcript = selected.transcript;
    const parsedDeepLink = parseTranscriptDeepLink(query);
    const initialDeepLink = parsedDeepLink.request
      ? resolveTranscriptDeepLink({
          rawText: transcript.raw_text,
          recordingId: searchFixtureRecordingId,
          request: parsedDeepLink.request,
          speakerBlocks: getTranscriptSpeakerBlocks(transcript.segments, transcript.speakers),
          transcriptId: transcript.id
        })
      : null;

    return (
      <main data-e2e-candidate-count={candidates.length} data-e2e-search-view="detail">
        <TranscriptTabs
          activeAiOutputs={[]}
          activeRecording={selected.recording}
          activeStructuredItems={emptyStructuredItems}
          activeTranscript={transcript}
          initialDeepLink={initialDeepLink}
          initialTab={parsedDeepLink.explicitTranscriptTab ? "transcript" : "ai"}
          initialTabFromUrl={parsedDeepLink.explicitTranscriptTab}
          userSettings={defaultUserSettings}
        />
      </main>
    );
  }

  const normalizedQuery = normalizeRecordingSearchQuery(
    Array.isArray(query.q) ? query.q[0] : query.q
  ) || "Lucern CRM";
  const page = query.page === "2" ? 2 : 1;
  const canonicalParams = new URLSearchParams({
    client: clientId,
    q: normalizedQuery,
    scope: access.scope,
    tag: tagId
  });

  if (page > 1) canonicalParams.set("page", String(page));

  return (
    <main data-e2e-candidate-count={candidates.length} data-e2e-search-view="list">
      <RecordingsManager
        errorCode={null}
        filters={{ clientId, folderId: null, projectId: null, tagIds: [tagId] }}
        organizationOptions={organizationOptions}
        recordings={[]}
        searchNextHref={page === 1 ? buildRecordingSearchPageHref(canonicalParams, 2) : null}
        searchPage={createSearchFixturePage(page, selected)}
        searchPreviousHref={page === 2 ? buildRecordingSearchPageHref(canonicalParams, 1) : null}
        searchQuery={normalizedQuery}
      />
    </main>
  );
}
