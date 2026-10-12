import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { discoverInstallation, readInstallation, validateWebOrigin } from "../../plugins/vosio/scripts/discover.mjs";

// Represent two independent deployments whose public metadata is never a credential.
function metadata(web = "https://first.example", resource = "https://first-backend.example/functions/v1/vosio-mcp") {
  return { issuer: web, authorization_endpoint: `${web}/api/mcp/oauth/authorize`, token_endpoint: `${resource}/oauth/token`, registration_endpoint: `${resource}/oauth/register`, revocation_endpoint: `${resource}/oauth/revoke`, code_challenge_methods_supported: ["S256"] };
}

describe("public installation-neutral Vosio plugin", () => {
  it("discovers two separate native server entries without storing installation data in the package", () => {
    const first = readInstallation("https://first.example", metadata());
    const second = readInstallation("https://second.example", metadata("https://second.example", "https://second-backend.example/functions/v1/vosio-mcp"));
    expect(first).toMatchObject({ webOrigin: "https://first.example", mcpUrl: "https://first-backend.example/functions/v1/vosio-mcp" });
    expect(first.serverName).toMatch(/^vosio-[a-f0-9]{16}$/);
    expect(second.serverName).not.toBe(first.serverName);
    expect(readInstallation("https://first.example", metadata())).toEqual(first);
  });

  it.each(["", "http://first.example", "https://first.example/", "https://user:pass@first.example", "https://first.example/path", "https://first.example?", "https://first.example#", "https://first.example\\path", " https://first.example", "https://FIRST.example"]) ("rejects an unsafe or ambiguous web origin %s before fetching", async (origin) => {
    const fetcher = vi.fn();
    expect(() => validateWebOrigin(origin)).toThrow();
    await expect(discoverInstallation(origin, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { issuer: "https://other.example" },
    { authorization_endpoint: "https://other.example/api/mcp/oauth/authorize" },
    { token_endpoint: "http://first-backend.example/functions/v1/vosio-mcp/oauth/token" },
    { token_endpoint: "https://user:pass@first-backend.example/functions/v1/vosio-mcp/oauth/token" },
    { token_endpoint: "https://first-backend.example/functions/v1/vosio-mcp/oauth/token?token=x" },
    { token_endpoint: "https://first-backend.example/functions/v1/vosio-mcp/oauth/token#" },
    { token_endpoint: "https://first-backend.example/api/mcp/oauth/token" },
    { token_endpoint: "https://first-backend.example/functions/v1/vosio-mcp/oauth/token/" },
    { registration_endpoint: undefined },
    { registration_endpoint: "https://other.example/oauth/register" },
    { revocation_endpoint: "https://other.example/oauth/revoke" },
    { code_challenge_methods_supported: ["plain"] }
  ])("rejects cross-installation or incompatible discovery %#", (override) => {
    expect(() => readInstallation("https://first.example", { ...metadata(), ...override })).toThrow();
  });

  it("fetches only selected public metadata without cookies or redirects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(metadata()));
    expect(await discoverInstallation("https://first.example", fetcher)).toEqual(readInstallation("https://first.example", metadata()));
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://first.example/.well-known/oauth-authorization-server", expect.objectContaining({ redirect: "error", credentials: "omit", headers: { Accept: "application/json" }, signal: expect.any(AbortSignal) }));
  });

  it("reports disabled discovery without trying another installation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    await expect(discoverInstallation("https://first.example", fetcher)).rejects.toThrow("MCP není");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized or malformed metadata and network failures", async () => {
    for (const body of ["x".repeat(16001), "not json", "null"]) {
      await expect(discoverInstallation("https://first.example", vi.fn().mockResolvedValue(new Response(body)))).rejects.toThrow();
    }
    const fetcher = vi.fn().mockRejectedValue(new Error("Redirect not allowed"));
    await expect(discoverInstallation("https://first.example", fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("ships a runnable onboarding skill and no bundled target or private source reference", () => {
    const root = resolve("plugins/vosio");
    const manifest = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8"));
    const overlay = JSON.parse(readFileSync(resolve(root, ".codex-plugin/plugin.json"), "utf8"));
    const catalog = JSON.parse(readFileSync(resolve(".agents/plugins/marketplace.json"), "utf8"));
    expect(manifest.extensions["com.openai"].onboardingSkill).toBe("./skills/setup/SKILL.md");
    expect(overlay.version).toBe(manifest.version);
    expect(catalog.plugins[0].source.path).toBe("./plugins/vosio");
    expect(readdirSync(resolve(root, "skills")).sort()).toEqual(["edit-recording", "find-recordings", "review-tasks", "setup"]);
    const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => readFileSync(resolve(entry.parentPath, entry.name), "utf8")).join("\n");
    expect(files).not.toMatch(/https:\/\/[a-z0-9]+\.supabase\.co|vosio-app\.vercel\.app|88barcode88\/vosio-app|client_secret|service_role/);
    expect(manifest).not.toHaveProperty("mcpServers");
    expect(overlay).not.toHaveProperty("mcpServers");
  });
});
