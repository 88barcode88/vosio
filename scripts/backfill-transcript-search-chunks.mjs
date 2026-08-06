import { createClient } from "@supabase/supabase-js";
import console from "node:console";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_BATCH_SIZE = 500;
const DEFAULT_BATCH_SIZE = 100;
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = dirname(dirname(scriptPath));

// parseBackfillArguments validates bounded batches and explicit environment safety flags.
export function parseBackfillArguments(args) {
  const dryRun = args.includes("--dry-run");
  const allowLive = args.includes("--allow-live");
  const environmentValue = args.find((arg) => arg.startsWith("--environment="))?.split("=", 2)[1];
  const batchValue = args.find((arg) => arg.startsWith("--batch-size="))?.split("=", 2)[1];
  const batchSize = batchValue === undefined ? DEFAULT_BATCH_SIZE : Number(batchValue);

  if (environmentValue !== "disposable" && environmentValue !== "live") {
    throw new Error("Use --environment=disposable or --environment=live");
  }

  if (environmentValue === "live" && !allowLive) {
    throw new Error("Live backfill requires --allow-live");
  }

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`Batch size must be an integer from 1 to ${MAX_BATCH_SIZE}`);
  }

  return { allowLive, batchSize, dryRun, environment: environmentValue };
}

// getBackfillExitCode makes any partial batch visible to automation.
export function getBackfillExitCode(summary) {
  return summary.failed > 0 ? 1 : 0;
}

// runTranscriptSearchBackfill processes deterministic keyset pages without logging row data.
export async function runTranscriptSearchBackfill(input) {
  const summary = { batches: 0, failed: 0, indexed: 0, planned: 0, scanned: 0 };
  let cursor = null;

  while (true) {
    const transcripts = await input.fetchBatch(cursor, input.batchSize);

    if (transcripts.length === 0) {
      return summary;
    }

    summary.batches += 1;
    summary.scanned += transcripts.length;
    summary.planned += transcripts.length;

    for (const transcript of transcripts) {
      const chunks = input.buildChunks(transcript);

      if (input.dryRun) {
        continue;
      }

      try {
        await input.replaceChunks(transcript, chunks);
        summary.indexed += 1;
      } catch {
        summary.failed += 1;
      }
    }

    const nextCursor = transcripts.at(-1)?.id ?? null;

    if (!nextCursor || nextCursor === cursor) {
      throw new Error("Backfill keyset cursor did not advance");
    }

    cursor = nextCursor;
  }
}

// loadTranscriptChunkBuilder reuses the application TypeScript implementation under Node 24.
async function loadTranscriptChunkBuilder() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        return {
          shortCircuit: true,
          url: pathToFileURL(join(projectRoot, "src", `${specifier.slice(2)}.ts`)).href
        };
      }

      return nextResolve(specifier, context);
    }
  });

  const moduleUrl = pathToFileURL(join(projectRoot, "src", "lib", "transcripts", "search-chunks.ts")).href;
  const module = await import(moduleUrl);

  return module.buildTranscriptSearchChunks;
}

// createBatchFetcher loads bounded transcript rows using the primary-key UUID as a stable keyset.
function createBatchFetcher(client) {
  return async (cursor, batchSize) => {
    let query = client
      .from("transcripts")
      .select("id,recording_id,user_id,raw_text,segments,speakers")
      .order("id", { ascending: true })
      .limit(batchSize);

    if (cursor) {
      query = query.gt("id", cursor);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error("Unable to load transcript backfill batch");
    }

    return data ?? [];
  };
}

// createChunkReplacer invokes the atomic service-only RPC for one transcript.
function createChunkReplacer(client) {
  return async (transcript, chunks) => {
    const { error } = await client.rpc("replace_transcript_search_chunks_v1", {
      p_chunks: chunks.map((chunk) => ({
        end_ms: chunk.endMs,
        position: chunk.position,
        speaker_label: chunk.speakerLabel,
        start_ms: chunk.startMs,
        text: chunk.text
      })),
      p_transcript_id: transcript.id
    });

    if (error) {
      throw new Error("Unable to replace transcript search chunks");
    }
  };
}

// main runs only for an explicit direct script invocation with service credentials.
async function main() {
  const options = parseBackfillArguments(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const buildTranscriptSearchChunks = await loadTranscriptChunkBuilder();
  const summary = await runTranscriptSearchBackfill({
    batchSize: options.batchSize,
    buildChunks: (transcript) => buildTranscriptSearchChunks({
      rawText: transcript.raw_text,
      segments: transcript.segments,
      speakers: transcript.speakers
    }),
    dryRun: options.dryRun,
    fetchBatch: createBatchFetcher(client),
    replaceChunks: createChunkReplacer(client)
  });

  console.info(
    `[Vosio search backfill] batches=${summary.batches} scanned=${summary.scanned} `
    + `planned=${summary.planned} indexed=${summary.indexed} failed=${summary.failed} dryRun=${options.dryRun}`
  );
  process.exitCode = getBackfillExitCode(summary);
}

if (process.argv[1] && scriptPath === resolve(process.argv[1])) {
  main().catch(() => {
    console.error("[Vosio search backfill] failed");
    process.exitCode = 1;
  });
}
