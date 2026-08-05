import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

type BackfillModule = {
  getBackfillExitCode: (summary: { failed: number }) => number;
  parseBackfillArguments: (args: string[]) => {
    allowLive: boolean;
    batchSize: number;
    dryRun: boolean;
    environment: "disposable" | "live";
  };
  runTranscriptSearchBackfill: (input: {
    batchSize: number;
    buildChunks: (transcript: { id: string }) => unknown[];
    dryRun: boolean;
    fetchBatch: (cursor: string | null, batchSize: number) => Promise<Array<{ id: string }>>;
    replaceChunks: (transcript: { id: string }, chunks: unknown[]) => Promise<void>;
  }) => Promise<{
    batches: number;
    failed: number;
    indexed: number;
    planned: number;
    scanned: number;
  }>;
};

const scriptPath = join(process.cwd(), "scripts", "backfill-transcript-search-chunks.mjs");

// loadBackfillModule imports orchestration helpers without executing the script entrypoint.
async function loadBackfillModule() {
  return import(pathToFileURL(scriptPath).href) as Promise<BackfillModule>;
}

describe("transcript search backfill", () => {
  it("uses bounded keyset batches and performs no mutation in dry-run mode", async () => {
    const { runTranscriptSearchBackfill } = await loadBackfillModule();
    const fetchBatch = vi.fn()
      .mockResolvedValueOnce([{ id: "a" }, { id: "b" }])
      .mockResolvedValueOnce([{ id: "c" }])
      .mockResolvedValueOnce([]);
    const replaceChunks = vi.fn();

    const summary = await runTranscriptSearchBackfill({
      batchSize: 2,
      buildChunks: (transcript) => [{ text: transcript.id }],
      dryRun: true,
      fetchBatch,
      replaceChunks
    });

    expect(fetchBatch.mock.calls).toEqual([[null, 2], ["b", 2], ["c", 2]]);
    expect(replaceChunks).not.toHaveBeenCalled();
    expect(summary).toEqual({ batches: 2, failed: 0, indexed: 0, planned: 3, scanned: 3 });
  });

  it("continues after row errors and returns a nonzero partial-batch exit code", async () => {
    const { getBackfillExitCode, runTranscriptSearchBackfill } = await loadBackfillModule();
    const replaceChunks = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("private row error"));

    const summary = await runTranscriptSearchBackfill({
      batchSize: 10,
      buildChunks: () => [],
      dryRun: false,
      fetchBatch: vi.fn()
        .mockResolvedValueOnce([{ id: "a" }, { id: "b" }])
        .mockResolvedValueOnce([]),
      replaceChunks
    });

    expect(summary).toEqual({ batches: 1, failed: 1, indexed: 1, planned: 2, scanned: 2 });
    expect(getBackfillExitCode(summary)).toBe(1);
  });

  it("requires an explicit environment and a second live-project guard", async () => {
    const { parseBackfillArguments } = await loadBackfillModule();

    expect(parseBackfillArguments([
      "--dry-run",
      "--environment=disposable",
      "--batch-size=25"
    ])).toEqual({ allowLive: false, batchSize: 25, dryRun: true, environment: "disposable" });
    expect(() => parseBackfillArguments(["--environment=live"]))
      .toThrow("Live backfill requires --allow-live");
    expect(parseBackfillArguments(["--environment=live", "--allow-live"]).allowLive).toBe(true);
  });

  it("keeps logs count-only and requires explicit Supabase service credentials", () => {
    const source = readFileSync(scriptPath, "utf8");
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["search:backfill"]).toBe(
      "node scripts/backfill-transcript-search-chunks.mjs"
    );
    expect(source).toContain("SUPABASE_URL");
    expect(source).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toMatch(/console\.(?:log|info|warn|error)\([^\n]*(?:raw_text|segments|speakers|serviceRoleKey)/);
    expect(source).toContain("buildTranscriptSearchChunks");
  });
});
