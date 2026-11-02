/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
vi.mock("@/lib/auth/actions", () => ({ verifyInvitationIdentityAction: vi.fn() }));
import { RecordingAccessManager } from "@/components/workspace/recording-access-manager";
import { InvitationAcceptForm } from "@/components/workspace/invitation-accept-form";
import { verifyInvitationIdentityAction } from "@/lib/auth/actions";

const recordingId = "30000000-0000-4000-8000-000000000003";
const projectId = "20000000-0000-4000-8000-000000000002";
const invitationId = "10000000-0000-4000-8000-000000000001";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  window.history.replaceState(null, "", "/invitations/accept");
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("first standalone email invitation caller boundary", () => {
  it("sends exact standalone private scope without publishing, sharing or assuming recipient access", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_path: string, options?: RequestInit) => new Response(JSON.stringify(options?.method === "POST" ? { id: invitationId, delivery: "sent" } : { members: [], grants: [], invitations: [] }), { status: 200 })));
    await act(async () => root.render(<RecordingAccessManager recordingId={recordingId} projectId={null} visibility="private" canManageAccess />));
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    const email = container.querySelector<HTMLInputElement>('input[name="email"]')!;
    email.value = "new-recipient@example.test";
    await act(async () => form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const mutations = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST");
    expect(mutations).toHaveLength(1);
    expect(mutations[0]![0]).toBe("/api/recording-invitations");
    expect(JSON.parse(mutations[0]![1]!.body as string)).toEqual({ scope: "standalone", recordingIds: [recordingId], email: "new-recipient@example.test", role: "reader" });
    expect(container.textContent).toContain("Přístup vznikne až po přijetí");
    expect(container.textContent).not.toContain("Přístup byl udělen");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    [projectId, true],
    [null, false],
  ] as const)("does not offer first private invitation for project=%s/manage=%s", async (scope, canManageAccess) => {
    vi.stubGlobal("fetch", vi.fn());
    await act(async () => root.render(<RecordingAccessManager recordingId={recordingId} projectId={scope} visibility="private" canManageAccess={canManageAccess} />));
    expect(container.querySelector("form")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });

  it.each([200, 403])("opens fresh recordings only after successful explicit accept (%s)", async (status) => {
    const token = "z".repeat(43);
    window.history.replaceState(null, "", `/invitations/accept#token=${token}&type=email`);
    vi.stubGlobal("fetch", vi.fn(async (_path: string, options?: RequestInit) => new Response(JSON.stringify(options?.method === "POST" ? { id: invitationId } : { id: invitationId, scope: "recordings", role: "reader", expiresAt: "2030-01-01T00:00:00Z", recordingCount: 1 }), { status: options?.method === "POST" ? status : 200 })));
    await act(async () => root.render(<InvitationAcceptForm />));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
    expect(window.location.hash).toBe("");
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Přijmout pozvánku")!;
    await act(async () => button.click());
    expect(fetch).toHaveBeenLastCalledWith("/api/recording-invitations/accept", expect.objectContaining({ method: "POST", body: JSON.stringify({ token }) }));
    expect(mocks.refresh).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
    if (status === 200) expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/recordings");
    else expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain(status === 200 ? "Pozvánka byla přijata" : "Pozvánku nelze přijmout");
  });

  it("keeps a home link when the invitation URL is missing or incomplete", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await act(async () => root.render(<InvitationAcceptForm />));
    const home = container.querySelector<HTMLAnchorElement>('a[href="/recordings"]');
    expect(home?.textContent).toBe("Zpět na nahrávky");
    expect(container.textContent).toContain("Otevřete úplný odkaz");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("verifies the invited account and password before accepting, then opens its recordings", async () => {
    const token = "z".repeat(43);
    window.history.replaceState(null, "", `/invitations/accept#token=${token}&type=invite`);
    const preview = { id: invitationId, scope: "recordings" as const, role: "reader" as const, expiresAt: "2030-01-01T00:00:00Z", recordingCount: 1 };
    vi.stubGlobal("fetch", vi.fn(async (_path: string, options?: RequestInit) => options?.method === "POST" ? Response.json({ id: invitationId }) : new Response(null, { status: 403 })));
    vi.mocked(verifyInvitationIdentityAction).mockResolvedValue({ ok: true, preview });
    await act(async () => root.render(<InvitationAcceptForm />));
    for (const [name, value] of Object.entries({ email: "recipient@example.test", code: "123456", password: "safe-test-password", confirmation: "safe-test-password" })) {
      container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value = value;
    }
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(verifyInvitationIdentityAction).toHaveBeenCalledExactlyOnceWith({ token, type: "invite", email: "recipient@example.test", code: "123456", password: "safe-test-password", confirmation: "safe-test-password" });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Přijmout pozvánku")!.click());
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/recordings");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("keeps acceptance available after a failed save without duplicate POSTs or early navigation", async () => {
    window.history.replaceState(null, "", `/invitations/accept#token=${"z".repeat(43)}&type=email`);
    let finishAccept!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { finishAccept = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_path: string, options?: RequestInit) => options?.method === "POST" ? response : Response.json({ id: invitationId, scope: "recordings", role: "reader", expiresAt: "2030-01-01T00:00:00Z", recordingCount: 1 })));
    await act(async () => root.render(<InvitationAcceptForm />));
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Přijmout pozvánku")!;
    await act(async () => { button.click(); button.click(); });
    expect(button.disabled).toBe(true);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => finishAccept(new Response(null, { status: 503 })));
    expect(button.disabled).toBe(false);
    expect(container.textContent).toContain("Pozvánku nelze přijmout");
    expect(container.querySelector('a[href="/recordings"]')).not.toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(["client", "folder"])("explains current and future nonprivate %s access before explicit acceptance", async (scope) => {
    window.history.replaceState(null, "", `/invitations/accept#token=${"z".repeat(43)}&type=email`);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: invitationId, scope, role: "reader", expiresAt: "2030-01-01T00:00:00Z", recordingCount: 0 })));
    await act(async () => root.render(<InvitationAcceptForm />));
    expect(container.textContent).toContain(scope === "client" ? "klienta" : "složky");
    expect(container.textContent).toContain("současným i budoucím nesoukromým nahrávkám");
    expect(container.textContent).toContain("Soukromé nahrávky se touto pozvánkou nikdy nesdílejí");
    expect(container.textContent).not.toContain("Vybrané nahrávky: 0");
    expect(container.textContent).not.toContain("pouze k nahrávkám v pozvánce");
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

const pendingInvitation = { id: invitationId, email: "recipient@example.test", role: "reader", scope: "recordings", expiresAt: "2030-01-01T00:00:00Z", acceptedAt: null, revokedAt: null, attemptId: projectId, attemptCount: 4, deliveryState: "sent", lastAttemptAt: "2026-01-01T00:00:00Z", nextAttemptAt: "2026-01-01T00:01:00Z", authorizationCurrent: true };

describe("manager outcomes stay truthful", () => {
  it.each([true, false])("describes changed=%s as invitation cancellation, never active access removal", async (changed) => {
    let cancelled = false;
    vi.stubGlobal("fetch", vi.fn(async (_path: string, options?: RequestInit) => {
      if (options?.method === "DELETE") { cancelled = true; return new Response(JSON.stringify({ revoked: true, changed })); }
      return new Response(JSON.stringify({ members: [], grants: [], invitations: cancelled ? [] : [pendingInvitation] }));
    }));
    await act(async () => root.render(<RecordingAccessManager recordingId={recordingId} projectId={null} visibility="selected" canManageAccess />));
    const revoke = [...container.querySelectorAll("button")].find((button) => button.textContent === "Zrušit pozvánku")!;
    await act(async () => revoke.click());
    expect(container.textContent).toContain(changed ? "Pozvánka byla zrušena" : "Pozvánka už byla zrušena");
    expect(container.textContent).not.toContain("Přístup byl odebrán");
  });

  it("refreshes accepted-first conflict into active access without claiming revoke success", async () => {
    let accepted = false;
    vi.stubGlobal("fetch", vi.fn(async (_path: string, options?: RequestInit) => {
      if (options?.method === "DELETE") { accepted = true; return new Response(JSON.stringify({ code: "invitation_not_pending" }), { status: 409 }); }
      return new Response(JSON.stringify({ members: [], grants: accepted ? [{ recordingId, userId: projectId, role: "reader" }] : [], invitations: accepted ? [] : [pendingInvitation] }));
    }));
    await act(async () => root.render(<RecordingAccessManager recordingId={recordingId} projectId={null} visibility="selected" canManageAccess />));
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Zrušit pozvánku")!.click());
    expect(container.textContent).toContain("Pozvánka už není čekající");
    expect(container.textContent).toContain("Odebrat přístup k nahrávce");
    expect(container.textContent).not.toContain("Přístup byl odebrán");
    expect(container.textContent).not.toContain("Pozvánka byla zrušena");
  });

  it.each(["cooldown", "terminal"])("shows %s retry state without a blanket one-minute promise", async (state) => {
    let attempted = false;
    vi.stubGlobal("fetch", vi.fn(async (_path: string, options?: RequestInit) => {
      if (options?.method === "PATCH") {
        attempted = true;
        return new Response(JSON.stringify(state === "terminal" ? { code: "invitation_attempts_exhausted" } : { code: "rate_limited", retryAfterSeconds: 3510 }), { status: state === "terminal" ? 409 : 429, headers: state === "terminal" ? {} : { "Retry-After": "3510" } });
      }
      return new Response(JSON.stringify({ members: [], grants: [], invitations: [{ ...pendingInvitation, attemptCount: state === "terminal" && attempted ? 5 : 4 }] }));
    }));
    await act(async () => root.render(<RecordingAccessManager recordingId={recordingId} projectId={null} visibility="selected" canManageAccess />));
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Odeslat znovu"))!.click());
    expect(container.textContent).toContain(state === "terminal" ? "Limit pěti odeslání této pozvánky je vyčerpaný" : "3510");
    expect(container.textContent).not.toContain("za minutu");
    if (state === "terminal") expect([...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Odeslat znovu"))!.disabled).toBe(true);
  });
});
