import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("refuses to overwrite an existing cleanup manifest before making any database request", () => {
  const directory = mkdtempSync(join(tmpdir(), "vosio-automatic-proof-"));
  const manifest = join(directory, "manifest.json");
  const content = "unresolved synthetic fixture identity";
  writeFileSync(manifest, content);
  const hash = createHash("sha256").update(readFileSync("supabase/migrations/20260915170017_add_automatic_ai_outputs.sql")).digest("hex");
  try {
    const result = spawnSync(process.execPath, ["scripts/verify-automatic-ai-outputs.mjs", "--approved-synthetic-db-verification",
      "--target", "abcdefghijklmnopqrst", "--mode", "rehearse", "--manifest", manifest, "--migration-sha256", hash],
    { env: { ...process.env, SUPABASE_EXPECTED_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_ACCESS_TOKEN: "synthetic-noncredential" }, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("EEXIST");
    expect(readFileSync(manifest, "utf8")).toBe(content);
  } finally { rmSync(directory, { recursive: true }); }
});
