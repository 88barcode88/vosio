import { notFound, redirect } from "next/navigation";
import { RecordingOrganizationEditor } from "@/components/workspace/recording-organization-editor";
import type { OrganizationManagerActions } from "@/components/workspace/organization-manager";
import { RecordingsManager } from "@/components/workspace/recordings-manager";
import {
  canonicalizeRecordingOrganizationFilters,
  createRecordingSearchParams,
  type RecordingSearchParamsInput
} from "@/lib/recording-organization/filters";
import { normalizeRecordingSearchQuery } from "@/lib/recordings/search";
import {
  assignFixtureOrganizationAction,
  createFixtureClientAction,
  createFixtureFolderAction,
  createFixtureProjectAction,
  createFixtureTagAction,
  deleteFixtureClientAction,
  deleteFixtureFolderAction,
  deleteFixtureProjectAction,
  deleteFixtureTagAction,
  renameFixtureClientAction,
  renameFixtureFolderAction,
  renameFixtureProjectAction,
  renameFixtureTagAction
} from "./actions";
import { validateOrganizationFixtureAccess } from "./development-runtime";
import { DeleteFailureHarness } from "./delete-failure-harness";
import {
  getOrganizationFixtureSnapshot,
  listOrganizationFixtureRecordings
} from "./fixture-store";

export const dynamic = "force-dynamic";

const fixturePath = "/login/recording-organization-e2e";

// RecordingOrganizationE2EPage hosts real UI over a development-only external storage adapter.
export default async function RecordingOrganizationE2EPage({
  searchParams
}: {
  searchParams: Promise<RecordingSearchParamsInput>;
}) {
  const params = await searchParams;
  const access = validateOrganizationFixtureAccess(process.env.NODE_ENV, params.scope);
  if (!access.ok) notFound();
  const scopeValue = access.scope;

  const snapshot = getOrganizationFixtureSnapshot(scopeValue);
  const current = createRecordingSearchParams(params);
  const canonical = canonicalizeRecordingOrganizationFilters(current, snapshot.options);
  if (canonical.changed) {
    redirect(`${fixturePath}?${canonical.searchParams.toString()}`);
  }
  const searchQuery = normalizeRecordingSearchQuery(Array.isArray(params.q) ? params.q[0] : params.q);
  const recordings = listOrganizationFixtureRecordings(scopeValue, canonical.filters, searchQuery);
  const fixtureMode = Array.isArray(params.fixture) ? params.fixture[0] : params.fixture;
  const indexedSearchPage = searchQuery && (fixtureMode === "indexed" || fixtureMode === "search-error")
    ? {
        page: 1,
        pageSize: 25,
        results: recordings.map((recording) => ({
          clientId: recording.client_id,
          createdAt: recording.created_at,
          durationSeconds: recording.duration_seconds,
          fileSizeBytes: recording.file_size_bytes,
          folderId: recording.folder_id,
          id: recording.id,
          matchedExcerpt: `Výsledek [[H]]${searchQuery}[[/H]] ve vývojové fixture.`,
          matchEndMs: 2400,
          matchStartMs: 1200,
          mimeType: recording.mime_type,
          projectId: recording.project_id,
          sourceType: recording.source_type,
          status: recording.status,
          title: recording.title,
          updatedAt: recording.updated_at
        })),
        totalCount: 30
      }
    : null;
  const organizationActions: OrganizationManagerActions = {
    createClient: createFixtureClientAction.bind(null, scopeValue),
    createFolder: createFixtureFolderAction.bind(null, scopeValue),
    createProject: createFixtureProjectAction.bind(null, scopeValue),
    createTag: createFixtureTagAction.bind(null, scopeValue),
    deleteClient: deleteFixtureClientAction.bind(null, scopeValue),
    deleteFolder: deleteFixtureFolderAction.bind(null, scopeValue),
    deleteProject: deleteFixtureProjectAction.bind(null, scopeValue),
    deleteTag: deleteFixtureTagAction.bind(null, scopeValue),
    renameClient: renameFixtureClientAction.bind(null, scopeValue),
    renameFolder: renameFixtureFolderAction.bind(null, scopeValue),
    renameProject: renameFixtureProjectAction.bind(null, scopeValue),
    renameTag: renameFixtureTagAction.bind(null, scopeValue)
  };

  if (fixtureMode === "delete-failure") return <DeleteFailureHarness />;

  return (
    <main className="recording-organization-e2e-fixture">
      <section data-e2e-surface="assignment">
        <h1>Recording organization E2E fixture</h1>
        <RecordingOrganizationEditor
          key={`fixture-assignment-${snapshot.primary.id}`}
          options={snapshot.options}
          organization={snapshot.organization}
          recording={snapshot.primary}
          saveAction={assignFixtureOrganizationAction.bind(null, scopeValue)}
        />
      </section>
      <RecordingsManager
        errorCode={null}
        filters={canonical.filters}
        organizationActions={organizationActions}
        organizationOptions={snapshot.options}
        recordings={recordings}
        searchError={fixtureMode === "search-error"
          ? "Hledání se nepodařilo načíst. Zkuste to znovu."
          : null}
        searchPage={indexedSearchPage}
        searchQuery={searchQuery}
      />
    </main>
  );
}
