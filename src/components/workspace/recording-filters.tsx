"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Disclosure } from "@/components/ui/disclosure";
import {
  buildRecordingFilterSearchParams,
  type RecordingOrganizationFilters
} from "@/lib/recording-organization/filters";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";
import { normalizeRecordingSearchQuery } from "@/lib/recordings/search";

type RecordingFiltersProps = {
  filters: RecordingOrganizationFilters;
  options: RecordingOrganizationOptions;
  searchQuery: string;
};

// RecordingFilters owns one URL-backed search and organization filter draft.
export function RecordingFilters({ filters, options, searchQuery }: RecordingFiltersProps) {
  const pathname = usePathname();
  const router = useRouter();
  const currentSearchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [navigationTarget, setNavigationTarget] = useState<string | null>(null);
  const [query, setQuery] = useState(searchQuery);
  const [clientId, setClientId] = useState(filters.clientId ?? "");
  const [projectId, setProjectId] = useState(filters.projectId ?? "");
  const [folderId, setFolderId] = useState(filters.folderId ?? "");
  const [tagIds, setTagIds] = useState(() => new Set(filters.tagIds));
  const previousCommittedLocationRef = useRef<string | null>(null);
  const committedQueryString = currentSearchParams.toString();
  const committedLocation = committedQueryString ? `${pathname}?${committedQueryString}` : pathname;
  const projects = options.projects.filter((project) => project.client_id === clientId);
  const hasFilters = Boolean(filters.clientId || filters.projectId || filters.folderId || filters.tagIds.length);
  const hasDraftFilters = Boolean(clientId || projectId || folderId || tagIds.size);
  const activeAdvancedFilterCount = [clientId, projectId, folderId].filter(Boolean).length + tagIds.size;
  const isNavigationPending = isPending;

  // The committed URL settles the tracked target without relying on a component remount.
  useEffect(() => {
    if (navigationTarget === committedLocation) setNavigationTarget(null);
  }, [committedLocation, navigationTarget]);

  // syncExternalLocation adopts browser history changes without overwriting ordinary local drafts.
  useEffect(() => {
    const previousLocation = previousCommittedLocationRef.current;
    previousCommittedLocationRef.current = committedLocation;
    if (previousLocation === null || previousLocation === committedLocation) return;
    if (navigationTarget === committedLocation) return;

    setQuery(searchQuery);
    setClientId(filters.clientId ?? "");
    setProjectId(filters.projectId ?? "");
    setFolderId(filters.folderId ?? "");
    setTagIds(new Set(filters.tagIds));
  }, [committedLocation, filters.clientId, filters.folderId, filters.projectId, filters.tagIds, navigationTarget, searchQuery]);

  // navigate applies one canonical filter snapshot and skips committed or pending URL targets.
  const navigate = useCallback((
    nextFilters: RecordingOrganizationFilters,
    nextQuery = currentSearchParams.get("q") ?? ""
  ) => {
    const next = buildRecordingFilterSearchParams(
      new URLSearchParams(currentSearchParams.toString()),
      nextFilters
    );
    const normalizedQuery = normalizeRecordingSearchQuery(nextQuery);
    if (normalizedQuery) next.set("q", normalizedQuery);
    else next.delete("q");
    next.delete("page");
    const queryString = next.toString();
    const target = queryString ? `${pathname}?${queryString}` : pathname;
    if (target === committedLocation || target === navigationTarget) return;
    setNavigationTarget(target);
    startTransition(async () => {
      await router.push(target);
    });
  }, [committedLocation, currentSearchParams, navigationTarget, pathname, router]);

  // currentDraft returns all controlled organization values in URL order.
  const currentDraft = useCallback((): RecordingOrganizationFilters => ({
    clientId: clientId || null,
    folderId: folderId || null,
    projectId: projectId || null,
    tagIds: Array.from(tagIds)
  }), [clientId, folderId, projectId, tagIds]);

  // Deferred search navigates only for a cleared query or a useful three-character query.
  useEffect(() => {
    const normalizedQuery = normalizeRecordingSearchQuery(query);
    const committedQuery = normalizeRecordingSearchQuery(currentSearchParams.get("q"));

    if ((normalizedQuery && normalizedQuery.length < 3) || normalizedQuery === committedQuery) return;

    const timeoutId = window.setTimeout(() => {
      navigate(currentDraft(), normalizedQuery);
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [currentDraft, currentSearchParams, navigate, query]);

  // toggleTag updates the repeatable URL filter without mutating prior state.
  function toggleTag(tagId: string) {
    const next = new Set(tagIds);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    setTagIds(next);
    navigate({ ...currentDraft(), tagIds: Array.from(next) }, query);
  }

  // clearFilters resets organization choices while preserving the current search draft.
  function clearFilters() {
    setClientId("");
    setProjectId("");
    setFolderId("");
    setTagIds(new Set());
    if (hasFilters) {
      navigate({ clientId: null, folderId: null, projectId: null, tagIds: [] }, query);
    }
  }

  return (
    <form
      aria-busy={isNavigationPending}
      aria-label="Filtrování nahrávek"
      className="recording-filters"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="recording-filter-basic-row">
        <label className="recording-filter-search">
          <span className="visually-hidden">Hledat v nahrávkách</span>
          <Search aria-hidden="true" className="recording-filter-search-icon" size={16} />
          <input
            aria-label="Hledat v nahrávkách"
            maxLength={120}
            name="q"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Název, přepis nebo zařazení"
            type="search"
            value={query}
          />
        </label>
        <fieldset className="recording-filter-basic-actions" disabled={isNavigationPending}>
          {query ? (
            <button disabled={isNavigationPending} onClick={() => setQuery("")} type="button">
              Vyčistit hledání
            </button>
          ) : null}
          <Disclosure
            className="recording-filter-advanced"
            keepMounted
            label="Pokročilé filtry nahrávek"
            triggerLabel={`Filtry (${activeAdvancedFilterCount})`}
          >
            <div className="recording-filter-grid">
        <label>
          <span>Klient</span>
          <select
            disabled={isNavigationPending}
            name="client"
            onChange={(event) => {
              const nextClientId = event.target.value;
              const nextProjectId = options.projects.some((project) =>
                project.id === projectId && project.client_id === nextClientId
              ) ? projectId : "";
              setClientId(nextClientId);
              setProjectId(nextProjectId);
              navigate({
                ...currentDraft(),
                clientId: nextClientId || null,
                projectId: nextProjectId || null
              }, query);
            }}
            value={clientId}
          >
            <option value="">Všichni klienti</option>
            {options.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <label>
          <span>Projekt</span>
          <select
            disabled={isNavigationPending || !clientId}
            name="project"
            onChange={(event) => {
              const nextProjectId = event.target.value;
              setProjectId(nextProjectId);
              navigate({ ...currentDraft(), projectId: nextProjectId || null }, query);
            }}
            value={projectId}
          >
            <option value="">Všechny projekty</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label>
          <span>Složka</span>
          <select
            disabled={isNavigationPending}
            name="folder"
            onChange={(event) => {
              const nextFolderId = event.target.value;
              setFolderId(nextFolderId);
              navigate({ ...currentDraft(), folderId: nextFolderId || null }, query);
            }}
            value={folderId}
          >
            <option value="">Všechny složky</option>
            {options.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
            </div>
            <div className="recording-filter-tag-row">
        <fieldset className="recording-filter-tags">
          <legend>Štítky <small>Vybrané štítky platí současně</small></legend>
          {options.tags.length > 0 ? options.tags.map((tag) => (
            <label key={tag.id}>
              <input
                checked={tagIds.has(tag.id)}
                disabled={isNavigationPending}
                name="tag"
                onChange={() => toggleTag(tag.id)}
                type="checkbox"
                value={tag.id}
              />
              <span>{tag.name}</span>
            </label>
          )) : <span className="recording-filter-empty">Zatím bez štítků</span>}
        </fieldset>
        <div className="recording-filter-actions">
          <button
            disabled={isNavigationPending || (!hasFilters && !hasDraftFilters)}
            onClick={clearFilters}
            type="button"
          >
            Vyčistit filtry
          </button>
        </div>
            </div>
          </Disclosure>
        </fieldset>
      </div>
      <span aria-live="polite" className="visually-hidden">
        {isNavigationPending ? "Aktualizuji seznam nahrávek." : ""}
      </span>
    </form>
  );
}
