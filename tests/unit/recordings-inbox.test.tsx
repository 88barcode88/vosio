// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingsManager } from "@/components/workspace/recordings-manager";
import { createSaveError, type SaveAction, type SaveActionState } from "@/lib/forms/save-action-state";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";
import type { RecordingStatusCounts } from "@/lib/recordings/queries";
import type { ActiveRecordingStatus, RecordingRow, RecordingStatus } from "@/lib/recordings/types";

vi.mock("@/components/live-recording-recovery-panel", () => ({
  LiveRecordingRecoveryPanel: () => null
}));
vi.mock("@/components/workspace/recording-filters", () => ({
  RecordingFilters: () => <div data-testid="real-filter-slot">Filtry</div>
}));
vi.mock("@/components/delete-recording-form", () => ({
  DeleteRecordingForm: ({ recordingId }: { recordingId: string }) => (
    <button aria-label={`Smazat ${recordingId}`} type="button">Smazat</button>
  )
}));
vi.mock("@/components/workspace/recording-title-editor", () => ({
  RecordingTitleEditor: ({ recordingId }: { recordingId: string }) => (
    <button aria-label={`Upravit ${recordingId}`} type="button">Upravit</button>
  )
}));

const timestamp = "2026-08-09T10:00:00.000Z";
const clientA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationBase = {
  color: null,
  created_at: timestamp,
  updated_at: timestamp,
  user_id: "user-1"
};
const organizationOptions: RecordingOrganizationOptions = {
  clients: [{ ...organizationBase, id: clientA, name: "Acme" }],
  folders: [],
  projects: [],
  tags: []
};
const idleAction = vi.fn(async (state) => state) as SaveAction;
const organizationActions = {
  createClient: idleAction,
  createFolder: idleAction,
  createProject: idleAction,
  createTag: idleAction,
  deleteClient: idleAction,
  deleteFolder: idleAction,
  deleteProject: idleAction,
  deleteTag: idleAction,
  renameClient: idleAction,
  renameFolder: idleAction,
  renameProject: idleAction,
  renameTag: idleAction
};

// createRecording supplies one real inbox row without inventing fields outside RecordingRow.
function createRecording(id: string, status: RecordingStatus, clientId: string | null): RecordingRow {
  return {
    client_id: clientId,
    created_at: timestamp,
    duration_seconds: 65,
    error_message: null,
    file_size_bytes: 2048,
    folder_id: null,
    id,
    mime_type: "audio/webm",
    project_id: null,
    source_type: "upload",
    status,
    storage_path: null,
    title: `Nahrávka ${id}`,
    updated_at: timestamp,
    user_id: "user-1"
  };
}

let container: HTMLDivElement;
let root: Root;

// renderInbox mounts the actual manager while external recovery and server actions stay inert.
async function renderInbox(
  recordings: RecordingRow[] = [],
  actions = organizationActions,
  statusOptions: {
    activeStatus?: ActiveRecordingStatus | null;
    counts?: RecordingStatusCounts;
    searchParams?: string;
  } = {}
) {
  await act(async () => {
    root.render(
      <RecordingsManager
        errorCode={null}
        filters={{ clientId: null, folderId: null, projectId: null, tagIds: [] }}
        organizationActions={actions}
        organizationOptions={organizationOptions}
        recordingStatus={statusOptions.activeStatus ?? null}
        recordingStatusCounts={statusOptions.counts}
        recordings={recordings}
        recordingsSearchParams={statusOptions.searchParams ?? ""}
        searchQuery=""
      />
    );
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("recordings inbox", () => {
  it("keeps organization editors mounted and their draft when Spravovat closes", async () => {
    await renderInbox();

    const trigger = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Spravovat"
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    const management = container.querySelector<HTMLElement>(
      '[aria-label="Správa organizace"]'
    );
    expect(container.querySelector('[role="dialog"][aria-label="Správa organizace"]')).toBeNull();
    expect(management?.hidden).toBe(true);

    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="dialog"][aria-label="Správa organizace"]')).not.toBeNull();
    expect(management?.hidden).toBe(false);
    expect(Array.from(management?.querySelectorAll("h3") ?? []).map((heading) => heading.textContent))
      .toEqual(["Klienti", "Projekty", "Složky", "Štítky"]);

    const createClient = Array.from(management?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent === "Přidat klienta"
    );
    await act(async () => createClient?.click());
    const draft = management?.querySelector<HTMLInputElement>('input[name="name"]');
    expect(draft).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(draft, "Rozpracovaný klient");
      draft?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const close = container.querySelector<HTMLButtonElement>('[aria-label="Zavřít správu organizace"]');
    await act(async () => close?.click());
    expect(management?.hidden).toBe(true);
    expect(management?.querySelector<HTMLInputElement>('input[name="name"]')?.value)
      .toBe("Rozpracovaný klient");
    await act(async () => trigger?.click());
    expect(management?.querySelector<HTMLInputElement>('input[name="name"]')?.value)
      .toBe("Rozpracovaný klient");
  });

  it("settles a pending organization save while Spravovat is hidden without losing its error draft", async () => {
    let settle!: (state: SaveActionState) => void;
    const pendingActionMock = vi.fn(
      (_previousState: SaveActionState, _formData: FormData) =>
        new Promise<SaveActionState>((resolve) => {
          settle = resolve;
        })
    );
    const pendingAction = pendingActionMock as SaveAction;
    await renderInbox([], { ...organizationActions, createClient: pendingAction });
    const trigger = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Spravovat"
    );
    await act(async () => trigger?.click());
    const management = container.querySelector<HTMLElement>(
      '.ui-drawer-backdrop[aria-label="Správa organizace"]'
    );
    const createClient = Array.from(management?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent === "Přidat klienta"
    );
    await act(async () => createClient?.click());
    const draft = management?.querySelector<HTMLInputElement>('input[name="name"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(draft, "Klient během ukládání");
      draft?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = management?.querySelector<HTMLFormElement>("form.organization-create-form");
    await act(async () => {
      form?.requestSubmit();
      await Promise.resolve();
    });
    expect(pendingActionMock).toHaveBeenCalledOnce();
    expect(Array.from(management?.querySelectorAll("button") ?? []).some((button) =>
      button.textContent === "Ukládám…" && button.disabled
    )).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Zavřít správu organizace"]')?.click();
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    expect(management?.hidden).toBe(true);
    expect(management?.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(trigger);
    for (const control of Array.from(management?.querySelectorAll("button, input, select") ?? [])) {
      expect(control.closest("[hidden]")).toBe(management);
    }

    const formData = pendingActionMock.mock.calls[0]?.[1] as FormData;
    const scopeKey = String(formData.get("scopeKey"));
    await act(async () => {
      settle(createSaveError(0, scopeKey, "Uložení klienta selhalo."));
      await Promise.resolve();
    });
    expect(management?.hidden).toBe(true);

    await act(async () => trigger?.click());
    expect(management?.hidden).toBe(false);
    expect(management?.querySelector<HTMLInputElement>('input[name="name"]')?.value)
      .toBe("Klient během ukládání");
    expect(management?.querySelector('[role="alert"]')?.textContent)
      .toContain("Uložení klienta selhalo.");
    expect(Array.from(management?.querySelectorAll("button") ?? []).some((button) =>
      button.textContent === "Ukládám…"
    )).toBe(false);
  });

  it("renders URL-backed status facets and keeps title, edit and delete as sibling actions", async () => {
    const recording = createRecording("recording-1", "failed", clientA);
    recording.title = "Testovací hovor";
    await renderInbox([recording], organizationActions, {
      activeStatus: "failed",
      counts: {
        completed: 5,
        created: 1,
        deleted: 2,
        failed: 3,
        transcribing: 4,
        uploaded: 6,
        uploading: 7
      },
      searchParams: "status=failed"
    });

    expect(container.querySelector('a[href="/recordings?status=failed"]')?.textContent)
      .toContain("Chyba 3");
    expect(container.querySelector('a[aria-current="page"]')?.getAttribute("href"))
      .toBe("/recordings?status=failed");
    expect(container.querySelector('a[href="/trash"]')?.textContent).toContain("Smazáno 2");
    expect(container.querySelector(".recordings-header-new")).toBeNull();
    expect(container.querySelector('a[aria-label="Detail nahrávky Testovací hovor"]'))
      .not.toBeNull();

    const firstRow = container.querySelector<HTMLElement>('[data-recording-id="recording-1"]');
    const titleLink = firstRow?.querySelector<HTMLAnchorElement>('a[href="/recordings/recording-1"]');
    expect(titleLink?.textContent).toContain("Testovací hovor");
    expect(firstRow?.querySelectorAll('a[href="/recordings/recording-1"]')).toHaveLength(1);
    expect(firstRow?.textContent).not.toContain("Otevřít");
    expect(firstRow?.querySelector('[aria-label="Upravit recording-1"]')?.closest("a")).toBeNull();
    expect(firstRow?.querySelector('[aria-label="Smazat recording-1"]')?.closest("a")).toBeNull();
    expect(firstRow?.querySelector(".recordings-row-actions")?.getAttribute("role"))
      .toBe("group");

    const groupLabels = Array.from(container.querySelectorAll(".recording-client-group > h2"))
      .map((heading) => heading.firstChild?.textContent?.trim());
    expect(groupLabels).toEqual(["Acme"]);
  });
});
