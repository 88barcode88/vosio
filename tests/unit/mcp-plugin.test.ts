import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { buildVosioPlugin, validatePluginEndpoint } from "../../scripts/build-vosio-plugin.mjs";
const outputPaths: string[] = [];
// Track only exclusive task-created bundle directories under the verified project temp root.
function bundle(url: string, name: string, format: "portable" | "codex" = "portable") {
  const publicClientId = name === "vosio-second" ? "00000000-0000-4000-8000-000000000002" : "00000000-0000-4000-8000-000000000001";
  const output = buildVosioPlugin({ url, webOrigin: "https://web.example", publicClientId, callbackUrl: `http://127.0.0.1/observed-${name}`, name, format, out: `.tmp/plugins/proof-${randomUUID()}` });
  outputPaths.push(output); return output;
}
afterAll(() => { for (const path of outputPaths) { if (!path.startsWith(resolve(".tmp/plugins") + sep)) throw new Error("Unsafe cleanup path"); rmSync(path, { recursive: true }); } });
describe("private per-installation plugin", () => {
  it.each(["", "http://example.test/functions/v1/vosio-mcp", "https://user:pass@example.test/functions/v1/vosio-mcp", "https://example.test/functions/v1/vosio-mcp?token=x", "https://example.test/functions/v1/vosio-mcp#x", "https://example.test/other", "https://example.test/functions/v1/vosio-mcp/", "https://example.test\\api\\mcp"]) ("rejects unsafe or unconfigured endpoint %s", (url) => { expect(() => validatePluginEndpoint(url)).toThrow(); });
  it("generates isolated portable and Codex packages with one literal target and three skills", () => {
    const first = bundle("https://first.example/functions/v1/vosio-mcp", "vosio-first");
    const second = bundle("https://second.example/functions/v1/vosio-mcp", "vosio-second", "codex");
    const read = (root: string, path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
    expect(read(first, "plugins/vosio-first/mcp.json").mcpServers).toEqual({ "vosio-first": { type: "streamable-http", url: "https://first.example/functions/v1/vosio-mcp" } });
    expect(read(second, "plugins/vosio-second/.mcp.json").mcpServers).toEqual({ "vosio-second": { type: "http", url: "https://second.example/functions/v1/vosio-mcp", oauth: { clientId: "00000000-0000-4000-8000-000000000002", callbackUrl: "http://127.0.0.1/observed-vosio-second" } } });
    expect(read(first, "plugins/vosio-first/plugin.json").extensions["com.openai"].interface.capabilities).toEqual(["Read", "Write"]);
    expect(read(second, "plugins/vosio-second/.codex-plugin/plugin.json").mcpServers).toBe("./.mcp.json");
    const instructions = readFileSync(resolve(first, "plugins/vosio-first/README.md"), "utf8");
    expect(instructions).toContain("Tento balíček se připojuje pouze k https://first.example/functions/v1/vosio-mcp");
    expect(instructions).toContain("Instalace nevyžaduje zdroj aplikace");
    expect(instructions).toContain("https://web.example/mcp/connections");
    expect(instructions).not.toContain("https://first.example/mcp/connections");
    expect(instructions).toContain("Veřejné downstream client ID: 00000000-0000-4000-8000-000000000001");
    expect(instructions).toContain("Automatická registrace vyžaduje zapnutou a nakonfigurovanou instalaci");
    expect(instructions).toContain("codex mcp add vosio-first --url https://first.example/functions/v1/vosio-mcp --oauth-client-id 00000000-0000-4000-8000-000000000001");
    expect(instructions).toContain('callback_url = "http://127.0.0.1/observed-vosio-first"');
    expect(instructions).not.toContain("unconfigured");
    expect(readdirSync(resolve(first, "plugins/vosio-first")).sort()).toEqual(["README.md", "mcp.json", "plugin.json", "skills"]);
    expect(readdirSync(resolve(first, "plugins/vosio-first/skills")).sort()).toEqual(["edit-recording", "find-recordings", "review-tasks"]);
    expect(() => buildVosioPlugin({ format: "portable", webOrigin: "https://web.example", url: "https://first.example/functions/v1/vosio-mcp", out: first })).toThrow();
  });
  it("rejects output traversal before creating a bundle", () => {
    expect(() => buildVosioPlugin({ format: "portable", webOrigin: "https://web.example", url: "https://first.example/functions/v1/vosio-mcp", out: "../escape" })).toThrow();
    expect(() => buildVosioPlugin({ format: "portable", webOrigin: "https://web.example", url: "https://first.example/functions/v1/vosio-mcp", out: ".tmp/plugins" })).toThrow();
  });
  it("rejects legacy endpoints and noncanonical web origins", () => {
    expect(() => validatePluginEndpoint("https://first.example/api/mcp")).toThrow();
    for (const webOrigin of ["https://web.example/", "http://web.example", "https://user:pass@web.example", "https://web.example/mcp"]) {
      expect(() => buildVosioPlugin({ url: "https://first.example/functions/v1/vosio-mcp", webOrigin, out: ".tmp/plugins/invalid" })).toThrow();
    }
  });
  it("emits exact Codex OAuth listener settings with no secret fields", () => {
    const output = buildVosioPlugin({ url: "https://first.example/functions/v1/vosio-mcp", webOrigin: "https://web.example", publicClientId: "00000000-0000-4000-8000-000000000001", callbackUrl: "http://127.0.0.1:4321/exact-observed/callback-id", callbackPort: 4321, out: `.tmp/plugins/proof-${randomUUID()}` });
    outputPaths.push(output);
    const config = JSON.parse(readFileSync(resolve(output, "plugins/vosio/.mcp.json"), "utf8"));
    expect(config.mcpServers.vosio.oauth).toEqual({ clientId: "00000000-0000-4000-8000-000000000001", callbackUrl: "http://127.0.0.1:4321/exact-observed/callback-id", callbackPort: 4321 });
    expect(Object.keys(config.mcpServers.vosio).sort()).toEqual(["oauth", "type", "url"]);
    expect(readFileSync(resolve(output, "plugins/vosio/README.md"), "utf8")).toContain(".mcp.json obsahuje veřejné client ID a přesný pozorovaný callback");
  });
  it("accepts the documented CLI registration fields and defaults to a runnable Codex manifest", () => {
    const out = `.tmp/plugins/proof-${randomUUID()}`;
    const result = spawnSync(process.execPath, [resolve("scripts/build-vosio-plugin.mjs"), "--url", "https://first.example/functions/v1/vosio-mcp", "--web-origin", "https://web.example", "--public-client-id", "00000000-0000-4000-8000-000000000001", "--callback-url", "http://127.0.0.1:4321/exact-observed/callback-id", "--callback-port", "4321", "--out", out], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0); outputPaths.push(resolve(out));
    const config = JSON.parse(readFileSync(resolve(out, "plugins/vosio/.mcp.json"), "utf8"));
    expect(config.mcpServers.vosio.oauth).toEqual({ clientId: "00000000-0000-4000-8000-000000000001", callbackUrl: "http://127.0.0.1:4321/exact-observed/callback-id", callbackPort: 4321 });
  });
  it.each([
    { publicClientId: "00000000-0000-4000-8000-000000000001" }, { callbackUrl: "http://localhost/callback" },
    { publicClientId: "not-a-public-uuid", callbackUrl: "http://127.0.0.1/observed" },
    { publicClientId: "00000000-0000-4000-8000-000000000001", callbackUrl: "http://localhost/observed?extra=1" },
    ...["?", "#", "?#"].map((suffix) => ({ publicClientId: "00000000-0000-4000-8000-000000000001", callbackUrl: `http://localhost:4321/observed${suffix}`, callbackPort: 4321 })),
    { publicClientId: "00000000-0000-4000-8000-000000000001", callbackUrl: "https://remote.example/observed#" },
    { publicClientId: "00000000-0000-4000-8000-000000000001", callbackUrl: "http://127.0.0.1:4321/observed" },
    { publicClientId: "00000000-0000-4000-8000-000000000001", callbackUrl: "http://127.0.0.1:4321/observed", callbackPort: 5555 },
    { publicClientId: "00000000-0000-4000-8000-000000000001", callbackUrl: "https://remote.example/observed#x" },
    { publicClientId: "00000000-0000-4000-8000-000000000001", callbackUrl: "https://user:pass@remote.example/observed" },
    { publicClientId: "00000000-0000-4000-8000-000000000001", callbackUrl: "http://127.0.0.1/observed", callbackPort: 65536 }
  ])("rejects incomplete or unsafe Codex registration %# before generating a bundle", (oauth) => {
    const out = `.tmp/plugins/invalid-oauth-${randomUUID()}`;
    expect(() => buildVosioPlugin({ url: "https://first.example/functions/v1/vosio-mcp", webOrigin: "https://web.example", format: "codex", out, ...oauth })).toThrow();
    expect(existsSync(out)).toBe(false);
  });

  it("generates the default Codex bundle with a URL only and automatic personal login", () => {
    const out = `.tmp/plugins/proof-${randomUUID()}`;
    const result = spawnSync(process.execPath, [resolve("scripts/build-vosio-plugin.mjs"), "--url", "https://first.example/functions/v1/vosio-mcp", "--web-origin", "https://web.example", "--out", out], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0); outputPaths.push(resolve(out));
    const config = JSON.parse(readFileSync(resolve(out, "plugins/vosio/.mcp.json"), "utf8"));
    expect(config.mcpServers).toEqual({ vosio: { type: "http", url: "https://first.example/functions/v1/vosio-mcp" } });
    const instructions = readFileSync(resolve(out, "plugins/vosio/README.md"), "utf8");
    expect(instructions).toContain("není potřeba zadávat client ID, callback ani token");
    expect(instructions).toContain("claude mcp add --transport http vosio https://first.example/functions/v1/vosio-mcp");
    expect(config.mcpServers.vosio).not.toHaveProperty("oauth");
    const marketplace = JSON.parse(readFileSync(resolve(out, ".agents/plugins/marketplace.json"), "utf8"));
    expect(marketplace.plugins[0].policy.authentication).toBe("ON_INSTALL");
    expect(readdirSync(resolve(out, "plugins/vosio/skills"))).toHaveLength(3);
  });
});
