"use client";

import { DeleteRecordingForm } from "@/components/delete-recording-form";
import { WorkspaceSidebar } from "@/components/workspace/sidebar";

const fixtureRecordingId = "00000000-0000-4000-8000-000000000001";

// rejectFixtureDelete exposes the real optimistic failure UI without mutating product or fixture data.
async function rejectFixtureDelete(_formData: FormData) {
  await new Promise((resolve) => window.setTimeout(resolve, 800));
  throw new Error("Development-only delete rejection.");
}

// FixtureEditAction supplies the real action-cell geometry without opening an unrelated editor.
function FixtureEditAction({ label }: { label: string }) {
  return (
    <div className="recording-title-edit">
      <button
        aria-expanded="false"
        aria-label={label}
        className="recording-title-edit-button"
        type="button"
      >
        <span className="recording-action-label">Upravit</span> <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

// DeleteFailureHarness exercises real DeleteRecordingForm pending and recovery behavior in guarded development UI.
export function DeleteFailureHarness() {
  return (
    <main className="workspace-shell" data-delete-failure-shell>
      <WorkspaceSidebar activeView="recordings" userEmail="fixture@example.cz" />
      <section className="content-area content-area-recordings-list" data-delete-failure-content>
        <div className="workspace-grid workspace-grid-wide">
          <section className="ui-panel recordings-inbox" data-delete-failure-harness>
            <h2>Delete failure layout fixture</h2>
            <div className="recordings-table" data-delete-failure-table>
              <div className="recordings-table-head" aria-hidden="true">
                <div className="recordings-table-head-main">
                  <span>Název</span>
                  <span>Stav</span>
                  <span>Velikost</span>
                </div>
                <span className="recordings-table-head-actions">Akce</span>
              </div>
              <section className="recording-client-group">
                <h2>Bez klienta <span>1</span></h2>
                <article
                  className="recordings-row"
                  data-delete-failure-row
                  data-recording-id={fixtureRecordingId}
                >
                  <div className="recordings-row-main">
                    <div className="recordings-row-title">
                      <strong>Poslední desktop řádek</strong>
                      <span>Vývojová fixture</span>
                    </div>
                    <span>Dokončeno</span>
                    <span className="recordings-row-size">2.0 KB</span>
                  </div>
                  <div className="recordings-row-actions" aria-label="Akce fixture řádku" role="group">
                    <FixtureEditAction label="Upravit fixture řádek" />
                    <DeleteRecordingForm
                      deleteAction={rejectFixtureDelete}
                      recordingId={fixtureRecordingId}
                      variant="compact"
                    />
                  </div>
                </article>
              </section>
            </div>
            <p data-after-delete-failure-table>Obsah pod tabulkou</p>

            <div className="recording-search-result-list" role="list">
              <article
                className="recording-search-result"
                data-delete-failure-search-card
                data-recording-delete-target
                role="listitem"
              >
                <div className="recording-search-result-main">
                  <strong>Search karta s chybou</strong>
                  <span>Vývojová fixture</span>
                </div>
                <div className="recordings-row-actions" aria-label="Akce fixture search karty" role="group">
                  <FixtureEditAction label="Upravit fixture search kartu" />
                  <DeleteRecordingForm
                    deleteAction={rejectFixtureDelete}
                    recordingId={fixtureRecordingId}
                    variant="compact"
                  />
                </div>
              </article>
              <article
                className="recording-search-result"
                data-after-delete-failure-search-card
                role="listitem"
              >
                <div className="recording-search-result-main">Následující search karta</div>
              </article>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
