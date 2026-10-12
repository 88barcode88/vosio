// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingSharingPopover } from "@/components/workspace/recording-sharing-popover";
import { RecordingSharingCheckbox, RecordingSharingSelectionProvider } from "@/components/workspace/recording-sharing-selection";
import { BulkRecordingSharing } from "@/components/workspace/bulk-recording-sharing";
import { CompactPopover } from "@/components/ui/compact-popover";
import { RecordingsManager } from "@/components/workspace/recordings-manager";
import type { OrganizationManagerActions } from "@/components/workspace/organization-manager";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";
import type { RecordingRow } from "@/lib/recordings/types";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), share: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/recording-sharing/bulk", () => ({ bulkShareRecordings: mocks.share }));
vi.mock("@/components/workspace/recording-access-manager", () => ({ RecordingAccessManager: ({ projectId }: { projectId: string | null }) => <p>Access:{projectId ?? "standalone"}</p> }));
vi.mock("@/components/live-recording-recovery-panel", () => ({ LiveRecordingRecoveryPanel: () => null }));
vi.mock("@/components/workspace/recording-filters", () => ({ RecordingFilters: () => <span>Filtry</span> }));
vi.mock("@/components/workspace/organization-manager-drawer", () => ({ OrganizationManagerDrawer: () => <input aria-label="Organization draft" defaultValue="Draft" /> }));
let root: Root;
let container: HTMLDivElement;
const row: RecordingRow = { id: "00000000-0000-4000-8000-000000000001", title: "Test nahrávka", source_type: "upload", status: "completed", created_at: "2026-10-05T10:00:00Z", updated_at: "2026-10-05T10:00:00Z", duration_seconds: null, file_size_bytes: null, mime_type: "audio/webm", client_id: null, folder_id: null, project_id: null, visibility: "private", capabilities: { ...NO_RECORDING_CAPABILITIES, read: true, manageAccess: true } };
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: [{ userId: "00000000-0000-4000-8000-000000000002", email: "recipient@test.invalid", role: "reader" }], error: null });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });

// click settles the production popup and sharing effects after an actual control click.
async function click(selector: string) { await act(async () => { container.querySelector<HTMLElement>(selector)!.click(); for (let i = 0; i < 6; i++) await Promise.resolve(); }); }

// Render the real list owner while server mutations and unrelated UI boundaries remain inert.
async function renderInbox(recordings: RecordingRow[]) {
  await act(async () => root.render(<RecordingsManager recordings={recordings} errorCode={null}
    filters={{ clientId: null, folderId: null, projectId: null, tagIds: [] }}
    organizationActions={{} as OrganizationManagerActions} organizationOptions={{ clients: [], projects: [], folders: [], tags: [] }}
    searchQuery="" recordingsSearchParams="" />));
}

describe("compact sharing interactions", () => {
  it("keeps a pending popup open for Escape, outside click and close-button attempts", async () => {
    await act(async () => root.render(<CompactPopover label="Test" trigger="Otevřít"><input aria-label="Draft" defaultValue="Rozepsáno" /></CompactPopover>));
    await click("summary");
    await act(async () => root.render(<CompactPopover busy label="Test" trigger="Otevřít"><input aria-label="Draft" defaultValue="Rozepsáno" /></CompactPopover>));
    await act(async () => {
      container.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      container.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(container.querySelector("[role='dialog']")).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("Rozepsáno");
  });
  it.each([null, "project"])("mounts management only after opening and preserves project-private boundary (%s)", async (projectId) => {
    await act(async () => root.render(<RecordingSharingPopover recording={{ ...row, project_id: projectId }} />));
    expect(container.textContent).not.toContain("Access:"); expect(mocks.rpc).not.toHaveBeenCalled();
    await click("summary");
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Sdílení a přístup");
    expect(container.textContent?.includes("Access:standalone")).toBe(projectId === null);
    expect(container.textContent).toContain("Změnit viditelnost");
    await click(".compact-popover-header button");
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });
  it("shares actual selected rows and retains the exact uncertain attempt through close and retry", async () => {
    const rows = [row];
    await act(async () => root.render(<RecordingSharingSelectionProvider recordings={rows}><RecordingSharingCheckbox recordingId={row.id} title={row.title} /><BulkRecordingSharing recordings={rows} /></RecordingSharingSelectionProvider>));
    expect(container.querySelector<HTMLDivElement>(".recording-selection-toolbar")?.hidden).toBe(true);
    await click(".recording-sharing-checkbox input");
    expect(container.querySelector<HTMLDivElement>(".recording-selection-toolbar")?.hidden).toBe(false);
    await click(".compact-popover > summary"); await click("fieldset input");
    mocks.share.mockRejectedValueOnce(new Error("Nejistý transport"));
    await click(".bulk-recording-sharing-form > button");
    expect(container.textContent).toContain("Zopakovat stejné sdílení");
    expect(container.querySelector<HTMLInputElement>(".recording-sharing-checkbox input")?.disabled).toBe(true);
    const first = mocks.share.mock.calls[0][1];
    expect(first.recordingIds).toEqual([row.id]);
    await click(".compact-popover-header button"); await click(".compact-popover > summary");
    mocks.share.mockResolvedValueOnce(undefined); await click(".bulk-recording-sharing-form > button");
    expect(mocks.share.mock.calls[1][1]).toEqual(first); expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLInputElement>(".recording-sharing-checkbox input")?.checked).toBe(false);
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(container.querySelector(".recording-sharing-result")?.textContent).toContain("Celý výběr byl sdílen");
  });
  it("retains exact uncertain attempt and sibling draft across insertion, filtered results, no grants and empty results", async () => {
    const other = { ...row, id: "00000000-0000-4000-8000-000000000003", title: "Jiná nahrávka" };
    await renderInbox([row]);
    const draft = container.querySelector<HTMLInputElement>("[aria-label='Organization draft']")!;
    draft.value = "Rozepsaná organizace";
    await click(".recording-sharing-checkbox input"); await click(".compact-popover > summary"); await click("fieldset input");
    mocks.share.mockRejectedValueOnce(new Error("Nejistý transport"));
    await click(".bulk-recording-sharing-form > button");
    const original = structuredClone(mocks.share.mock.calls[0][1]);
    const readsBeforeFiltering = mocks.rpc.mock.calls.length;
    for (const nextRows of [[row, other], [other], [{ ...other, capabilities: NO_RECORDING_CAPABILITIES }], [], [row]]) {
      await renderInbox(nextRows);
      expect(container.querySelector<HTMLInputElement>("[aria-label='Organization draft']")?.value).toBe("Rozepsaná organizace");
      expect(container.querySelector(".recording-selection-toolbar")?.textContent).toContain("Vybráno 1");
      expect(container.querySelector(".bulk-recording-sharing-form > button")?.textContent).toBe("Zopakovat stejné sdílení");
      expect(container.querySelector<HTMLInputElement>("fieldset input")?.checked).toBe(true);
      expect(mocks.rpc).toHaveBeenCalledTimes(readsBeforeFiltering);
      for (const checkbox of container.querySelectorAll<HTMLInputElement>(".recording-sharing-checkbox input")) expect(checkbox.disabled).toBe(true);
    }
    mocks.share.mockResolvedValueOnce(undefined); await click(".bulk-recording-sharing-form > button");
    expect(mocks.share.mock.calls[1][1]).toEqual(original);
    expect(mocks.share).toHaveBeenCalledTimes(2);
  });
  it("prunes idle selection separately and never selects rows without current manage grants", async () => {
    await renderInbox([row]); await click(".recording-sharing-checkbox input");
    await renderInbox([]); await renderInbox([row]);
    expect(container.querySelector<HTMLInputElement>(".recording-sharing-checkbox input")?.checked).toBe(false);
    await renderInbox([{ ...row, capabilities: NO_RECORDING_CAPABILITIES }]);
    expect(container.querySelector(".recording-sharing-checkbox")).toBeNull();
    expect(container.querySelector<HTMLDivElement>(".recording-selection-toolbar")?.hidden).toBe(true);
  });
});
