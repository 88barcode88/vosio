import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RecordingsManager } from "@/components/workspace/recordings-manager";

vi.mock("@/components/live-recording-recovery-panel", () => ({
  LiveRecordingRecoveryPanel: () => null
}));
vi.mock("@/components/workspace/organization-manager", () => ({
  OrganizationManager: () => null
}));
vi.mock("@/components/workspace/recording-filters", () => ({
  RecordingFilters: () => null
}));
vi.mock("@/components/delete-recording-form", () => ({ DeleteRecordingForm: () => null }));
vi.mock("@/components/workspace/recording-title-editor", () => ({
  RecordingTitleEditor: () => null
}));

const organizationTimestamp = "2026-08-05T09:00:00.000Z";
const organizationBase = {
  color: null,
  created_at: organizationTimestamp,
  updated_at: organizationTimestamp,
  user_id: "user-1"
};
const organizationOptions = {
  clients: [{ ...organizationBase, id: "client-1", name: "Acme" }],
  folders: [{ ...organizationBase, id: "folder-1", name: "Calls" }],
  projects: [{
    ...organizationBase,
    client_id: "client-1",
    id: "project-1",
    name: "CRM"
  }],
  tags: []
};
const filters = { clientId: "client-1", folderId: null, projectId: null, tagIds: [] };

describe("recordings indexed search UI", () => {
  it("keeps the compact inbox hierarchy in the lane-local Appica stylesheet", () => {
    const styles = readFileSync(
      join(process.cwd(), "app", "styles", "appica-recordings.css"),
      "utf8"
    );

    expect(styles).toMatch(/\.recordings-inbox\s*\{[\s\S]*?container-type:\s*inline-size;/u);
    expect(styles).toMatch(/\.recordings-inbox\.ui-panel\s*\{[\s\S]*?background:\s*var\(--surface-raised\);/u);
    expect(styles).toMatch(/\.recordings-toolbar\s*\{[\s\S]*?display:\s*grid;/u);
    expect(styles).toMatch(/\.recordings-table\s*\{[\s\S]*?border:\s*1px solid\s+var\(--border\);/u);
    expect(styles).toMatch(/\.recordings-inbox \.recordings-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) var\(--recordings-action-width\);/u);
    expect(styles).toContain("@container recordings-inbox (max-width: 680px)");
  });

  it("treats a status-only empty result as a filtered result with a clear link", () => {
    const markup = renderToStaticMarkup(createElement(RecordingsManager, {
      errorCode: null,
      filters: { clientId: null, folderId: null, projectId: null, tagIds: [] },
      organizationOptions,
      recordingStatus: "failed" as const,
      recordingStatusCounts: {
        completed: 0,
        created: 0,
        deleted: 0,
        failed: 0,
        transcribing: 0,
        uploaded: 0,
        uploading: 0
      },
      recordings: [],
      recordingsSearchParams: "status=failed",
      searchQuery: ""
    }));

    expect(markup).toContain("Žádné odpovídající nahrávky");
    expect(markup).toContain('href="/recordings">Vyčistit hledání a filtry</a>');
    expect(markup).not.toContain("Zatím žádné nahrávky");
    expect(markup).not.toContain('href="/recordings/new">Nová nahrávka</a>');
  });

  it("keeps every interactive status chip at least 44px tall", () => {
    const styles = readFileSync(
      join(process.cwd(), "app", "styles", "documentation-recordings.css"),
      "utf8"
    );

    expect(styles).toMatch(/\.recordings-status-summary a\s*\{[^}]*?min-height:\s*44px;/u);
  });

  it("keeps the organization management trigger explicitly 44px tall", () => {
    const styles = readFileSync(
      join(process.cwd(), "app", "styles", "documentation-recordings.css"),
      "utf8"
    );

    expect(styles).toMatch(/\.recordings-toolbar > \.organization-manager-trigger\s*\{[^}]*?min-height:\s*44px;/u);
  });

  it("reserves input space for the recording search icon", () => {
    const styles = readFileSync(
      join(process.cwd(), "app", "styles", "documentation-recordings.css"),
      "utf8"
    );

    expect(styles).toMatch(/\.recording-filter-search\s*\{[^}]*?position:\s*relative;/u);
    expect(styles).toMatch(/\.recording-filter-search-icon\s*\{[^}]*?position:\s*absolute;/u);
    expect(styles).toMatch(/\.recording-filter-search input\s*\{[^}]*?padding-left:\s*36px;/u);
  });

  it("keeps the flat recordings table aligned through shared column contracts", () => {
    const styles = readFileSync(
      join(process.cwd(), "app", "styles", "documentation-recordings.css"),
      "utf8"
    );
    const inboxRule = styles.match(/\.recordings-inbox\s*\{([^}]*)\}/u)?.[1] ?? "";
    const actionWidth = Number(
      inboxRule.match(/--recordings-action-width:\s*(\d+)px;/u)?.[1] ?? "0"
    );

    expect(actionWidth).toBeGreaterThanOrEqual(116);
    expect(inboxRule).toContain(
      "--recordings-main-columns: minmax(180px, 1fr) 112px 84px;"
    );
    expect(inboxRule).toContain(
      "--recordings-columns: minmax(0, 1fr) var(--recordings-action-width);"
    );
    expect(inboxRule).toContain("--recordings-column-gap: 14px;");
    expect(inboxRule).toContain("--recordings-cell-padding: 7px 10px;");
    expect(styles).toMatch(
      /\.recordings-inbox\.ui-panel\s*\{[^}]*?background:\s*var\(--surface-raised\);/u
    );
    expect(styles).toMatch(
      /\.recordings-inbox \.recordings-table-head,\s*\.recordings-inbox \.recordings-row\s*\{[^}]*?grid-template-columns:\s*var\(--recordings-columns\);[^}]*?gap:\s*0;/u
    );
    expect(styles).toMatch(
      /\.recordings-inbox \.recordings-table-head-main,\s*\.recordings-inbox \.recordings-row-main\s*\{[^}]*?grid-template-columns:\s*var\(--recordings-main-columns\);[^}]*?gap:\s*var\(--recordings-column-gap\);[^}]*?padding:\s*var\(--recordings-cell-padding\);/u
    );
    expect(styles).toMatch(
      /\.recordings-inbox \.recordings-row\s*\{[^}]*?border-radius:\s*0;/u
    );
    expect(styles).toMatch(
      /\.recordings-inbox \.recordings-row-actions \.delete-recording-icon\s*\{[^}]*?border:\s*0;/u
    );
  });

  it("keeps toolbar stacking viewport-based and card layout container-based", () => {
    const styles = readFileSync(
      join(process.cwd(), "app", "styles", "responsive.css"),
      "utf8"
    );
    const mobileMediaStart = styles.indexOf("@media (max-width: 900px)");
    const toolbarStackStart = styles.indexOf(".recordings-toolbar {", mobileMediaStart);
    const cardContainerStart = styles.indexOf("@container recordings-inbox (max-width: 680px)");
    const hiddenHeaderRules = [...styles.matchAll(/\.recordings-table-head\s*\{\s*display:\s*none;/gu)];

    expect(mobileMediaStart).toBeGreaterThanOrEqual(0);
    expect(toolbarStackStart).toBeGreaterThan(mobileMediaStart);
    expect(toolbarStackStart).toBeLessThan(cardContainerStart);
    expect(hiddenHeaderRules).toHaveLength(1);
    expect(hiddenHeaderRules[0]?.index).toBeGreaterThan(cardContainerStart);
  });

  it("keeps indexed search results flat until the inbox container becomes narrow", () => {
    const styles = readFileSync(
      join(process.cwd(), "app", "styles", "documentation-recordings.css"),
      "utf8"
    );
    const responsiveStyles = readFileSync(
      join(process.cwd(), "app", "styles", "responsive.css"),
      "utf8"
    );
    const cardContainerStart = responsiveStyles.indexOf(
      "@container recordings-inbox (max-width: 680px)"
    );
    const cardContainerEnd = responsiveStyles.indexOf("@media (max-width: 760px)", cardContainerStart);
    const cardContainer = responsiveStyles.slice(cardContainerStart, cardContainerEnd);

    expect(styles).toMatch(
      /\.recording-search-result-list\s*\{[^}]*?gap:\s*0;[^}]*?border:\s*1px solid var\(--border\);[^}]*?border-radius:\s*6px;[^}]*?background:\s*var\(--surface-raised\);/u
    );
    expect(styles).toMatch(
      /\.recording-search-result\s*\{[^}]*?grid-template-columns:\s*minmax\(0, 1fr\) var\(--recordings-action-width\);[^}]*?border:\s*0;[^}]*?border-bottom:\s*1px solid var\(--border\);[^}]*?border-radius:\s*0;[^}]*?background:\s*var\(--surface-raised\);/u
    );
    expect(styles).toMatch(
      /\.recording-search-result:last-child\s*\{[^}]*?border-bottom:\s*0;/u
    );
    expect(cardContainer).toMatch(
      /\.recording-search-result-list\s*\{[^}]*?gap:\s*10px;[^}]*?border:\s*0;[^}]*?background:\s*transparent;/u
    );
    expect(cardContainer).toMatch(
      /\.recording-search-result\s*\{[^}]*?grid-template-columns:\s*minmax\(0, 1fr\);[^}]*?border:\s*1px solid var\(--border\);[^}]*?border-radius:\s*10px;/u
    );
    expect(cardContainer).toMatch(
      /\.recordings-inbox \.recording-search-result:last-child\s*\{[^}]*?border-bottom:\s*1px solid var\(--border\);/u
    );
  });

  it("renders flat ranked results, safe excerpts, metadata and accessible pagination", () => {
    const markup = renderToStaticMarkup(createElement(RecordingsManager, {
      errorCode: null,
      filters,
      organizationOptions,
      recordings: [],
      searchNextHref: "/recordings?q=Lucern&client=client-1&page=3",
      searchPage: {
        page: 2,
        pageSize: 25,
        results: [{
          clientId: "client-1",
          createdAt: "2026-08-05T10:00:00.000Z",
          durationSeconds: 65,
          fileSizeBytes: 2048,
          folderId: "folder-1",
          id: "recording-1",
          matchedExcerpt: "Řešíme [[H]]Lucern[[/H]] CRM.",
          matchEndMs: 4200,
          matchStartMs: 1200,
          mimeType: "audio/webm",
          projectId: "project-1",
          sourceType: "upload" as const,
          status: "completed" as const,
          title: "Lucern CRM call",
          updatedAt: "2026-08-05T10:05:00.000Z"
        }],
        totalCount: 51
      },
      searchPreviousHref: "/recordings?q=Lucern&client=client-1",
      searchQuery: "Lucern"
    }));

    expect(markup).toContain('aria-label="Výsledky hledání v nahrávkách"');
    expect(markup).toContain('role="list"');
    expect(markup).toContain('role="listitem"');
    expect(markup).toContain('class="recordings-status-summary" aria-label="Filtrovat podle stavu"');
    expect(markup).toContain('class="recordings-row-actions" aria-label="Akce nahrávky Lucern CRM call" role="group"');
    expect(markup).toContain("Nalezeno 51 nahrávek. Strana 2 z 3.");
    expect(markup).toContain('aria-current="page" href="/recordings">Celkem <strong>1</strong>');
    expect(markup).toContain('href="/recordings?status=completed">Dokončeno <strong>1</strong>');
    expect(markup).toContain("Acme · CRM · Calls");
    expect(markup).toContain("<mark>Lucern</mark>");
    expect(markup).toContain(
      "/recordings/recording-1?tab=transcript&amp;at=1200&amp;highlight=Lucern"
    );
    expect(markup).toContain('aria-label="Stránkování výsledků hledání"');
    expect(markup).not.toContain("recording-client-group");
    expect(markup).not.toContain("recordings-table-head");
  });

  it("renders a sanitized search failure as an alert and no misleading empty group", () => {
    const markup = renderToStaticMarkup(createElement(RecordingsManager, {
      errorCode: null,
      filters,
      organizationOptions,
      recordings: [],
      searchError: "Hledání se nepodařilo načíst. Zkuste to znovu.",
      searchPage: { page: 1, pageSize: 25, results: [], totalCount: 0 },
      searchQuery: "Lucern"
    }));

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Hledání se nepodařilo načíst.");
    expect(markup).not.toContain("recording-client-group");
  });
});
