import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, DENO_DIR: process.env.DENO_DIR || resolve(root, ".tmp/deno"), ...(process.platform === "win32" && !process.env.DENO_TLS_CA_STORE ? { DENO_TLS_CA_STORE: "system" } : {}) };
// Preserve the first failed step; package, check and execute the same pinned Edge graph.
for (const [command, args] of [[process.execPath, ["scripts/build-mcp-edge.mjs"]], ["deno", ["task", "--config", "supabase/functions/vosio-mcp/deno.json", "check"]], ["deno", ["task", "--config", "supabase/functions/vosio-mcp/deno.json", "test"]]]) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
