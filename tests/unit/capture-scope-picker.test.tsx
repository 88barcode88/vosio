// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { CaptureScopePicker } from "@/components/capture-scope-picker";
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ rpc: m.rpc }) }));
const project = "00000000-0000-4000-8000-000000000001";
const request = "00000000-0000-4000-8000-000000000002";
const recipient = "00000000-0000-4000-8000-000000000003";
describe("founder-approved in-app editor scope", () => {
  it("offers only confirmed standalone contacts and freezes IDs rather than labels in the selected scope", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    m.rpc.mockResolvedValue({ data: [{ userId: recipient, email: "confirmed@fixture.test" }], error: null });
    const node = document.createElement("div"); const root = createRoot(node); const changed = vi.fn();
    await act(async () => root.render(<CaptureScopePicker projects={[]} value={{ projectId: null, visibility: "selected", recipients: [] }} onChange={changed} />));
    expect(m.rpc).toHaveBeenLastCalledWith("list_confirmed_recording_recipients_v1");
    expect(node.textContent).toContain("confirmed@fixture.test");
    expect(node.textContent).toContain("Nový e-mail");
    await act(async () => (node.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    expect(changed).toHaveBeenCalledWith({ projectId: null, visibility: "selected", recipients: [{ userId: recipient, role: "reader" }] });
    await act(async () => root.unmount());
  });
  it("uses the exact DB reservation and never offers arbitrary editor recipients or a code workflow", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    m.rpc.mockResolvedValue({ data: [{ request_id: request, recipients: [{ userId: recipient, role: "editor" }], expires_at: "2099-01-01T12:00:00Z" }], error: null });
    const node = document.createElement("div"); const root = createRoot(node); const changed = vi.fn();
    await act(async () => root.render(<CaptureScopePicker projects={[{ id: project, name: "Project", client_id: null, can_capture: true, can_manage_access: false, color: null, created_at: "", updated_at: "" }]} value={{ projectId: project, visibility: "private", recipients: [] }} onChange={changed} />));
    expect(m.rpc).toHaveBeenCalledWith("list_selected_recording_capture_authorizations_v1", { p_project_id: project });
    const select = node.querySelectorAll("select")[2]!;
    await act(async () => { select.value = request; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(changed).toHaveBeenCalledWith({ projectId: project, visibility: "selected", recipients: [{ userId: recipient, role: "editor" }] }, request);
    expect(node.textContent).not.toContain("Kód schválení");
    expect(node.querySelector('input[type="checkbox"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
