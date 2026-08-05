import { notFound, redirect } from "next/navigation";
import { RecordingOrganizationEditor } from "@/components/workspace/recording-organization-editor";
import { RecordingsManager } from "@/components/workspace/recordings-manager";
import {
  canonicalizeRecordingOrganizationFilters,
  createRecordingSearchParams,
  type RecordingSearchParamsInput
} from "@/lib/recording-organization/filters";
import { normalizeRecordingSearchQuery } from "@/lib/recordings/queries";
import {
  assignFixtureOrganizationAction,
  createFixtureClientAction,
  createFixtureProjectAction,
  createFixtureTagAction
} from "./actions";
import {
  getOrganizationFixtureSnapshot,
  listOrganizationFixtureRecordings
} from "./fixture-store";

export const dynamic = "force-dynamic";

const scopePattern = /^[0-9a-f]{11}$/;
const fixturePath = "/login/recording-organization-e2e";

// RecordingOrganizationE2EPage hosts real UI over a development-only external storage adapter.
export default async function RecordingOrganizationE2EPage({
  searchParams
}: {
  searchParams: Promise<RecordingSearchParamsInput>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;
  const scopeValue = Array.isArray(params.scope) ? params.scope[0] : params.scope;
  if (!scopeValue || !scopePattern.test(scopeValue)) notFound();

  const snapshot = getOrganizationFixtureSnapshot(scopeValue);
  const current = createRecordingSearchParams(params);
  const canonical = canonicalizeRecordingOrganizationFilters(current, snapshot.options);
  if (canonical.changed) {
    redirect(`${fixturePath}?${canonical.searchParams.toString()}`);
  }
  const searchQuery = normalizeRecordingSearchQuery(Array.isArray(params.q) ? params.q[0] : params.q);
  const recordings = listOrganizationFixtureRecordings(scopeValue, canonical.filters, searchQuery);
  const organizationActions = {
    createClient: createFixtureClientAction.bind(null, scopeValue),
    createProject: createFixtureProjectAction.bind(null, scopeValue),
    createTag: createFixtureTagAction.bind(null, scopeValue)
  };

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
        searchQuery={searchQuery}
      />
    </main>
  );
}
