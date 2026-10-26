// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamManager } from "@/components/team-manager";
import type { TeamWorkspace } from "@/lib/team/types";

const userId = "00000000-0000-4000-8000-000000000901";
const projectId = "00000000-0000-4000-8000-000000000902";
const clientId = "00000000-0000-4000-8000-000000000903";
const project = { scopeKind: "project" as const, scopeId: projectId, projectId, label: "Web 2026" };
const client = { scopeKind: "client" as const, scopeId: clientId, projectId, label: "Studio Sever" };
const initial: TeamWorkspace = {
  role: "project_founder",
  people: [{ userId, email: "anna@example.test", accesses: [{ ...project, role: "editor" }, { ...client, role: "reader" }] }],
  scopes: [project, client],
  invitations: [{ id: "00000000-0000-4000-8000-000000000904", email: "martin@example.test", role: "reader", scope: "project", projectId,
    expiresAt: "2099-01-01T00:00:00Z", acceptedAt: null, revokedAt: null, attemptId: "00000000-0000-4000-8000-000000000905", attemptCount: 1,
    deliveryState: "sent", lastAttemptAt: "2026-01-01T00:00:00Z", nextAttemptAt: "2026-01-01T00:00:00Z", authorizationCurrent: true }]
};
let container: HTMLDivElement;
let root: Root;

// button finds the real action by exact visible copy without depending on CSS-module hashes.
function button(text: string) { return Array.from(container.querySelectorAll("button")).find(item => item.textContent === text)!; }
// checkbox finds a scope by its full accessible boundary rather than source ordering.
function checkbox(label: string) { return container.querySelector<HTMLInputElement>(`input[aria-label="Vybrat ${label}"]`)!; }
// submit dispatches the native form event through React's existing handler.
async function submit(form: HTMLFormElement) { await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(initial))));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("approved compact team workspace", () => {
  it("separates a pending invitation from the person's active grant paths and states private exclusions", async () => {
    await act(async () => root.render(<TeamManager initialWorkspace={initial} />));
    expect(container.querySelector('[aria-label="Vlastní seznam lidí"]')!.textContent).toContain("martin@example.test");
    expect(container.querySelector('[aria-label="Detail osoby"]')!.textContent).not.toContain("martin@example.test");
    expect(container.textContent).toContain("Aktivní přístupy · 2");
    await act(async () => button("Přidělit přístup").click());
    expect(container.textContent).toContain("současné i budoucí nesoukromé nahrávky");
    expect(container.textContent).toContain("Soukromou nahrávku vyberte jednotlivě");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts one exact client batch and common role, then reads confirmed server state", async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === "POST" ? { saved: true, count: 1 } : initial)));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={initial} />));
    await act(async () => button("Přidělit přístup").click());
    const form = container.querySelector('form[aria-label="Přidělit přístup"]') as HTMLFormElement;
    await act(async () => checkbox("Studio Sever / Web 2026").click());
    await submit(form);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/team/access/batch");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ requestId: expect.any(String), userId, role: "reader", scopes: [{ scopeKind: "client", scopeId: clientId, projectId }] });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/team");
    expect(container.textContent).toContain("Požadavek je potvrzený.");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("requires confirmation for revocation and keeps the remaining project grant", async () => {
    const refreshed = { ...initial, people: [{ ...initial.people[0], accesses: [initial.people[0].accesses[0]] }] };
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === "DELETE" ? { revoked: true } : refreshed)));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={initial} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Odebrat přístup: Studio Sever / Web 2026"]')!.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain("Jiný platný přístup");
    await act(async () => button("Odebrat přístup").click());
    expect(container.textContent).toContain("Aktivní přístupy · 1");
    expect(container.textContent).toContain("Web 2026");
    expect(container.querySelector('[aria-label="Odebrat přístup: Studio Sever / Web 2026"]')).toBeNull();
  });

  it("keeps the invitation draft after a server error and exposes retry feedback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 500 })));
    await act(async () => root.render(<TeamManager initialWorkspace={initial} />));
    await act(async () => Array.from(container.querySelectorAll("summary")).find(item => item.textContent === "Pozvat člověka")!.click());
    const form = container.querySelector('[aria-label="Pozvat člověka"] form') as HTMLFormElement;
    const email = form.querySelector<HTMLInputElement>('input[name="email"]')!;
    email.value = "new@example.test";
    form.querySelector<HTMLSelectElement>('select[name="scope"]')!.value = `project:${projectId}:${projectId}`;
    await submit(form);
    expect(container.querySelector<HTMLInputElement>('input[name="email"]')!.value).toBe("new@example.test");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("Rozepsané hodnoty zůstaly zachované");
  });

  it("creates a client invitation with the project boundary without turning it into active access", async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => Response.json(init?.method === "POST" ? { delivery: "sent" } : initial));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={initial} />));
    await act(async () => Array.from(container.querySelectorAll("summary")).find(item => item.textContent === "Pozvat člověka")!.click());
    const form = container.querySelector('[aria-label="Pozvat člověka"] form') as HTMLFormElement;
    form.querySelector<HTMLInputElement>('input[name="email"]')!.value = "new@example.test";
    form.querySelector<HTMLSelectElement>('select[name="scope"]')!.value = `client:${clientId}:${projectId}`;
    await submit(form);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ scope: "client", scopeId: clientId, projectId, email: "new@example.test", role: "reader" });
    expect(container.textContent).toContain("Aktivní přístupy · 2");
    expect(container.textContent).toContain("Přístup vznikne až po přijetí");
  });

  it("clears all manager data when fresh authority is denied on return", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 403 })));
    await act(async () => root.render(<TeamManager initialWorkspace={initial} />));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toContain("nemáte aktuální oprávnění");
    expect(container.textContent).not.toContain("anna@example.test");
    expect(container.textContent).not.toContain("martin@example.test");
    expect(container.querySelector("summary")).toBeNull();
  });

  it("cancels P's revocation when refresh removes P instead of retargeting the dialog to Q", async () => {
    const q = { userId: "00000000-0000-4000-8000-000000000909", email: "q@example.test", accesses: [{ ...project, role: "reader" as const }] };
    const p = { ...initial.people[0], accesses: [{ ...project, role: "reader" as const }] };
    const starting = { ...initial, people: [p, q], invitations: [] };
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => Response.json(init?.method === "DELETE" ? { revoked: true } : { ...starting, people: [q] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={starting} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Odebrat přístup: Web 2026"]')!.click());
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain(p.email);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.querySelector('[aria-label="Detail osoby"]')!.textContent).toContain(q.email);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
  });

  it("cancels the dialog when its path disappears even if P remains in the refreshed list", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ...initial, people: [{ ...initial.people[0], accesses: [initial.people[0].accesses[0]] }] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={initial} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Odebrat přístup: Studio Sever / Web 2026"]')!.click());
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[aria-label="Detail osoby"]')!.textContent).toContain(initial.people[0].email);
    expect(container.querySelector('[aria-label="Odebrat přístup: Web 2026"]')).not.toBeNull();
  });

  it("keeps the captured delete identity while a refresh is in flight", async () => {
    let finishFirstRefresh!: (response: Response) => void;
    const q = { userId: "00000000-0000-4000-8000-000000000909", email: "q@example.test", accesses: [{ ...project, role: "reader" as const }] };
    const starting = { ...initial, people: [initial.people[0], q] };
    const refreshed = { ...starting, people: [q] };
    let reads = 0;
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return Response.json({ revoked: true });
      if (++reads === 1) return new Promise<Response>(resolve => { finishFirstRefresh = resolve; });
      return Response.json(refreshed);
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={starting} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Odebrat přístup: Studio Sever / Web 2026"]')!.click());
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain(initial.people[0].email);
    expect(container.querySelector('[role="dialog"]')!.textContent).not.toContain(q.email);
    await act(async () => button("Odebrat přístup").click());
    await act(async () => finishFirstRefresh(Response.json(starting)));
    const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(JSON.parse(deletes[0][1]!.body as string)).toEqual({ scopeKind: "client", scopeId: clientId, projectId, userId });
    expect(container.querySelector('[aria-label="Detail osoby"]')!.textContent).toContain(q.email);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("cancels P's grant form when refresh switches selection to Q", async () => {
    const q = { userId: "00000000-0000-4000-8000-000000000909", email: "q@example.test", accesses: [{ ...project, role: "reader" as const }] };
    const starting = { ...initial, people: [initial.people[0], q] };
    const fetchMock = vi.fn(async () => Response.json({ ...starting, people: [q] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={starting} />));
    await act(async () => button("Přidělit přístup").click());
    expect(container.querySelector('form[aria-label="Přidělit přístup"]')!.textContent).toContain(initial.people[0].email);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.querySelector('[aria-label="Detail osoby"]')!.textContent).toContain(q.email);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("grants only to the captured P identity when focus refresh is still in flight at submit", async () => {
    let finishFirstRefresh!: (response: Response) => void;
    const q = { userId: "00000000-0000-4000-8000-000000000909", email: "q@example.test", accesses: [{ ...project, role: "reader" as const }] };
    const starting = { ...initial, people: [initial.people[0], q] };
    let reads = 0;
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ saved: true, count: 1 });
      if (++reads === 1) return new Promise<Response>(resolve => { finishFirstRefresh = resolve; });
      return Response.json({ ...starting, people: [q] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={starting} />));
    await act(async () => button("Přidělit přístup").click());
    await act(async () => window.dispatchEvent(new Event("focus")));
    const form = container.querySelector('form[aria-label="Přidělit přístup"]') as HTMLFormElement;
    expect(form.textContent).toContain(initial.people[0].email);
    expect(form.textContent).not.toContain(q.email);
    await act(async () => checkbox("Studio Sever / Web 2026").click());
    await submit(form);
    await act(async () => finishFirstRefresh(Response.json(starting)));
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1]!.body as string)).toEqual({ requestId: expect.any(String), userId, role: "reader", scopes: [{ scopeKind: "client", scopeId: clientId, projectId }] });
    expect(container.querySelector('[aria-label="Detail osoby"]')!.textContent).toContain(q.email);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps explicit private and project selections across breadcrumb navigation and saves one common-role batch", async () => {
    const privateRecording = { scopeKind: "recording" as const, scopeId: "00000000-0000-4000-8000-000000000911", projectId, clientId, folderId: null, visibility: "private" as const, label: "Soukromý hovor" };
    const standalone = { ...privateRecording, scopeId: "00000000-0000-4000-8000-000000000912", projectId: null, clientId: null, visibility: "selected" as const, label: "Samostatný hovor" };
    const starting = { ...initial, scopes: [{ ...client, projectId: null }, { ...project, clientId }, privateRecording, standalone] };
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => Response.json(init?.method === "POST" ? { saved: true, count: 3 } : starting));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={starting} />));
    await act(async () => button("Přidělit přístup").click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Otevřít Web 2026"]')!.click());
    await act(async () => checkbox("Soukromý hovor").click());
    expect(container.textContent).toContain("Nově sdílené soukromé: 1");
    expect(container.textContent).toContain("Příjemce: anna@example.test");
    await act(async () => checkbox("Web 2026").click());
    expect(checkbox("Soukromý hovor").checked).toBe(true);
    await act(async () => button("Rozsahy").click());
    await act(async () => button("Nahrávky").click());
    await act(async () => checkbox("Samostatný hovor").click());
    expect(container.textContent).toContain("Bez projektu");
    const role = container.querySelector<HTMLSelectElement>('[aria-label="Oprávnění pro celý výběr"]')!;
    await act(async () => { role.value = "editor"; role.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(fetchMock).not.toHaveBeenCalled();
    await submit(container.querySelector('form[aria-label="Přidělit přístup"]')!);
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1]!.body as string)).toEqual({ requestId: expect.any(String), userId, role: "editor", scopes: [privateRecording, project, standalone].map(({ scopeKind, scopeId, projectId }) => ({ scopeKind, scopeId, projectId })) });
  });

  it("locks edits after an unknown write and replays the identical captured payload and UUID", async () => {
    const q = { userId: "00000000-0000-4000-8000-000000000909", email: "q@example.test", accesses: [] };
    const starting = { ...initial, people: [initial.people[0], q] };
    let posts = 0;
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") { if (++posts === 1) throw new Error("lost response"); return Response.json({ saved: true, count: 1 }); }
      return Response.json(starting);
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={starting} />));
    await act(async () => button("Přidělit přístup").click());
    await act(async () => checkbox("Studio Sever / Web 2026").click());
    await submit(container.querySelector('form[aria-label="Přidělit přístup"]')!);
    expect(checkbox("Studio Sever / Web 2026").disabled).toBe(true);
    const qButton = container.querySelector<HTMLButtonElement>('[aria-pressed="false"]')!;
    expect(qButton.disabled).toBe(true);
    await act(async () => qButton.click());
    expect(container.querySelector('form[aria-label="Přidělit přístup"]')!.textContent).toContain(initial.people[0].email);
    await act(async () => button("Ověřit stejný požadavek").click());
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(2);
    expect(writes[0][1]!.body).toBe(writes[1][1]!.body);
    expect(JSON.parse(writes[0][1]!.body as string).userId).toBe(userId);
    expect(container.textContent).toContain("Požadavek je potvrzený");
  });

  it("requires the same receipt replay when a successful write cannot yet refresh current state", async () => {
    let reads = 0;
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => init?.method === "POST" ? Response.json({ saved: true, count: 1 }) : ++reads === 1 ? new Response("{}", { status: 500 }) : Response.json(initial));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={initial} />));
    await act(async () => button("Přidělit přístup").click());
    await act(async () => checkbox("Studio Sever / Web 2026").click());
    await submit(container.querySelector('form[aria-label="Přidělit přístup"]')!);
    expect(container.textContent).not.toContain("Požadavek je potvrzený");
    await act(async () => button("Ověřit stejný požadavek").click());
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes[0][1]!.body).toBe(writes[1][1]!.body);
    expect(container.textContent).toContain("Požadavek je potvrzený");
  });

  it("rechecks a fresh scope denial, preserves the captured draft and permits correction with a new UUID", async () => {
    let posts = 0;
    const refreshed = { ...initial, scopes: [project] };
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => init?.method === "POST"
      ? ++posts === 1 ? new Response("{}", { status: 403 }) : Response.json({ saved: true, count: 1 })
      : Response.json(refreshed));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={initial} />));
    await act(async () => button("Přidělit přístup").click());
    await act(async () => checkbox("Studio Sever / Web 2026").click());
    await act(async () => button("Rozsahy").click());
    await act(async () => button("Projekty").click());
    await act(async () => checkbox("Web 2026").click());
    await submit(container.querySelector('form[aria-label="Přidělit přístup"]')!);
    expect(container.textContent).not.toContain("nemáte aktuální oprávnění");
    expect(container.querySelector('form[aria-label="Přidělit přístup"]')!.textContent).toContain("Příjemce: anna@example.test");
    expect(button("Uložit přístupy").disabled).toBe(true);
    const remove = container.querySelector<HTMLButtonElement>('[aria-label="Vyřadit Studio Sever / Web 2026"]')!;
    expect(remove.disabled).toBe(false);
    await act(async () => remove.click());
    expect(button("Uložit přístupy").disabled).toBe(false);
    await submit(container.querySelector('form[aria-label="Přidělit přístup"]')!);
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string));
    expect(writes).toHaveLength(2);
    expect(writes[0].requestId).not.toBe(writes[1].requestId);
    expect(writes[1]).toMatchObject({ userId, scopes: [{ scopeKind: "project", scopeId: projectId, projectId }] });
    expect(container.textContent).toContain("Požadavek je potvrzený");
  });

  it("retains the original locked payload when a formerly uncertain write is later denied", async () => {
    let posts = 0;
    let reads = 0;
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        if (++posts === 1) throw new Error("lost response");
        return posts === 2 ? new Response("{}", { status: 403 }) : Response.json({ saved: true, count: 1 });
      }
      return ++reads === 1 ? new Response("{}", { status: 403 }) : Response.json(initial);
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TeamManager initialWorkspace={initial} />));
    await act(async () => button("Přidělit přístup").click());
    await act(async () => checkbox("Studio Sever / Web 2026").click());
    await submit(container.querySelector('form[aria-label="Přidělit přístup"]')!);
    await act(async () => button("Ověřit stejný požadavek").click());
    expect(container.textContent).toContain("nemáte aktuální oprávnění");
    expect(button("Ověřit stejný požadavek").disabled).toBe(true);
    await act(async () => button("Obnovit přehled").click());
    expect(container.textContent).not.toContain("nemáte aktuální oprávnění");
    expect(checkbox("Studio Sever / Web 2026").disabled).toBe(true);
    expect(button("Ověřit stejný požadavek").disabled).toBe(false);
    await act(async () => button("Ověřit stejný požadavek").click());
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(3);
    expect(writes[1][1]!.body).toBe(writes[0][1]!.body);
    expect(writes[2][1]!.body).toBe(writes[0][1]!.body);
    expect(container.textContent).toContain("Požadavek je potvrzený");
  });

  it("opens the global client first even when a project-limited client sorts earlier", async () => {
    const starting = { ...initial, scopes: [client, { ...client, projectId: null }, project] };
    await act(async () => root.render(<TeamManager initialWorkspace={starting} />));
    await act(async () => button("Přidělit přístup").click());
    expect(checkbox("Studio Sever / všechny spravované projekty")).not.toBeNull();
  });
});
