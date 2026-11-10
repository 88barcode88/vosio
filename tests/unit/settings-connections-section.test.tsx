// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsConnectionsSection } from "@/components/settings-connections-section";
import { formatConnectionDate, parseOwnConnections, shortExtensionId, type OwnConnection, type OwnConnectionsResult } from "@/lib/settings/connections";

vi.mock("@/lib/settings/connection-actions", () => ({
  listOwnConnectionsAction: vi.fn(),
  revokeOwnConnectionAction: vi.fn()
}));

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const extension: OwnConnection = {
  clientName: "Vosio pro Chrome a Edge",
  createdAt: "2026-11-06T09:30:00.000Z",
  extensionId: EXTENSION_ID,
  id: "11111111-1111-4111-8111-111111111111",
  scopes: ["vosio:capture"]
};
const assistant: OwnConnection = {
  clientName: "Claude",
  createdAt: "2026-10-31T23:30:00.000Z",
  extensionId: null,
  id: "22222222-2222-4222-8222-222222222222",
  scopes: ["vosio:read"]
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Renders the section with stubbed list/revoke calls and waits for the initial load.
async function renderSection(list: () => Promise<OwnConnectionsResult>, revoke = vi.fn(async (_grantId: string) => ({ ok: true }))) {
  await act(async () => root.render(<SettingsConnectionsSection listConnections={list} revokeConnection={revoke} />));
  return revoke;
}

// Finds a button by its exact visible text.
function button(text: string) {
  const found = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}

describe("SettingsConnectionsSection", () => {
  it("shows the empty state with a link to the extension documentation", async () => {
    await renderSection(async () => ({ connections: [], ok: true }));

    expect(container.querySelector("h2#settings-connections")?.textContent).toBe("Připojené aplikace a rozšíření");
    expect(container.textContent).toContain("Zatím nemáte žádné připojené rozšíření ani aplikaci.");
    expect(container.querySelector("a[href='/documentation#rozsireni-prohlizece']")).not.toBeNull();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("lists type, short extension ID and DD.MM.YYYY date for each own connection", async () => {
    await renderSection(async () => ({ connections: [extension, assistant], ok: true }));

    const rows = container.querySelectorAll("li.settings-connection-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Rozšíření prohlížeče – nahrávání");
    expect(rows[0].textContent).toContain("abcdefgh…");
    expect(rows[0].querySelector("code")?.getAttribute("title")).toBe(EXTENSION_ID);
    expect(rows[0].textContent).toContain("spárováno 06.11.2026");
    expect(rows[1].textContent).toContain("Čtení");
    expect(rows[1].querySelector("code")).toBeNull();
    // 23:30 UTC on 31.10. is already 01.11. in Prague.
    expect(rows[1].textContent).toContain("spárováno 01.11.2026");
  });

  it("revokes only after confirmation and removes the row", async () => {
    const revoke = await renderSection(async () => ({ connections: [extension, assistant], ok: true }));

    await act(async () => button("Odpojit").click());
    expect(revoke).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Opravdu odpojit?");

    await act(async () => button("Ano, odpojit").click());
    expect(revoke).toHaveBeenCalledWith(extension.id);
    expect(container.querySelectorAll("li.settings-connection-row")).toHaveLength(1);
    expect(container.textContent).not.toContain("Vosio pro Chrome a Edge");
  });

  it("cancels the confirmation without calling revoke", async () => {
    const revoke = await renderSection(async () => ({ connections: [extension], ok: true }));

    await act(async () => button("Odpojit").click());
    await act(async () => button("Zrušit").click());

    expect(revoke).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Opravdu odpojit?");
    expect(container.querySelectorAll("li.settings-connection-row")).toHaveLength(1);
  });

  it("keeps the connection and shows an error when the revoke fails", async () => {
    await renderSection(async () => ({ connections: [extension], ok: true }), vi.fn(async (_grantId: string) => ({ ok: false })));

    await act(async () => button("Odpojit").click());
    await act(async () => button("Ano, odpojit").click());

    expect(container.querySelector("[role='alert']")?.textContent).toContain("Odpojení se nepodařilo");
    expect(container.querySelectorAll("li.settings-connection-row")).toHaveLength(1);
  });

  it("shows an error with retry when the list cannot be loaded", async () => {
    const list = vi.fn<() => Promise<OwnConnectionsResult>>().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ connections: [assistant], ok: true });
    await renderSection(list);

    expect(container.querySelector("[role='alert']")?.textContent).toContain("Seznam připojení se teď nepodařilo načíst.");
    await act(async () => button("Zkusit znovu").click());

    expect(list).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll("li.settings-connection-row")).toHaveLength(1);
  });
});

describe("own connection helpers", () => {
  it("accepts the RPC payload with a missing extensionId and rejects malformed rows", () => {
    const row = { clientName: "Claude", createdAt: "2026-11-06T09:30:00Z", id: assistant.id, scopes: ["vosio:read"], status: "active" };
    expect(parseOwnConnections([row])?.[0].extensionId).toBeNull();
    expect(parseOwnConnections([{ ...row, id: "not-a-uuid" }])).toBeNull();
    expect(parseOwnConnections("nope")).toBeNull();
  });

  it("formats the date as DD.MM.YYYY and shortens the extension ID", () => {
    expect(formatConnectionDate("2026-01-05T12:00:00Z")).toBe("05.01.2026");
    expect(shortExtensionId(EXTENSION_ID)).toBe("abcdefgh…");
  });
});
