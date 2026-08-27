const MAX_BATCH_SIZE = 20;
const WORKER_CONCURRENCY = 2;
const STORAGE_REMOVE_BATCH_SIZE = 100;
const STORAGE_LATE_CLEANUP_ROUNDS = 2;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type TrashRetentionClaim = {
  claimId: string;
  id: string;
  storagePath: string | null;
  userId: string;
};

export type TrashRetentionAdapter = {
  claimDue: (limit: number) => Promise<TrashRetentionClaim[]>;
  finalizeClaim: (claim: TrashRetentionClaim) => Promise<boolean>;
  listObjects: (prefix: string) => Promise<string[]>;
  refreshClaim: (claim: TrashRetentionClaim) => Promise<boolean>;
  releaseClaim: (claim: TrashRetentionClaim) => Promise<boolean>;
  removeObjects: (paths: string[]) => Promise<void>;
};

type TrashRetentionCode =
  | "claim_lost"
  | "path_rejected"
  | "storage_failed"
  | "storage_incomplete";

type TrashRetentionResult = {
  code?: TrashRetentionCode;
  ok: boolean;
};

type TrashRetentionSummary = {
  claimed: number;
  codes: Partial<Record<TrashRetentionCode, number>>;
  failed: number;
  status: "completed";
  succeeded: number;
};

type TrashRetentionHandlerOptions = {
  adapter: TrashRetentionAdapter | null;
  env: (name: string) => string | undefined;
  logger?: (event: string, summary: TrashRetentionSummary) => void;
};

type SupabaseAdapterOptions = {
  fetchImpl?: typeof fetch;
  serviceRoleKey: string;
  supabaseUrl: string;
};

class ClaimLostError extends Error {}
class PathRejectedError extends Error {}

// jsonResponse returns a no-store JSON response with only caller-supplied sanitized data.
function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    },
    status
  });
}

// getBearerToken accepts exactly one nonblank Bearer credential.
function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/u);
  return match?.[1] ?? null;
}

// tokensMatch compares opaque credentials through fixed-length SHA-256 digests.
async function tokensMatch(expected: string, received: string | null) {
  if (!expected || !received) return false;
  const encoder = new TextEncoder();
  const [expectedDigest, receivedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(received))
  ]);
  const left = new Uint8Array(expectedDigest);
  const right = new Uint8Array(receivedDigest);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index % right.length]!;
  }
  return difference === 0;
}

// getCanonicalPrefix validates the immutable claim and its optional Storage locator.
function getCanonicalPrefix(claim: TrashRetentionClaim) {
  if (!UUID_PATTERN.test(claim.id) || !UUID_PATTERN.test(claim.userId) || !UUID_PATTERN.test(claim.claimId)) {
    return null;
  }
  const prefix = `${claim.userId}/${claim.id}/`;
  if (claim.storagePath === null) return prefix;
  if (
    !claim.storagePath.startsWith(prefix)
    || claim.storagePath === prefix
    || claim.storagePath.includes("\\")
    || claim.storagePath.includes("//")
  ) {
    return null;
  }
  const segments = claim.storagePath.slice(prefix.length).split("/").filter(Boolean);
  return segments.length > 0 && segments.every((segment) => segment !== "." && segment !== "..")
    ? prefix
    : null;
}

// validateListedObjects rejects any Storage API response that escapes the claimed prefix.
function validateListedObjects(prefix: string, paths: string[]) {
  if (paths.some((path) => (
    !path.startsWith(prefix)
    || path.includes("\\")
    || path.includes("//")
    || path.slice(prefix.length).split("/").some((segment) => segment === "." || segment === "..")
  ))) {
    throw new PathRejectedError();
  }
}

// releaseForRetry releases only a pre-mutation exact lease and keeps release errors private.
async function releaseForRetry(adapter: TrashRetentionAdapter, claim: TrashRetentionClaim) {
  try {
    await adapter.releaseClaim(claim);
  } catch {
    return false;
  }
  return true;
}

// processClaim removes exact Storage objects, confirms emptiness and finalizes only its own live lease.
async function processClaim(
  adapter: TrashRetentionAdapter,
  claim: TrashRetentionClaim
): Promise<TrashRetentionResult> {
  const prefix = getCanonicalPrefix(claim);
  if (!prefix) {
    await releaseForRetry(adapter, claim);
    return { code: "path_rejected", ok: false };
  }

  let storageMutationStarted = false;

  try {
    if (!await adapter.refreshClaim(claim)) throw new ClaimLostError();
    let objects = await adapter.listObjects(prefix);
    validateListedObjects(prefix, objects);

    for (let round = 0; round <= STORAGE_LATE_CLEANUP_ROUNDS && objects.length > 0; round += 1) {
      for (let offset = 0; offset < objects.length; offset += STORAGE_REMOVE_BATCH_SIZE) {
        if (!await adapter.refreshClaim(claim)) throw new ClaimLostError();
        storageMutationStarted = true;
        await adapter.removeObjects(objects.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE));
      }
      objects = await adapter.listObjects(prefix);
      validateListedObjects(prefix, objects);
    }

    if (objects.length > 0) {
      return { code: "storage_incomplete", ok: false };
    }
    if (!await adapter.refreshClaim(claim)) throw new ClaimLostError();
    if (!await adapter.finalizeClaim(claim)) throw new ClaimLostError();
    return { ok: true };
  } catch (error) {
    if (error instanceof ClaimLostError) return { code: "claim_lost", ok: false };
    if (!storageMutationStarted) await releaseForRetry(adapter, claim);
    return {
      code: error instanceof PathRejectedError ? "path_rejected" : "storage_failed",
      ok: false
    };
  }
}

// runWithTwoWorkers drains one bounded claim array with exactly two worker loops when possible.
async function runWithTwoWorkers(
  claims: TrashRetentionClaim[],
  process: (claim: TrashRetentionClaim) => Promise<TrashRetentionResult>
) {
  const results = new Array<TrashRetentionResult>(claims.length);
  let cursor = 0;

  // worker takes the next untouched item and never shares per-item state with its sibling.
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= claims.length) return;
      results[index] = await process(claims[index]!);
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(WORKER_CONCURRENCY, claims.length) },
    () => worker()
  ));
  return results;
}

// createTrashRetentionHandler builds the scheduler-only fail-closed Edge request boundary.
export function createTrashRetentionHandler(options: TrashRetentionHandlerOptions) {
  return async function handleTrashRetentionRequest(request: Request) {
    if (request.method !== "POST") return jsonResponse({ status: "method_not_allowed" }, 405);

    const schedulerToken = options.env("TRASH_RETENTION_SCHEDULER_TOKEN") ?? "";
    if (!schedulerToken) return jsonResponse({ claimed: 0, status: "misconfigured" }, 503);
    if (!await tokensMatch(schedulerToken, getBearerToken(request))) {
      return jsonResponse({ claimed: 0, status: "unauthorized" }, 401);
    }
    if (options.env("TRASH_RETENTION_ENABLED") !== "true") {
      return jsonResponse({ claimed: 0, status: "disabled" });
    }
    if (!options.adapter) return jsonResponse({ claimed: 0, status: "misconfigured" }, 503);

    let claims: TrashRetentionClaim[];
    try {
      claims = (await options.adapter.claimDue(MAX_BATCH_SIZE)).slice(0, MAX_BATCH_SIZE);
    } catch {
      return jsonResponse({ claimed: 0, status: "claim_failed" }, 503);
    }

    const results = await runWithTwoWorkers(
      claims,
      (claim) => processClaim(options.adapter!, claim)
    );
    const summary: TrashRetentionSummary = {
      claimed: claims.length,
      codes: {},
      failed: 0,
      status: "completed",
      succeeded: 0
    };
    for (const result of results) {
      if (result.ok) {
        summary.succeeded += 1;
      } else {
        summary.failed += 1;
        if (result.code) summary.codes[result.code] = (summary.codes[result.code] ?? 0) + 1;
      }
    }
    options.logger?.("trash_retention_summary", summary);
    return jsonResponse(summary);
  };
}

// createSupabaseTrashRetentionAdapter binds the worker to PostgREST RPCs and the Storage object API.
export function createSupabaseTrashRetentionAdapter(
  options: SupabaseAdapterOptions
): TrashRetentionAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.supabaseUrl.replace(/\/+$/u, "");
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json"
  };

  // requestJson performs one authenticated Supabase request without exposing response detail.
  async function requestJson(path: string, init: RequestInit) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...init.headers }
    });
    if (!response.ok) throw new Error("Supabase operation failed");
    return response.json() as Promise<unknown>;
  }

  // callBooleanRpc invokes a lease RPC and accepts only an explicit true result.
  async function callBooleanRpc(name: string, claim: TrashRetentionClaim) {
    const result = await requestJson(`/rest/v1/rpc/${name}`, {
      body: JSON.stringify({ p_claim_id: claim.claimId, p_recording_id: claim.id }),
      method: "POST"
    });
    return result === true;
  }

  // listFolder recursively resolves exact object paths through the Storage API.
  async function listFolder(prefix: string): Promise<string[]> {
    const objects: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await requestJson("/storage/v1/object/list/recordings", {
        body: JSON.stringify({
          limit: 1000,
          offset,
          prefix,
          sortBy: { column: "name", order: "asc" }
        }),
        method: "POST"
      });
      if (!Array.isArray(result)) throw new Error("Storage operation failed");
      for (const entry of result) {
        if (!entry || typeof entry !== "object" || typeof (entry as { name?: unknown }).name !== "string") {
          throw new Error("Storage operation failed");
        }
        const item = entry as { id?: unknown; name: string };
        const path = `${prefix}${item.name}`;
        if (item.id === null) objects.push(...await listFolder(`${path}/`));
        else objects.push(path);
      }
      if (result.length < 1000) break;
    }
    return objects;
  }

  return {
    // claimDue obtains only the database-bounded due set and maps its private fields in memory.
    async claimDue(limit) {
      const result = await requestJson("/rest/v1/rpc/claim_due_recording_purges_v1", {
        body: JSON.stringify({ p_limit: Math.min(MAX_BATCH_SIZE, Math.max(0, limit)) }),
        method: "POST"
      });
      if (!Array.isArray(result)) throw new Error("Claim operation failed");
      return result.map((row) => {
        if (!row || typeof row !== "object") throw new Error("Claim operation failed");
        const value = row as Record<string, unknown>;
        return {
          claimId: String(value.purge_claim_id ?? ""),
          id: String(value.id ?? ""),
          storagePath: value.storage_path === null ? null : String(value.storage_path ?? ""),
          userId: String(value.user_id ?? "")
        };
      });
    },
    // finalizeClaim asks Postgres to delete only the still-owned lease row.
    finalizeClaim: (claim) => callBooleanRpc("finalize_recording_purge_v1", claim),
    // listObjects traverses one canonical recording prefix without direct storage-schema SQL.
    listObjects: (prefix) => listFolder(prefix),
    // refreshClaim heartbeats only the exact current lease.
    refreshClaim: (claim) => callBooleanRpc("refresh_recording_purge_claim_v1", claim),
    // releaseClaim makes a retryable row available without changing its attempt count.
    releaseClaim: (claim) => callBooleanRpc("release_recording_purge_claim_v1", claim),
    // removeObjects deletes only explicitly listed object paths through the Storage API.
    async removeObjects(paths) {
      await requestJson("/storage/v1/object/recordings", {
        body: JSON.stringify({ prefixes: paths }),
        method: "DELETE"
      });
    }
  };
}
