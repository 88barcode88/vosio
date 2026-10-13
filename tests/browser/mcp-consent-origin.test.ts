import { createServer, type Server } from "node:http";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mcp/gateway.server", () => ({
  MCP_NONCE_COOKIE: "__Host-vosio-mcp-nonce",
  getMcpMetadata: vi.fn().mockResolvedValue({ webOrigin: "https://web.example" }),
  readPendingView: vi.fn().mockResolvedValue({ nonce: "n".repeat(43), clientName: "Codex", pending: { id: "request", status: "pending", redirectUri: "http://127.0.0.1:12345/callback", scopes: ["vosio:read", "vosio:write"] } }),
  readUpstreamView: vi.fn().mockResolvedValue({ nonce: "n".repeat(43), authorizationId: "authorization", redirectUrl: null }),
  readConnectionsView: vi.fn().mockResolvedValue({ nonce: "n".repeat(43), connections: [{ id: "grant", clientName: "Codex", scopes: ["vosio:read"] }] })
}));
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ get: () => ({ value: "n".repeat(43) }) }) }));

import ConsentPage, { metadata as consentMetadata } from "../../app/mcp/consent/page";
import UpstreamPage, { metadata as upstreamMetadata } from "../../app/mcp/upstream-consent/page";
import ConnectionsPage, { metadata as connectionsMetadata } from "../../app/mcp/connections/page";

let browser: Browser;
let server: Server;
let externalServer: Server;
let origin: string;
let externalOrigin: string;
const documents = new Map<string, string>();

// Serve only the rendered production forms with their actual page metadata.
function document(policy: string, body: string) {
  return `<!doctype html><html><head><meta name="referrer" content="${policy}"></head><body>${body}</body></html>`;
}

// Bind a disposable loopback listener without touching application accounts or data.
async function listen(instance: Server) {
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener.");
  return `http://127.0.0.1:${address.port}`;
}

beforeAll(async () => {
  documents.set("/mcp/consent", document(consentMetadata.referrer, renderToStaticMarkup(await ConsentPage({ searchParams: Promise.resolve({ request: "request" }) }))));
  documents.set("/mcp/upstream-consent", document(upstreamMetadata.referrer, renderToStaticMarkup(await UpstreamPage({ searchParams: Promise.resolve({ authorization_id: "authorization" }) }))));
  documents.set("/mcp/connections", document(connectionsMetadata.referrer, renderToStaticMarkup(await ConnectionsPage())));
  server = createServer((request, response) => {
    if (request.method === "POST") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ origin: request.headers.origin ?? null }));
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(documents.get(new URL(request.url!, "http://test").pathname));
  });
  externalServer = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ referer: request.headers.referer ?? null }));
  });
  origin = await listen(server);
  externalOrigin = await listen(externalServer);
  browser = await chromium.launch({ headless: true });
}, 15000);

afterAll(async () => {
  await browser?.close();
  for (const instance of [server, externalServer]) {
    if (instance?.listening) await new Promise<void>((resolve, reject) => instance.close((error) => error ? reject(error) : resolve()));
  }
});

describe("MCP browser consent origin", () => {
  it.each([
    ["/mcp/consent", "Povolit vybraný přístup", "read"],
    ["/mcp/consent", "Povolit vybraný přístup", "write"],
    ["/mcp/upstream-consent", "Potvrdit připojení", null],
    ["/mcp/connections", "Odebrat připojení", null]
  ] as const)("preserves the browser Origin when submitting %s with %s (%s)", async (path, button, access) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${origin}${path}`);
      if (access) await page.getByLabel("Rozsah přístupu").selectOption(access);
      await Promise.all([page.waitForURL(`${origin}/api/mcp/oauth/consent`), page.getByRole("button", { name: button }).click()]);
      expect(JSON.parse(await page.locator("body").innerText())).toEqual({ origin });
    } finally { await page.close(); }
  });

  it.each(["/mcp/consent", "/mcp/upstream-consent", "/mcp/connections"])("does not disclose the %s URL to another origin", async (path) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${origin}${path}?request=private-request`);
      await Promise.all([page.waitForURL(`${externalOrigin}/`), page.evaluate((url) => { window.location.assign(url); }, externalOrigin)]);
      expect(JSON.parse(await page.locator("body").innerText())).toEqual({ referer: null });
    } finally { await page.close(); }
  });
});
