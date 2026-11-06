import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pending: vi.fn(), connections: vi.fn() }));
vi.mock("@/lib/mcp/gateway.server", () => ({
  MCP_NONCE_COOKIE: "__Host-vosio-mcp-nonce",
  getMcpMetadata: vi.fn().mockResolvedValue({ webOrigin: "https://web.example" }),
  readPendingView: mocks.pending,
  readConnectionsView: mocks.connections
}));
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ get: () => ({ value: "n".repeat(43) }) }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: () => { throw new Error("NEXT_REDIRECT"); } }));

import ConsentPage from "../../app/mcp/consent/page";
import ConnectionsPage from "../../app/mcp/connections/page";
import { mcpConnectionTypeLabel } from "@/lib/mcp/connection-labels";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const nonce = "n".repeat(43);
// Render the consent page for a synthetic pending request.
async function consent(scopes: string[], redirectUri: string) {
  mocks.pending.mockResolvedValue({ nonce, clientName: "Vosio rozšíření prohlížeče", pending: { id: "request", status: "pending", redirectUri, scopes } });
  return renderToStaticMarkup(await ConsentPage({ searchParams: Promise.resolve({ request: "request" }) }));
}

beforeEach(() => vi.clearAllMocks());

describe("MCP consent page capture mode", () => {
  it("shows the narrow extension permission and the ID from the verified redirect without a scope choice", async () => {
    const html = await consent(["vosio:capture"], `https://${extensionId}.chromiumapp.org/oauth`);
    expect(html).toContain("Připojit rozšíření prohlížeče"); expect(html).toContain(`ID rozšíření: ${extensionId}`);
    expect(html).toContain("pouze vytvářet nové nahrávky"); expect(html).toContain("Nemůže číst vaše existující nahrávky");
    expect(html).toContain('name="access" value="capture"'); expect(html).not.toContain("<select");
  });
  it("refuses a capture request whose redirect is not a verified extension URI", async () => {
    await expect(consent(["vosio:capture"], "https://host.example/callback")).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("keeps the read/write choice for ordinary MCP clients", async () => {
    const html = await consent(["vosio:read", "vosio:write"], "http://127.0.0.1:12345/callback");
    expect(html).toContain("<select"); expect(html).toContain("Také upravovat"); expect(html).not.toContain("ID rozšíření");
  });
});

describe("MCP connections labels", () => {
  it("labels capture, write and read connections", () => {
    expect(mcpConnectionTypeLabel(["vosio:capture"])).toBe("Rozšíření prohlížeče – nahrávání");
    expect(mcpConnectionTypeLabel(["vosio:read", "vosio:write"])).toBe("Čtení a úpravy");
    expect(mcpConnectionTypeLabel(["vosio:read"])).toBe("Čtení");
  });
  it("renders the extension label and ID on the connections page", async () => {
    mocks.connections.mockResolvedValue({ nonce, connections: [{ id: "a", clientName: "Vosio", scopes: ["vosio:capture"], extensionId }, { id: "b", clientName: "Codex", scopes: ["vosio:read"] }] });
    const html = renderToStaticMarkup(await ConnectionsPage());
    expect(html).toContain("Rozšíření prohlížeče – nahrávání"); expect(html).toContain(`ID rozšíření ${extensionId}`); expect(html).toContain("Codex · Čtení");
  });
});
