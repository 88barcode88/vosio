"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
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
  const committedQueryString = currentSearchParams.toString();
  const committedLocation = committedQueryString ? `${pathname}?${committedQueryString}` : pathname;
  const projects = options.projects.filter((project) => project.client_id === clientId);
  const hasFilters = Boolean(filters.clientId || filters.projectId || filters.folderId || filters.tagIds.length);
  const hasDraftFilters = Boolean(clientId || projectId || folderId || tagIds.size);
  const isNavigationPending = isPending;

  // The committed URL settles the tracked target without relying on a component remount.
  useEffect(() => {
    if (navigationTarget === committedLocation) setNavigationTarget(null);
  }, [committedLocation, navigationTarget]);

  // navigate applies one canonical filter snapshot while retaining unrelated URL parameters.
  function navigate(nextFilters: RecordingOrganizationFilters, nextQuery: string) {
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
    if (target === committedLocation) return;
    setNavigationTarget(target);
    startTransition(async () => {
      await router.push(target);
    });
  }

  // currentDraft returns all controlled organization values in URL order.
  function currentDraft(): RecordingOrganizationFilters {
    return {
      clientId: clientId || null,
      folderId: folderId || null,
      projectId: projectId || null,
      tagIds: Array.from(tagIds)
    };
  }

  // toggleTag updates the repeatable URL filter without mutating prior state.
  function toggleTag(tagId: string) {
    setTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  // clearFilters resets the controlled draft and removes only organization parameters from the URL.
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
      onSubmit={(event) => {
        event.preventDefault();
        if (!isNavigationPending) navigate(currentDraft(), query);
      }}
    >
      <div className="recording-filter-grid">
        <label className="recording-filter-search">
          <span>Hledat</span>
          <input
            disabled={isNavigationPending}
            maxLength={120}
            name="q"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Název, přepis, klient, projekt, složka nebo štítek"
            type="search"
            value={query}
          />
        </label>
        <label>
          <span>Klient</span>
          <select
            disabled={isNavigationPending}
            name="client"
            onChange={(event) => {
              const nextClientId = event.target.value;
              setClientId(nextClientId);
              if (!options.projects.some((project) =>
                project.id === projectId && project.client_id === nextClientId
              )) setProjectId("");
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
            onChange={(event) => setProjectId(event.target.value)}
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
            onChange={(event) => setFolderId(event.target.value)}
            value={folderId}
          >
            <option value="">Všechny složky</option>
            {options.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
      </div>
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
        <button disabled={isNavigationPending} type="submit">
          {isNavigationPending ? "Načítám…" : "Použít filtry"}
        </button>
        <button
          disabled={isNavigationPending || (!hasFilters && !hasDraftFilters)}
          onClick={clearFilters}
          type="button"
        >
          Vyčistit filtry
        </button>
        {searchQuery ? (
          <button disabled={isNavigationPending} onClick={() => navigate(currentDraft(), "")} type="button">
            Vyčistit hledání
          </button>
        ) : null}
      </div>
      <span aria-live="polite" className="visually-hidden">
        {isNavigationPending ? "Aktualizuji seznam nahrávek." : ""}
      </span>
    </form>
  );
}
