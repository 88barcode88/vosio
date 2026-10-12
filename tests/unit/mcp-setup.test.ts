import { describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { setupVosioMcp, createSetupClient, setupOrigin, hostedServiceKey, receiptStore } from "../../scripts/setup-vosio-mcp.mjs";

const base = { webOrigin: "https://web.example", publicSupabaseUrl: "https://abcdefghijklmnopqrst.supabase.co", projectRef: "abcdefghijklmnopqrst", upstreamClientId: "upstream" };
const bothSecrets = ["MCP_TOKEN_ENCRYPTION_KEY", "MCP_SUPABASE_CLIENT_SECRET"];
// A stateful fake checks sequencing and idempotence without accessing a live project.
function fixture(existing = false, names = bothSecrets, attributed = false) {
  let state: Record<string, unknown> | null = existing ? { ...base, enabled: false } : null;
  let receipt: Record<string, unknown> | null = attributed ? { version: 1, webOrigin: base.webOrigin, publicSupabaseUrl: base.publicSupabaseUrl, upstreamClientId: base.upstreamClientId, pending: null, completed: ["put-secrets"] } : null;
  let downstream: Record<string, unknown> | null = null;
  const client = {
    preflight: vi.fn(async () => ({ siteUrl: base.webOrigin, oauthEnabled: true, authorizationPath: "/mcp/upstream-consent", dcrEnabled: false, compatible: true, secretNames: names })),
    installation: vi.fn(async (action: string, payload: Record<string, unknown> = {}) => { if (action === "configure") state = payload; if (action === "enable") state = { ...state, ...payload }; return state; }),
    getClient: vi.fn(async (id: string) => ({ client_id: id, client_type: "confidential", token_endpoint_auth_method: "client_secret_basic", redirect_uris: [`${base.webOrigin}/api/mcp/oauth/callback`], grant_types: ["authorization_code", "refresh_token"] })),
    createClient: vi.fn(async () => ({ client_id: "created", client_secret: "one-time-secret" })),
    putSecrets: vi.fn(async (_values: Record<string, string>) => { names.push(...bothSecrets); }),
    register: vi.fn(async (payload: Record<string, unknown>) => { downstream = { id: payload.clientId, name: payload.name, redirects: payload.redirects }; return { ok: true }; }),
    downstreamClient: vi.fn(async (_id: string): Promise<Record<string, unknown> | null> => downstream)
  };
  const journal = { load: () => receipt, save: (value: Record<string, unknown>) => { receipt = structuredClone(value); } };
  return { client, journal };
}

describe("disabled-first MCP setup", () => {
  it("needs no colleague registration for owner dry-run and preserves upstream DCR off", async () => {
    const { client, journal } = fixture(true);
    const result = await setupVosioMcp(base, client, journal);
    expect(result.downstreamClientId).toBeNull(); expect(client.register).not.toHaveBeenCalled();
    expect(client.putSecrets).not.toHaveBeenCalled(); expect(client.createClient).not.toHaveBeenCalled();
    expect(client.installation.mock.calls.map(([action]) => action)).toEqual(["read"]);
    expect(journal.load()).toBeNull();
    client.preflight.mockResolvedValue({ siteUrl: base.webOrigin, oauthEnabled: true, authorizationPath: "/mcp/upstream-consent", dcrEnabled: true, compatible: true, secretNames: bothSecrets });
    await expect(setupVosioMcp(base, client, journal)).rejects.toThrow(/OAuth target/);
  });
  it("accepts only an exact localhost loopback callback for optional pre-registration", async () => {
    const { client, journal } = fixture(true);
    const downstream = { clientId: "00000000-0000-4000-8000-000000000001", name: "Claude", redirects: ["http://localhost:54321/callback"] };
    await setupVosioMcp({ ...base, mode: "apply", downstream }, client, journal);
    expect(client.register).toHaveBeenCalledWith(downstream);
    for (const redirect of ["http://localhost.example:54321/callback", "http://localhost:54321/callback?extra=1", ...["?", "#", "?#"].map((suffix) => `http://localhost:54321/callback${suffix}`), "https://host.example/callback#"]) {
      await expect(setupVosioMcp({ ...base, downstream: { ...downstream, redirects: [redirect] } }, client, journal)).rejects.toThrow(/callbacks/);
    }
  });
  it("defaults to read-only dry-run with metadata only", async () => {
    const { client, journal } = fixture();
    const report = await setupVosioMcp(base, client, journal);
    expect(report.mode).toBe("dry-run"); expect(report.enabled).toBe(false);
    expect(client.installation.mock.calls.map(([action]) => action)).toEqual(["read"]);
    expect(client.putSecrets).not.toHaveBeenCalled(); expect(client.createClient).not.toHaveBeenCalled(); expect(journal.load()).toBeNull();
  });
  it("configures disabled and reuses exact client and existing secrets on another run", async () => {
    const { client, journal } = fixture(false, bothSecrets, true);
    await setupVosioMcp({ ...base, mode: "apply" }, client, journal);
    await setupVosioMcp({ ...base, mode: "apply" }, client, journal);
    expect(client.installation.mock.calls.filter(([action]) => action === "configure")).toHaveLength(1);
    expect(client.createClient).not.toHaveBeenCalled(); expect(client.putSecrets).not.toHaveBeenCalled();
  });
  it("creates only one client and uploads exactly two secrets before configuring", async () => {
    const { client, journal } = fixture(false, []);
    const options = { ...base, upstreamClientId: undefined, mode: "apply" };
    const report = await setupVosioMcp(options, client, journal);
    expect(report.upstreamClientId).toBe("created"); expect(client.createClient).toHaveBeenCalledTimes(1);
    expect(Object.keys(client.putSecrets.mock.calls[0][0]).sort()).toEqual([...bothSecrets].sort());
    expect(JSON.stringify(journal.load())).not.toContain("one-time-secret");
    await setupVosioMcp(options, client, journal); expect(client.createClient).toHaveBeenCalledTimes(1);
  });
  it.each(["createClient", "putSecrets", "installation", "register"])("fences uncertain %s outcomes without a retry", async (operation) => {
    const { client, journal } = fixture(false, operation === "createClient" || operation === "putSecrets" ? [] : bothSecrets, operation === "installation" || operation === "register");
    const downstream = { clientId: "00000000-0000-4000-8000-000000000001", name: "Codex", redirects: ["http://127.0.0.1:54321/observed"] };
    const options = { ...base, mode: "apply", downstream, upstreamClientId: operation === "createClient" ? undefined : "upstream", secrets: { MCP_SUPABASE_CLIENT_SECRET: "secret" } };
    if (operation === "installation") client.installation.mockImplementation(async (action) => { if (action === "configure") throw new Error("lost"); return null; });
    else client[operation as "createClient"].mockRejectedValueOnce(new Error("secret response MUST NOT LEAK"));
    await expect(setupVosioMcp(options, client, journal)).rejects.toThrow(/Uncertain/);
    await expect(setupVosioMcp(options, client, journal)).rejects.toThrow(/operator must reconcile/);
    expect(JSON.stringify(journal.load())).not.toContain("MUST NOT LEAK");
  });
  it("refuses attribution based only on a supplied upstream ID and matching secret names", async () => {
    const { client, journal } = fixture();
    await expect(setupVosioMcp({ ...base, mode: "apply" }, client, journal)).rejects.toThrow(/no proven installation attribution/);
    expect(client.installation.mock.calls.map(([action]) => action)).toEqual(["read"]);
    expect(client.createClient).not.toHaveBeenCalled(); expect(client.putSecrets).not.toHaveBeenCalled();
  });
  it("registers a downstream once, verifies it and skips a matching subsequent registration", async () => {
    const { client, journal } = fixture(true);
    const downstream = { clientId: "00000000-0000-4000-8000-000000000001", name: "Codex", redirects: ["http://127.0.0.1:54321/observed"] };
    await setupVosioMcp({ ...base, mode: "apply", downstream }, client, journal);
    await setupVosioMcp({ ...base, mode: "apply", downstream }, client, journal);
    expect(client.register).toHaveBeenCalledTimes(1); expect(client.downstreamClient).toHaveBeenCalledTimes(3);
    expect(journal.load()?.pending).toBeNull();
    await expect(setupVosioMcp({ ...base, mode: "apply", downstream: { ...downstream, name: "different" } }, client, journal)).rejects.toThrow(/conflicts/);
    await expect(setupVosioMcp({ ...base, mode: "apply", downstream: { ...downstream, redirects: ["http://127.0.0.1:54322/observed"] } }, client, journal)).rejects.toThrow(/conflicts/);
    expect(client.register).toHaveBeenCalledTimes(1);
  });
  it.each(["cap", "mismatch", "transport"])("keeps downstream registration pending after %s failure", async (failure) => {
    const { client, journal } = fixture(true);
    const downstream = { clientId: "00000000-0000-4000-8000-000000000001", name: "Codex", redirects: ["http://127.0.0.1:54321/observed"] };
    if (failure === "cap") client.register.mockImplementation(async () => null as unknown as { ok: boolean });
    if (failure === "mismatch") client.downstreamClient.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: downstream.clientId, name: "wrong", redirects: downstream.redirects });
    if (failure === "transport") client.downstreamClient.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("secret raw failure"));
    await expect(setupVosioMcp({ ...base, mode: "apply", downstream }, client, journal)).rejects.toThrow(/Uncertain register-downstream/);
    expect(journal.load()?.pending).toBe("register-downstream");
    await expect(setupVosioMcp({ ...base, mode: "apply", downstream }, client, journal)).rejects.toThrow(/operator must reconcile/);
    expect(client.register).toHaveBeenCalledTimes(1); expect(JSON.stringify(journal.load())).not.toContain("secret raw failure");
  });
  it.each(["configure", "enable", "put-secrets"])("retains the %s fence when successful mutation has failed read-back", async (operation) => {
    const { client, journal } = fixture(operation === "enable", operation === "put-secrets" ? [] : bothSecrets, operation === "configure");
    const options = { ...base, mode: operation === "enable" ? "enable" : "apply", secrets: { MCP_SUPABASE_CLIENT_SECRET: "secret" } };
    if (operation === "configure") client.installation.mockImplementation(async () => null);
    if (operation === "enable") client.installation.mockImplementation(async () => ({ ...base, enabled: false }));
    if (operation === "put-secrets") client.putSecrets.mockImplementation(async () => undefined);
    await expect(setupVosioMcp(options, client, journal)).rejects.toThrow(new RegExp(`Uncertain ${operation}`));
    expect(journal.load()?.pending).toBe(operation);
    await expect(setupVosioMcp(options, client, journal)).rejects.toThrow(/operator must reconcile/);
  });
  it("requires separate activation and reads activation back", async () => {
    const { client, journal } = fixture(true);
    const result = await setupVosioMcp({ ...base, mode: "enable" }, client, journal);
    expect(result.enabled).toBe(true); expect(client.installation).toHaveBeenCalledWith("enable", { enabled: true });
    expect((await setupVosioMcp({ ...base, mode: "disable" }, client, journal)).enabled).toBe(false);
  });
  it("can disable despite OAuth, client and secret inventory drift", async () => {
    const { client, journal } = fixture(true, []);
    client.preflight.mockRejectedValue(new Error("broken Auth")); client.getClient.mockRejectedValue(new Error("missing client"));
    expect((await setupVosioMcp({ ...base, mode: "enable" }, client, journal).catch(() => null))).toBeNull();
    expect((await setupVosioMcp({ ...base, mode: "disable" }, client, journal)).enabled).toBe(false);
    expect(client.getClient).not.toHaveBeenCalled();
  });
  it("resolves only an explicit default hosted secret key, failing closed on ambiguity", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json([{ type: "secret", name: "other", api_key: "foreign" }, { type: "secret", name: "default", api_key: "selected" }]));
    expect(await hostedServiceKey(base.projectRef, "operator", fetcher)).toBe("selected");
    fetcher.mockResolvedValue(Response.json([{ type: "secret", name: "other", api_key: "foreign" }, { type: "legacy", name: "service_role", api_key: "legacy" }]));
    await expect(hostedServiceKey(base.projectRef, "operator", fetcher)).rejects.toThrow(/ambiguous/);
  });
  it("rejects OAuth drift, identity mismatch, foreign secrets and guessed callbacks", async () => {
    for (const altered of [{ siteUrl: "https://other.example" }, { dcrEnabled: true }, { compatible: false }, { secretNames: [...bothSecrets, "MCP_FOREIGN"] }]) {
      const { client, journal } = fixture(); const clean = await client.preflight(); client.preflight.mockResolvedValue({ ...clean, ...altered });
      await expect(setupVosioMcp({ ...base, mode: "apply" }, client, journal)).rejects.toThrow(); expect(client.createClient).not.toHaveBeenCalled();
    }
    const { client, journal } = fixture();
    await expect(setupVosioMcp({ ...base, publicSupabaseUrl: "https://other.example" }, client, journal)).rejects.toThrow(/differ/);
    await expect(setupVosioMcp({ ...base, downstream: { clientId: "00000000-0000-4000-8000-000000000001", name: "Codex", redirects: ["http://localhost.example:123/callback"] } }, client, journal)).rejects.toThrow(/loopback/);
  });
  it("requires self-hosted operator compatibility and installed secrets", async () => {
    const { client, journal } = fixture(false, []);
    await expect(setupVosioMcp({ ...base, selfHosted: true, mode: "apply" }, client, journal)).rejects.toThrow(/not been verified/);
    expect(client.putSecrets).not.toHaveBeenCalled();
  });
  it("bootstraps self-hosted installed secrets only with independently verified exact binding and matching local values", async () => {
    const secrets = { MCP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), MCP_SUPABASE_CLIENT_SECRET: "operator-held-original-secret" };
    const secretBinding = { verified: true, verificationId: "operator/runtime-inspection-receipt", webOrigin: base.webOrigin, publicSupabaseUrl: base.publicSupabaseUrl, upstreamClientId: base.upstreamClientId, secretDigests: Object.fromEntries(Object.entries(secrets).map(([name, value]) => [name, createHash("sha256").update(value).digest("hex")])) };
    const options = { ...base, mode: "apply", selfHosted: { secretBinding }, secrets };
    const { client, journal } = fixture();
    const report = await setupVosioMcp(options, client, journal);
    expect(report.enabled).toBe(false); expect(client.installation).toHaveBeenCalledWith("configure", { webOrigin: base.webOrigin, publicSupabaseUrl: base.publicSupabaseUrl, upstreamClientId: base.upstreamClientId, enabled: false });
    expect(client.createClient).not.toHaveBeenCalled(); expect(client.putSecrets).not.toHaveBeenCalled();
    expect(JSON.stringify(journal.load())).not.toContain(secrets.MCP_SUPABASE_CLIENT_SECRET); expect(JSON.stringify(report)).not.toContain(secrets.MCP_TOKEN_ENCRYPTION_KEY);
    for (const invalid of [
      { ...options, secrets: undefined },
      { ...options, secrets: { ...secrets, MCP_SUPABASE_CLIENT_SECRET: "wrong" } },
      { ...options, selfHosted: { secretBinding: { ...secretBinding, verified: false } } },
      { ...options, selfHosted: { secretBinding: { ...secretBinding, verificationId: "" } } },
      { ...options, selfHosted: { secretBinding: { ...secretBinding, webOrigin: "https://foreign.example" } } },
      { ...options, selfHosted: { secretBinding: { ...secretBinding, publicSupabaseUrl: "https://foreign.example" } } },
      { ...options, selfHosted: { secretBinding: { ...secretBinding, upstreamClientId: "foreign" } } },
      { ...options, selfHosted: { secretBinding: { ...secretBinding, secretDigests: {} } } }
    ]) {
      const isolated = fixture();
      await expect(setupVosioMcp(invalid, isolated.client, isolated.journal)).rejects.toThrow(/no proven installation attribution/);
      expect(isolated.client.installation.mock.calls.map(([action]) => action)).toEqual(["read"]);
    }
  });
  it("uses service-only RPC, bounded transport and never follows redirects", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("null", { headers: { "Content-Type": "application/json" } }));
    const client = createSetupClient({ ...base, serviceKey: "private" }, fetcher);
    await client.installation("read");
    expect(fetcher.mock.calls[0][0]).toBe(`${base.publicSupabaseUrl}/rest/v1/rpc/mcp_installation_v1`);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("error"); expect(fetcher.mock.calls[0][1]?.body).toContain('"p_action":"read"');
    expect(() => createSetupClient({ ...base, serviceKey: "private", serviceUrl: "https://foreign.example" }, fetcher)).toThrow(/must equal/);
  });
  it("locks a private receipt against concurrent or interrupted mutations", () => {
    mkdirSync(".tmp", { recursive: true });
    const directory = mkdtempSync(resolve(".tmp/setup-lock-"));
    if (!directory.startsWith(resolve(".tmp") + sep)) throw new Error("Unsafe cleanup path");
    try {
      const first = receiptStore(resolve(directory, "receipt.json")); const second = receiptStore(resolve(directory, "receipt.json"));
      first.acquire(); expect(() => second.acquire()).toThrow(/locked/);
      first.save({ pending: "create-client", upstreamClientId: null }); first.release();
      second.acquire(); expect(second.load()).toEqual({ pending: "create-client", upstreamClientId: null }); second.release();
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
  it.each(["https://user:pass@web.example", "https://web.example/", "http://web.example", "https://web.example?x=1"])("rejects unsafe origin %s", (value) => expect(() => setupOrigin(value)).toThrow());
});
