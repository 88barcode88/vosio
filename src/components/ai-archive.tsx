"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ChevronRight, SlidersHorizontal } from "lucide-react";
import { DeleteAiOutputForm } from "@/components/delete-ai-output-form";
import { getAiOutputPreview, getAiOutputTitle } from "@/components/workspace/utils";
import {
  AI_ARCHIVE_PROCESSING_TYPES,
  filterAiArchiveItems,
  type AiArchiveFilters
} from "@/lib/ai/archive";
import type { AiArchiveItem } from "@/lib/ai/types";
import { formatRecordingDate } from "@/lib/recordings/types";

const processingTypeLabels = new Map<string, string>([
  ["summary", "Shrnutí"],
  ["action_items", "Úkoly"],
  ["meeting_minutes", "Zápis ze schůzky"],
  ["timeline_chapters", "Časová osa"],
  ["structured_extraction", "Strukturovaná extrakce"],
  ["crm_note", "CRM poznámka"],
  ["follow_up_email", "E-mail po hovoru"],
  ["custom_prompt", "Vlastní prompt"]
]);

// AiArchive renders saved whole-generation artifacts with URL-backed filters and recording links.
export function AiArchive({
  actionAlert,
  baseHref = "/ai",
  deleteAction,
  filters,
  items
}: {
  actionAlert?: string | null;
  baseHref?: string;
  deleteAction?: (formData: FormData) => Promise<void>;
  filters: AiArchiveFilters;
  items: AiArchiveItem[];
}) {
  const router = useRouter();
  const filteredItems = filterAiArchiveItems(items, filters);
  const recordings = Array.from(new Map(items.map((item) => [item.recording.id, item.recording])).values())
    .sort((left, right) => left.title.localeCompare(right.title, "cs"));
  const nextPath = buildArchiveHref(baseHref, filters);
  const hasFilters = Boolean(filters.processingType || filters.recordingId);

  // updateFilter pushes one canonical archive state so browser Back/Forward restores the previous result.
  function updateFilter(patch: Partial<AiArchiveFilters>) {
    router.push(buildArchiveHref(baseHref, { ...filters, ...patch }));
  }

  return (
    <section className="ai-archive" data-utility-surface="ai-archive-results" aria-label="Archiv AI výstupů">
      {actionAlert ? <p className="ai-archive-action-alert" role="alert">{actionAlert}</p> : null}
      <div className="ai-archive-filters" aria-label="Filtry AI archivu">
        <SlidersHorizontal aria-hidden="true" size={16} />
        <label>
          Typ výstupu
          <select
            aria-label="Filtrovat podle typu výstupu"
            onChange={(event) => updateFilter({ processingType: event.target.value || null })}
            value={filters.processingType ?? ""}
          >
            <option value="">Všechny typy</option>
            {AI_ARCHIVE_PROCESSING_TYPES.map((type) => (
              <option key={type} value={type}>{processingTypeLabels.get(type) ?? type}</option>
            ))}
          </select>
        </label>
        <label>
          Nahrávka
          <select
            aria-label="Filtrovat podle nahrávky"
            onChange={(event) => updateFilter({ recordingId: event.target.value || null })}
            value={filters.recordingId ?? ""}
          >
            <option value="">Všechny nahrávky</option>
            {recordings.map((recording) => (
              <option key={recording.id} value={recording.id}>{recording.title}</option>
            ))}
          </select>
        </label>
        {hasFilters ? (
          <button onClick={() => router.push(stripArchiveFilters(baseHref))} type="button">Vyčistit filtry</button>
        ) : null}
      </div>

      {filteredItems.length ? (
        <div className="ai-archive-list" aria-live="polite">
          {filteredItems.map((item) => {
            const isTrashed = item.recording.status === "deleted";
            const recordingHref = isTrashed ? "/trash" : `/recordings/${item.recording.id}?tab=ai`;

            return (
              <article className="ai-archive-row" data-ai-output-delete-target key={item.id}>
                <div className="ai-archive-row-icon" aria-hidden="true"><Archive size={16} /></div>
                <div className="ai-archive-row-copy">
                  <div>
                    <strong>{getAiOutputTitle(item.processing_type)}</strong>
                    <time dateTime={item.created_at}>{formatRecordingDate(item.created_at)}</time>
                  </div>
                  <p>{getAiOutputPreview(item)}</p>
                  <Link className="ai-archive-recording-link" data-touch-target="action" href={recordingHref}>
                    <span>{item.recording.title}</span>
                    {isTrashed ? <small>V koši</small> : <ChevronRight aria-hidden="true" size={14} />}
                  </Link>
                </div>
                <DeleteAiOutputForm
                  deleteAction={deleteAction}
                  label={`Smazat celý AI výstup: ${getAiOutputTitle(item.processing_type)}`}
                  next={nextPath}
                  outputId={item.id}
                />
              </article>
            );
          })}
        </div>
      ) : (
        <article className="utility-empty ai-archive-empty">
          <strong>{hasFilters ? "Žádné odpovídající výstupy" : "Archiv je zatím prázdný"}</strong>
          <p>
            {hasFilters
              ? "Změňte filtr nebo zobrazte celý archiv."
              : "AI výstupy vznikají v detailu konkrétní nahrávky a zde se ukládají jako celé generace."}
          </p>
          {hasFilters ? <button onClick={() => router.push(stripArchiveFilters(baseHref))} type="button">Zobrazit vše</button> : null}
        </article>
      )}
    </section>
  );
}

// buildArchiveHref preserves fixture guards while writing canonical type and recording values.
function buildArchiveHref(baseHref: string, filters: AiArchiveFilters) {
  const url = new URL(baseHref, "https://vosio.local");
  url.searchParams.delete("type");
  url.searchParams.delete("recording");
  if (filters.processingType) url.searchParams.set("type", filters.processingType);
  if (filters.recordingId) url.searchParams.set("recording", filters.recordingId);
  return `${url.pathname}${url.search}`;
}

// stripArchiveFilters returns the archive base without discarding development fixture scope.
function stripArchiveFilters(baseHref: string) {
  return buildArchiveHref(baseHref, { processingType: null, recordingId: null });
}
