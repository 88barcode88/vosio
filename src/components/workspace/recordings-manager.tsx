import { Plus } from "lucide-react";
import Link from "next/link";
import { DeleteRecordingForm } from "@/components/delete-recording-form";
import { LiveRecordingRecoveryPanel } from "@/components/live-recording-recovery-panel";
import { SearchResultExcerpt } from "@/components/search-result-excerpt";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  OrganizationManager,
  type OrganizationManagerActions
} from "@/components/workspace/organization-manager";
import { RecordingFilters } from "@/components/workspace/recording-filters";
import { RecordingsSearchErrorActions } from "@/components/workspace/recordings-search-error-actions";
import { RecordingTitleEditor } from "@/components/workspace/recording-title-editor";
import {
  formatDuration,
  getRecordingCounts,
  getSourceTypeLabel
} from "@/components/workspace/utils";
import {
  groupRecordingsByClient,
  type RecordingOrganizationFilters
} from "@/lib/recording-organization/filters";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";
import { buildRecordingSearchResultHref } from "@/lib/recordings/search";
import {
  formatFileSize,
  formatRecordingDate,
  getStatusLabel,
  type RecordingRow,
  type RecordingSearchPage,
  type RecordingSearchResult,
  type RecordingStatus
} from "@/lib/recordings/types";

const statusOrder: RecordingStatus[] = [
  "created",
  "uploading",
  "uploaded",
  "transcribing",
  "completed",
  "failed",
  "deleted"
];

// getRecordingsErrorMessage maps recordings URL errors into compact Czech UI copy.
function getRecordingsErrorMessage(errorCode: string | null) {
  const messages: Record<string, string> = {
    delete_failed: "Nahrávku se nepodařilo přesunout do Koše.",
    invalid_delete: "Mazání nahrávky nemá platná data.",
    invalid_title: "Název nahrávky není platný.",
    title_update_failed: "Název nahrávky se nepodařilo uložit."
  };

  return errorCode ? messages[errorCode] ?? "Akce nad nahrávkou se nepodařila." : null;
}

// formatRecordingResultCount keeps the filtered result status grammatically compact.
function formatRecordingResultCount(count: number) {
  if (count === 1) return "1 nahrávka";
  if (count >= 2 && count <= 4) return `${count} nahrávky`;
  return `${count} nahrávek`;
}

// getStatusTone maps recording states onto the shared badge semantics.
function getStatusTone(status: RecordingStatus) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "deleted") return "danger" as const;
  if (status === "uploading" || status === "transcribing") return "info" as const;
  if (status === "uploaded") return "warning" as const;
  return "neutral" as const;
}

// getSearchOrganizationMeta maps safe result ids onto already-owned organization labels.
function getSearchOrganizationMeta(
  result: RecordingSearchResult,
  options: RecordingOrganizationOptions
) {
  return [
    options.clients.find((item) => item.id === result.clientId)?.name,
    options.projects.find((item) => item.id === result.projectId)?.name,
    options.folders.find((item) => item.id === result.folderId)?.name
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

// getRecordingOrganizationMeta exposes only labels already available in owned list options.
function getRecordingOrganizationMeta(
  recording: RecordingRow,
  options: RecordingOrganizationOptions
) {
  return [
    options.projects.find((item) => item.id === recording.project_id)?.name,
    options.folders.find((item) => item.id === recording.folder_id)?.name
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

// RecordingStatusSummary renders all persisted statuses as one compact, scan-friendly line.
function RecordingStatusSummary({
  records,
  total
}: {
  records: Array<{ status: RecordingStatus }>;
  total: number;
}) {
  const counts = getRecordingCounts(records);

  return (
    <div className="recordings-status-summary" aria-label="Stavy nahrávek" role="group">
      <span className="recordings-status-total"><strong>{total}</strong> celkem</span>
      <div className="recordings-status-segments">
        {statusOrder.map((status) => (
          <span className="recordings-status-segment" key={status}>
            {getStatusLabel(status)} <strong>{counts[status]}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

// RecordingSearchResults renders ranked RPC results without misleading organization grouping.
function RecordingSearchResults({
  error,
  nextHref,
  options,
  page,
  previousHref,
  searchQuery
}: {
  error: string | null;
  nextHref: string | null;
  options: RecordingOrganizationOptions;
  page: RecordingSearchPage;
  previousHref: string | null;
  searchQuery: string;
}) {
  const totalPages = Math.max(1, Math.ceil(page.totalCount / page.pageSize));

  if (error) {
    return (
      <section className="recordings-search-error" aria-label="Chyba hledání">
        <p className="recordings-alert" role="alert">{error}</p>
        <RecordingsSearchErrorActions />
      </section>
    );
  }

  return (
    <section className="recording-search-results" aria-label="Výsledky hledání v nahrávkách">
      <p aria-live="polite" className="recordings-search-status" role="status">
        Nalezeno {formatRecordingResultCount(page.totalCount)}. Strana {page.page} z {totalPages}.
      </p>
      {page.results.length > 0 ? (
        <div className="recording-search-result-list" role="list">
          {page.results.map((result) => {
            const organizationMeta = getSearchOrganizationMeta(result, options);

            return (
              <article
                className="recording-search-result"
                data-recording-delete-target
                data-recording-id={result.id}
                key={result.id}
                role="listitem"
              >
                <div className="recording-search-result-main">
                  <header>
                    <Link
                      aria-label={`Otevřít nalezenou nahrávku ${result.title}`}
                      data-touch-target="action"
                      href={buildRecordingSearchResultHref(result, searchQuery)}
                    >
                      <strong>{result.title}</strong>
                    </Link>
                    <StatusBadge tone={getStatusTone(result.status)}>{getStatusLabel(result.status)}</StatusBadge>
                  </header>
                  <div className="recording-search-result-meta">
                    <span>{formatRecordingDate(result.createdAt)}</span>
                    <span>{getSourceTypeLabel(result.sourceType)}</span>
                    <span>{formatDuration(result.durationSeconds)}</span>
                    <span>{formatFileSize(result.fileSizeBytes)}</span>
                    {organizationMeta ? <span>{organizationMeta}</span> : null}
                  </div>
                  {result.matchedExcerpt ? <SearchResultExcerpt excerpt={result.matchedExcerpt} /> : null}
                </div>
                <div
                  className="recordings-row-actions"
                  aria-label={`Akce nahrávky ${result.title}`}
                  role="group"
                >
                  <RecordingTitleEditor recordingId={result.id} title={result.title} />
                  <DeleteRecordingForm recordingId={result.id} />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          action={<Link href="/recordings">Vyčistit hledání a filtry</Link>}
          description="Upravte hledání nebo začněte znovu bez aktivních filtrů."
          title="Žádná odpovídající nahrávka"
        />
      )}
      {page.totalCount > page.pageSize || page.page > 1 ? (
        <nav aria-label="Stránkování výsledků hledání" className="recording-search-pagination">
          {previousHref ? <Link data-touch-target="action" href={previousHref}>Předchozí</Link> : <span aria-disabled="true">Předchozí</span>}
          <span>Strana {page.page} z {totalPages}</span>
          {nextHref ? <Link data-touch-target="action" href={nextHref}>Další</Link> : <span aria-disabled="true">Další</span>}
        </nav>
      ) : null}
    </section>
  );
}

// RecordingsManager renders the compact inbox-style all-recordings workspace.
export function RecordingsManager({
  errorCode,
  filters,
  organizationActions,
  organizationOptions,
  recordings,
  searchError = null,
  searchNextHref = null,
  searchPage = null,
  searchPreviousHref = null,
  searchQuery
}: {
  errorCode: string | null;
  filters: RecordingOrganizationFilters;
  organizationActions?: OrganizationManagerActions;
  organizationOptions: RecordingOrganizationOptions;
  recordings: RecordingRow[];
  searchError?: string | null;
  searchNextHref?: string | null;
  searchPage?: RecordingSearchPage | null;
  searchPreviousHref?: string | null;
  searchQuery: string;
}) {
  const hasActiveQuery = Boolean(
    searchQuery || filters.clientId || filters.projectId || filters.folderId || filters.tagIds.length
  );
  const errorMessage = getRecordingsErrorMessage(errorCode);
  const clientGroups = groupRecordingsByClient(recordings, organizationOptions);
  const filterKey = JSON.stringify([searchQuery, filters.clientId, filters.projectId, filters.folderId, filters.tagIds]);
  const statusRecords = searchQuery && searchPage ? searchPage.results : recordings;
  const statusTotal = statusRecords.length;

  return (
    <Panel className="recordings-inbox" aria-label="Správa nahrávek">
      <div className="recordings-inbox-header">
        <div>
          <h1>Nahrávky</h1>
          <p>Najděte uložený hovor, zkontrolujte jeho stav a pokračujte do přepisu.</p>
        </div>
        <Link className="recordings-header-new" href="/recordings/new">
          <Plus aria-hidden="true" size={16} />
          Nová nahrávka
        </Link>
      </div>
      {errorMessage ? <p className="recordings-alert" role="alert">{errorMessage}</p> : null}
      <Disclosure
        className="recordings-management-disclosure"
        keepMounted
        label="Správa organizace"
        triggerLabel="Spravovat"
      >
        <OrganizationManager actions={organizationActions} options={organizationOptions} />
      </Disclosure>
      <LiveRecordingRecoveryPanel />
      <RecordingFilters
        filters={filters}
        key={filterKey}
        options={organizationOptions}
        searchQuery={searchQuery}
      />
      {hasActiveQuery && (!searchQuery || !searchPage) ? (
        <p className="recordings-search-status">
          Filtrovaný výsledek: {formatRecordingResultCount(recordings.length)}.
        </p>
      ) : null}
      {!searchError ? <RecordingStatusSummary records={statusRecords} total={statusTotal} /> : null}
      {searchQuery && searchPage ? (
        <RecordingSearchResults
          error={searchError}
          nextHref={searchNextHref}
          options={organizationOptions}
          page={searchPage}
          previousHref={searchPreviousHref}
          searchQuery={searchQuery}
        />
      ) : (
        <div className="recordings-table">
          {recordings.length > 0 ? (
            <>
              <div className="recordings-table-head" aria-hidden="true">
                <span>Název</span>
                <span>Stav</span>
                <span>Velikost</span>
                <span>Akce</span>
              </div>
              {clientGroups.map((group) => (
                <section className="recording-client-group" key={group.clientId ?? "unclassified"}>
                  <h2>{group.label}<span>{group.recordings.length}</span></h2>
                  {group.recordings.map((recording) => {
                    const organizationMeta = getRecordingOrganizationMeta(recording, organizationOptions);

                    return (
                      <article
                        className="recordings-row"
                        data-recording-id={recording.id}
                        key={recording.id}
                      >
                        <div className="recordings-row-main">
                          <div className="recordings-row-title">
                            <Link
                              aria-label={`Detail nahrávky ${recording.title}`}
                              data-touch-target="action"
                              href={`/recordings/${recording.id}`}
                            >
                              <strong>{recording.title}</strong>
                            </Link>
                            <span>
                              {formatRecordingDate(recording.created_at)} · {getSourceTypeLabel(recording.source_type)}
                              {organizationMeta ? ` · ${organizationMeta}` : ""}
                            </span>
                          </div>
                          <StatusBadge tone={getStatusTone(recording.status)}>{getStatusLabel(recording.status)}</StatusBadge>
                          <span className="recordings-row-size">{formatFileSize(recording.file_size_bytes)}</span>
                        </div>
                        <div
                          className="recordings-row-actions"
                          aria-label={`Akce nahrávky ${recording.title}`}
                          role="group"
                        >
                          <RecordingTitleEditor recordingId={recording.id} title={recording.title} />
                          <DeleteRecordingForm recordingId={recording.id} />
                        </div>
                      </article>
                    );
                  })}
                </section>
              ))}
            </>
          ) : (
            <EmptyState
              action={hasActiveQuery
                ? <Link href="/recordings">Vyčistit hledání a filtry</Link>
                : <Link href="/recordings/new">Nová nahrávka</Link>}
              description={hasActiveQuery
                ? "Upravte hledání nebo začněte znovu bez aktivních filtrů."
                : "První položka se objeví po live nahrávání nebo uploadu souboru."}
              title={hasActiveQuery ? "Žádné odpovídající nahrávky" : "Zatím žádné nahrávky"}
            />
          )}
        </div>
      )}
    </Panel>
  );
}
