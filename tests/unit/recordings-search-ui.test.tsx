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
    expect(markup).toContain('class="recordings-status-summary" aria-label="Stavy nahrávek" role="group"');
    expect(markup).toContain('class="recordings-row-actions" aria-label="Akce nahrávky Lucern CRM call" role="group"');
    expect(markup).toContain("Nalezeno 51 nahrávek. Strana 2 z 3.");
    expect(markup).toContain('<span class="recordings-status-total"><strong>1</strong> celkem</span>');
    expect(markup).toContain('<span class="recordings-status-segment">Dokončeno <strong>1</strong></span>');
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
