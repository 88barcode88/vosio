import { notFound } from "next/navigation";
import { RecordingDetailTitleEditor } from "@/components/workspace/recording-detail-title-editor";
import { RecordingTitleEditor } from "@/components/workspace/recording-title-editor";
import { saveFixtureRecordingTitle } from "./actions";
import { getFixtureTitle } from "./fixture-store";

export const dynamic = "force-dynamic";

const fixtureScopePattern = /^[0-9a-f]{11}$/;

// SaveAndCollapseFixturePage exposes real title editors only on the local development server.
export default async function SaveAndCollapseFixturePage({
  searchParams
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const { scope } = await searchParams;
  if (!scope || !fixtureScopePattern.test(scope)) {
    notFound();
  }

  const detailRecordingId = `00000000-0000-4000-8000-${scope}1`;
  const listRecordingId = `00000000-0000-4000-8000-${scope}2`;
  const detailTitle = getFixtureTitle(detailRecordingId, "Výchozí detail");
  const listTitle = getFixtureTitle(listRecordingId, "Výchozí seznam");

  return (
    <main className="save-collapse-e2e-fixture">
      <h1>Save and collapse E2E fixture</h1>
      <section data-e2e-surface="detail">
        <h2>Detail</h2>
        <p>
          Uložený název: <strong data-e2e-saved-title>{detailTitle}</strong>
        </p>
        <RecordingDetailTitleEditor
          recordingId={detailRecordingId}
          saveAction={saveFixtureRecordingTitle}
          title={detailTitle}
        />
      </section>
      <section data-e2e-surface="list">
        <h2>Seznam</h2>
        <p>
          Uložený název: <strong data-e2e-saved-title>{listTitle}</strong>
        </p>
        <RecordingTitleEditor
          recordingId={listRecordingId}
          saveAction={saveFixtureRecordingTitle}
          title={listTitle}
        />
      </section>
    </main>
  );
}
