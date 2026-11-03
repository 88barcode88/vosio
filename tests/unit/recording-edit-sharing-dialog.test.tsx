// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingEditSharingDialog } from "@/components/workspace/recording-edit-sharing-dialog";
import { createSaveError, createSaveSuccess } from "@/lib/forms/save-action-state";
import type { RecordingRow } from "@/lib/recordings/types";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), share: vi.fn(), refresh: vi.fn(), title: vi.fn(), organization: vi.fn(), load: vi.fn(), preview: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/recording-sharing/bulk", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/recording-sharing/bulk")>(), bulkShareRecordings: mocks.share }));
vi.mock("@/lib/recordings/actions", () => ({ updateRecordingTitleStateAction: mocks.title }));
vi.mock("@/lib/recording-organization/actions", () => ({ assignRecordingOrganizationAction: mocks.organization, previewRecordingOrganizationAction: mocks.preview }));
vi.mock("@/lib/recording-organization/load-recording-action", () => ({ loadRecordingOrganizationAction: mocks.load }));

const recordingId = "00000000-0000-4000-8000-000000000001";
const recipientA = "00000000-0000-4000-8000-000000000002";
const recipientB = "00000000-0000-4000-8000-000000000003";
const projectId = "00000000-0000-4000-8000-000000000004";
const timestamp = "2026-11-02T10:00:00Z";
const row: RecordingRow = { id: recordingId, title: "Okna update 29. 10.", source_type: "upload", status: "completed", created_at: timestamp, updated_at: timestamp, duration_seconds: null, file_size_bytes: null, mime_type: "audio/webm", client_id: null, project_id: null, folder_id: null, visibility: "private", capabilities: { ...NO_RECORDING_CAPABILITIES, read: true, editTitle: true, manageAccess: true } };
const options: RecordingOrganizationOptions = { clients: [], folders: [{ id: "folder", name: "Porady", color: null, user_id: "owner", created_at: timestamp, updated_at: timestamp }], projects: [{ id: projectId, name: "Lucern", client_id: null, color: null, can_manage_access: true, created_at: timestamp, updated_at: timestamp }], tags: ["Lucern", "#Okna"].map((name, index) => ({ id: `tag-${index}`, name, color: null, user_id: "owner", created_at: timestamp, updated_at: timestamp })) };
const organization = { client: null, project: null, folder: null, tags: [] };
let container: HTMLDivElement;
let root: Root;

// renderEditor preserves the real dialog instance while server props change.
async function renderEditor(recording = row) {
  await act(async () => root.render(<RecordingEditSharingDialog recording={recording} options={options} organization={organization} />));
}

// clickButton exercises the visible named action and settles its effects.
async function clickButton(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text)!;
  expect(button).toBeTruthy();
  await act(async () => { button.click(); });
}

// changeSelect uses the native value setter and React change path.
async function changeSelect(name: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ members: [], grants: [], invitations: [] }) });
  mocks.rpc.mockResolvedValue({ data: [{ userId: recipientA, email: "petra@example.cz", role: "reader" }, { userId: recipientB, email: "jan@example.cz", role: "reader" }], error: null });
  mocks.title.mockImplementation(async (state) => createSaveSuccess(state.revision, recordingId, "Název uložen."));
  mocks.organization.mockImplementation(async (state) => createSaveSuccess(state.revision, recordingId, "Zařazení uloženo."));
  mocks.load.mockResolvedValue({ ...row, tag_ids: [] });
  mocks.share.mockResolvedValue(undefined);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 0; });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("recording edit and sharing dialog", () => {
  it("offers visible hashtags and all visibility choices directly without nested disclosures", async () => {
    await renderEditor();
    expect(mocks.rpc).not.toHaveBeenCalled();
    await clickButton("Upravit a sdílení");
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Upravit a sdílení");
    const tags = container.querySelector(".recording-organization-tags")!;
    expect(tags.textContent).toContain("#Lucern"); expect(tags.textContent).toContain("#Okna");
    expect(tags.textContent).not.toContain("##Okna"); expect(tags.closest("details")).toBeNull();
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Soukromá");
    expect(container.textContent).toContain("Uvidíte jen vy");
    expect(container.textContent).not.toContain("Nejprve potvrďte změnu zařazení");
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Vybraní lidé")?.matches(":disabled")).toBe(false);
  });

  it("blocks sharing and invitations on an unsaved assignment then uses the confirmed project", async () => {
    await renderEditor(); await clickButton("Upravit a sdílení");
    await changeSelect("projectId", projectId);
    expect(container.textContent).toContain("Nejprve potvrďte změnu zařazení");
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Uložit sdílení")?.disabled).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Odeslat pozvánku")?.matches(":disabled")).toBe(true);
    await act(async () => container.querySelector<HTMLFormElement>('form[aria-label="Zařazení"]')!.requestSubmit());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Nejprve potvrďte změnu zařazení");
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_project_capture_recipients_v1", { p_project_id: projectId });
    await clickButton("Členové projektu"); await clickButton("Uložit sdílení");
    expect(mocks.share.mock.calls[0][1]).toMatchObject({ projectId, visibility: "project" });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await clickButton("Pozvat do projektu");
    expect(container.textContent).toContain("Pozvánka do projektu Lucern");
  });

  it("keeps saved exact recipients and their editor role when another recipient is added", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ members: [], grants: [{ recordingId, userId: recipientA, role: "editor" }], invitations: [] }) });
    await renderEditor({ ...row, visibility: "selected" }); await clickButton("Upravit a sdílení");
    const checks = container.querySelectorAll<HTMLInputElement>(".recording-sharing-recipients input");
    expect(checks[0].checked).toBe(true);
    await act(async () => checks[1].click());
    await clickButton("Uložit sdílení");
    expect(mocks.share.mock.calls[0][1].recipients).toEqual([{ userId: recipientA, role: "editor" }, { userId: recipientB, role: "reader" }]);
  });

  it.each([false, true])("does not regrant a confirmed revoked recipient or erase another draft when access reload fails=%s", async (reloadFails) => {
    let revoked = false;
    mocks.fetch.mockImplementation(async (_url, init) => {
      if (init?.method === "DELETE") { revoked = true; return { ok: true, json: async () => ({ revoked: true }) }; }
      return { ok: !revoked || !reloadFails, json: async () => ({ members: [], grants: revoked ? [] : [{ recordingId, userId: recipientA, role: "editor" }], invitations: [] }) };
    });
    await renderEditor({ ...row, visibility: "selected" }); await clickButton("Upravit a sdílení");
    await act(async () => container.querySelectorAll<HTMLInputElement>(".recording-sharing-recipients input")[1].click());
    await clickButton("Odebrat přístup k nahrávce");
    const checks = container.querySelectorAll<HTMLInputElement>(".recording-sharing-recipients input");
    expect(checks[0].checked).toBe(false); expect(checks[1].checked).toBe(true);
    await clickButton("Uložit sdílení");
    expect(mocks.share.mock.calls[0][1].recipients).toEqual([{ userId: recipientB, role: "reader" }]);
  });

  it.each([false, true])("removes the current project's revoked member from exact sharing drafts even if project reload fails=%s", async (reloadFails) => {
    let revoked = false;
    mocks.load.mockResolvedValue({ ...row, project_id: projectId, visibility: "selected", tag_ids: [] });
    mocks.fetch.mockImplementation(async (url, init) => {
      if (init?.method === "DELETE") {
        expect(JSON.parse(init.body)).toEqual({ kind: "member", projectId, userId: recipientA });
        revoked = true;
        return { ok: true, json: async () => ({ revoked: true }) };
      }
      const projectQuery = String(url).includes("?projectId=");
      return { ok: !revoked || !reloadFails, json: async () => ({ members: projectQuery && !revoked ? [{ userId: recipientA, role: "editor" }] : [], grants: !projectQuery && !revoked ? [{ recordingId, userId: recipientA, role: "editor" }] : [], invitations: [] }) };
    });
    await renderEditor({ ...row, project_id: projectId, visibility: "selected" }); await clickButton("Upravit a sdílení");
    await act(async () => container.querySelectorAll<HTMLInputElement>(".recording-sharing-recipients input")[1].click());
    await clickButton("Pozvat do projektu"); await clickButton("Odebrat z projektu");
    const checks = container.querySelectorAll<HTMLInputElement>(".recording-sharing-recipients input");
    expect(checks[0].checked).toBe(false); expect(checks[1].checked).toBe(true);
    await clickButton("Uložit sdílení");
    expect(mocks.share.mock.calls[0][1].recipients).toEqual([{ userId: recipientB, role: "reader" }]);
  });

  it("allows an explicit regrant and applies a second confirmed revocation of the same identity once", async () => {
    const recipientAEmail = "recipient-a@example.test";
    let grants = [{ recordingId, userId: recipientA, email: recipientAEmail as string | null, role: "editor" as "reader" | "editor" }];
    mocks.fetch.mockImplementation(async (_url, init) => {
      if (init?.method === "DELETE") { const body = JSON.parse(init.body); grants = grants.filter((grant) => grant.userId !== body.userId); return { ok: true, json: async () => ({ revoked: true }) }; }
      return { ok: true, json: async () => ({ members: [], grants, invitations: [] }) };
    });
    mocks.share.mockImplementation(async (_client, attempt) => { grants = attempt.recipients.map((recipient: { userId: string; role: "reader" | "editor" }) => ({ recordingId, email: recipient.userId === recipientA ? recipientAEmail : null, ...recipient })); });
    await renderEditor({ ...row, visibility: "selected" }); await clickButton("Upravit a sdílení");
    await act(async () => container.querySelectorAll<HTMLInputElement>(".recording-sharing-recipients input")[1].click());
    await clickButton("Odebrat přístup k nahrávce");
    await act(async () => container.querySelector<HTMLInputElement>(".recording-sharing-recipients input")!.click());
    await clickButton("Uložit sdílení");
    expect(mocks.share.mock.calls[0][1].recipients).toContainEqual({ userId: recipientA, role: "editor" });
    const revokeAgain = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Odebrat přístup k nahrávce" && button.parentElement?.textContent?.includes(recipientAEmail))!;
    expect(revokeAgain).toBeTruthy();
    await act(async () => revokeAgain.click());
    const checks = container.querySelectorAll<HTMLInputElement>(".recording-sharing-recipients input");
    expect(checks[0].checked).toBe(false); expect(checks[1].checked).toBe(true);
    await clickButton("Uložit sdílení");
    expect(mocks.share.mock.calls[1][1].recipients).toEqual([{ userId: recipientB, role: "reader" }]);
  });

  it("keeps a full 100-recipient selection editable when one more contact is available", async () => {
    const saved = Array.from({ length: 100 }, (_, index) => ({ recordingId, userId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`, role: "reader" }));
    mocks.rpc.mockResolvedValue({ data: [{ userId: recipientB, email: "available@example.cz", role: "reader" }], error: null });
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ members: [], grants: saved, invitations: [] }) });
    await renderEditor({ ...row, visibility: "selected" }); await clickButton("Upravit a sdílení");
    const check = container.querySelector<HTMLInputElement>(".recording-sharing-recipients input")!;
    await act(async () => check.click());
    expect(check.checked).toBe(false);
    expect(container.textContent).toContain("100");
    expect(container.querySelector('input[name="title"]')?.matches(":disabled")).toBe(false);
    await clickButton("Uložit sdílení");
    expect(mocks.share.mock.calls[0][1].recipients).toHaveLength(100);
  });

  it("rejects a locally invalid 101-recipient snapshot before retry ownership and allows correction", async () => {
    const saved = Array.from({ length: 101 }, (_, index) => ({ recordingId, userId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`, role: "reader" }));
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ members: [], grants: saved, invitations: [] }) });
    await renderEditor({ ...row, visibility: "selected" }); await clickButton("Upravit a sdílení");
    await clickButton("Uložit sdílení");
    expect(mocks.share).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Zopakovat stejné sdílení");
    expect(container.querySelector('input[name="title"]')?.matches(":disabled")).toBe(false);
    expect(container.textContent).toContain("Nejvýše 100");
    await act(async () => container.querySelector<HTMLInputElement>(".recording-sharing-recipients input")!.click());
    await clickButton("Uložit sdílení");
    expect(mocks.share.mock.calls[0][1].recipients).toHaveLength(100);
  });

  it("preserves an uncertain UUID and payload across close, prop refresh and blocked sibling edits", async () => {
    await renderEditor(); await clickButton("Upravit a sdílení"); await clickButton("Vybraní lidé");
    await act(async () => container.querySelector<HTMLInputElement>(".recording-sharing-recipients input")!.click());
    mocks.share.mockRejectedValueOnce(new Error("Nejistý transport"));
    await clickButton("Uložit sdílení");
    const attempt = structuredClone(mocks.share.mock.calls[0][1]);
    expect(container.querySelector('input[name="title"]')?.matches(":disabled")).toBe(true);
    expect(container.querySelector('select[name="projectId"]')?.matches(":disabled")).toBe(true);
    await clickButton("Zavřít");
    await renderEditor({ ...row, title: "Čerstvý titulek", capabilities: { ...NO_RECORDING_CAPABILITIES, read: true } });
    await clickButton("Upravit a sdílení"); await clickButton("Zopakovat stejné sdílení");
    expect(mocks.share.mock.calls[1][1]).toEqual(attempt);
  });

  it("preserves unsent recipient checkbox drafts when a saved title refreshes the same recording", async () => {
    await renderEditor(); await clickButton("Upravit a sdílení"); await clickButton("Vybraní lidé");
    await act(async () => container.querySelectorAll<HTMLInputElement>(".recording-sharing-recipients input")[1].click());
    const reads = mocks.rpc.mock.calls.length;
    await renderEditor({ ...row, title: "Uložený nový název", updated_at: "2026-11-02T10:05:00Z" });
    const checks = container.querySelectorAll<HTMLInputElement>(".recording-sharing-recipients input");
    expect(checks[0].checked).toBe(false); expect(checks[1].checked).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(reads);
    await clickButton("Uložit sdílení");
    expect(mocks.share.mock.calls[0][1].recipients).toEqual([{ userId: recipientB, role: "reader" }]);
  });

  it("keeps organization drafts and blocks sharing after a failed save including a native form reset", async () => {
    mocks.organization.mockImplementationOnce(async (state) => createSaveError(state.revision, recordingId, "Zařazení nelze uložit."));
    await renderEditor(); await clickButton("Upravit a sdílení"); await changeSelect("folderId", "folder");
    const form = container.querySelector<HTMLFormElement>('form[aria-label="Zařazení"]')!;
    await act(async () => form.requestSubmit());
    await act(async () => form.reset());
    expect(container.querySelector<HTMLSelectElement>('select[name="folderId"]')?.value).toBe("folder");
    expect(container.textContent).toContain("Zařazení nelze uložit.");
    expect(container.textContent).toContain("Nejprve potvrďte změnu zařazení");
  });

  it("recovers body focus after a sharing error so Escape closes without losing the pending retry", async () => {
    let reject!: (error: Error) => void;
    mocks.share.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await renderEditor(); await clickButton("Upravit a sdílení"); await clickButton("Vybraní lidé");
    await act(async () => container.querySelector<HTMLInputElement>(".recording-sharing-recipients input")!.click());
    await clickButton("Uložit sdílení");
    // jsdom keeps disabled controls focused; explicitly emulate Chromium dropping focus to body.
    await act(async () => { document.body.tabIndex = -1; document.body.focus(); });
    expect(document.activeElement).toBe(document.body);
    await act(async () => reject(new Error("Nejistý transport")));
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await clickButton("Upravit a sdílení");
    expect(container.textContent).toContain("Zopakovat stejné sdílení");
  });

  it("requires the existing impact fingerprint before publishing a shared assignment to sibling controls", async () => {
    mocks.load.mockResolvedValue({ ...row, visibility: "selected", tag_ids: [], organization_policy: { personalEditable: true, projectIds: [] } });
    mocks.preview.mockResolvedValue({ preview: { fingerprint: "confirmed-fingerprint", exactRecipients: [], addedPaths: [], removedPaths: [] } });
    await renderEditor({ ...row, visibility: "selected" }); await clickButton("Upravit a sdílení");
    await changeSelect("folderId", "folder");
    await act(async () => container.querySelector<HTMLFormElement>('form[aria-label="Zařazení"]')!.requestSubmit());
    expect(mocks.organization).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Nejprve potvrďte změnu zařazení");
    expect(container.textContent).toContain("Potvrdit zařazení");
    await act(async () => container.querySelector<HTMLFormElement>('form[aria-label="Zařazení"]')!.requestSubmit());
    expect((mocks.organization.mock.calls[0][1] as FormData).get("organizationFingerprint")).toBe("confirmed-fingerprint");
    expect(container.textContent).not.toContain("Nejprve potvrďte změnu zařazení");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("never offers sharing for a title-only editor or management for a reader", async () => {
    await renderEditor({ ...row, capabilities: { ...NO_RECORDING_CAPABILITIES, read: true, editTitle: true } });
    await clickButton("Upravit a sdílení");
    expect(container.querySelector('form[aria-label="Název"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="Sdílení nahrávky"]')).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    await renderEditor({ ...row, capabilities: { ...NO_RECORDING_CAPABILITIES, read: true } });
    expect(container.querySelector("button")).toBeNull();
  });
});
