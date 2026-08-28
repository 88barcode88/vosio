import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createTrashRetentionHandler,
  type TrashRetentionAdapter,
  type TrashRetentionClaim
} from "../../supabase/functions/trash-retention/worker";

const token = "scheduler-test-token";

// createClaim builds one canonical service-role claim without PII-bearing display fields.
function createClaim(index: number, storagePath = `00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-${String(index).padStart(12, "0")}/audio.webm`): TrashRetentionClaim {
  return {
    claimId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    storagePath,
    userId: "00000000-0000-4000-8000-000000000001"
  };
}

// createAdapter supplies a complete fake boundary for claim, Storage API and settlement behavior.
function createAdapter(overrides: Partial<TrashRetentionAdapter> = {}): TrashRetentionAdapter {
  return {
    claimDue: vi.fn().mockResolvedValue([]),
    finalizeClaim: vi.fn().mockResolvedValue(true),
    listObjects: vi.fn().mockResolvedValue([]),
    refreshClaim: vi.fn().mockResolvedValue(true),
    releaseClaim: vi.fn().mockResolvedValue(true),
    removeObjects: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

// authorizedRequest carries only the opaque scheduler credential.
function authorizedRequest(value = token) {
  return new Request("https://project.functions.supabase.co/trash-retention", {
    headers: { authorization: `Bearer ${value}` },
    method: "POST"
  });
}

// createHandler installs exact environment values while keeping secrets outside assertions and logs.
function createHandler(
  adapter: TrashRetentionAdapter | null,
  enabled: string | null = "true",
  logger = vi.fn()
) {
  return createTrashRetentionHandler({
    adapter,
    env: (name) => ({
      TRASH_RETENTION_ENABLED: enabled ?? undefined,
      TRASH_RETENTION_SCHEDULER_TOKEN: token
    })[name],
    logger
  });
}

describe("Trash retention Edge Function", () => {
  it("fails closed for missing or invalid scheduler authorization", async () => {
    const adapter = createAdapter();
    const handler = createHandler(adapter);

    expect((await handler(new Request("https://project.functions.supabase.co/trash-retention", { method: "POST" }))).status).toBe(401);
    expect((await handler(authorizedRequest("wrong-token"))).status).toBe(401);
    expect(adapter.claimDue).not.toHaveBeenCalled();
  });

  it.each([null, "false", "TRUE", "1"])("performs no work unless enable is exactly true (%s)", async (enabled) => {
    const adapter = createAdapter();
    const handler = createHandler(adapter, enabled);
    const response = await handler(authorizedRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ claimed: 0, status: "disabled" });
    expect(adapter.claimDue).not.toHaveBeenCalled();
  });

  it("bounds a run to twenty claims and processes with concurrency exactly two", async () => {
    const claims = Array.from({ length: 20 }, (_, index) => createClaim(index + 1));
    let active = 0;
    let maximumActive = 0;
    const listCounts = new Map<string, number>();
    const adapter = createAdapter({
      claimDue: vi.fn().mockImplementation(async (limit) => {
        expect(limit).toBe(20);
        return claims;
      }),
      removeObjects: vi.fn().mockImplementation(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
      }),
      listObjects: vi.fn().mockImplementation(async (prefix) => {
        const count = listCounts.get(prefix) ?? 0;
        listCounts.set(prefix, count + 1);
        return count === 0 ? [`${prefix}audio.webm`] : [];
      })
    });
    const response = await createHandler(adapter)(authorizedRequest());
    const summary = await response.json();

    expect(maximumActive).toBe(2);
    expect(adapter.finalizeClaim).toHaveBeenCalledTimes(20);
    expect(summary).toMatchObject({ claimed: 20, failed: 0, succeeded: 20 });
  });

  it("releases malformed paths without touching Storage", async () => {
    const claim = createClaim(1, "foreign-user/other-recording/private.wav");
    const adapter = createAdapter({ claimDue: vi.fn().mockResolvedValue([claim]) });
    const response = await createHandler(adapter)(authorizedRequest());
    const summary = await response.json();

    expect(adapter.listObjects).not.toHaveBeenCalled();
    expect(adapter.removeObjects).not.toHaveBeenCalled();
    expect(adapter.finalizeClaim).not.toHaveBeenCalled();
    expect(adapter.releaseClaim).toHaveBeenCalledWith(claim);
    expect(summary.codes).toEqual({ path_rejected: 1 });
  });

  it("releases pre-mutation listing failures without cancelling successful siblings", async () => {
    const failed = createClaim(1);
    const succeeded = createClaim(2);
    const adapter = createAdapter({
      claimDue: vi.fn().mockResolvedValue([failed, succeeded]),
      listObjects: vi.fn().mockImplementation(async (prefix) => {
        if (prefix.split("/")[1] === failed.id) throw new Error(`private ${failed.storagePath}`);
        return [];
      })
    });
    const response = await createHandler(adapter)(authorizedRequest());
    const summary = await response.json();

    expect(adapter.releaseClaim).toHaveBeenCalledWith(failed);
    expect(adapter.finalizeClaim).toHaveBeenCalledWith(succeeded);
    expect(summary).toMatchObject({ failed: 1, succeeded: 1 });
    expect(JSON.stringify(summary)).not.toContain(failed.storagePath);
  });

  it("keeps the lease when a later remove batch fails after partial Storage mutation", async () => {
    const claim = createClaim(1);
    const paths = Array.from({ length: 101 }, (_, index) => `${claim.userId}/${claim.id}/part-${index}.webm`);
    const adapter = createAdapter({
      claimDue: vi.fn().mockResolvedValue([claim]),
      listObjects: vi.fn().mockResolvedValue(paths),
      removeObjects: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("uncertain second batch"))
    });
    const response = await createHandler(adapter)(authorizedRequest());

    expect(adapter.removeObjects).toHaveBeenCalledTimes(2);
    expect(adapter.releaseClaim).not.toHaveBeenCalled();
    expect(adapter.finalizeClaim).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ codes: { storage_failed: 1 }, failed: 1 });
  });

  it("keeps the lease when verification listing fails after a Storage mutation", async () => {
    const claim = createClaim(1);
    const prefix = `${claim.userId}/${claim.id}/`;
    const adapter = createAdapter({
      claimDue: vi.fn().mockResolvedValue([claim]),
      listObjects: vi.fn()
        .mockResolvedValueOnce([`${prefix}audio.webm`])
        .mockRejectedValueOnce(new Error("verification unavailable"))
    });
    const response = await createHandler(adapter)(authorizedRequest());

    expect(adapter.removeObjects).toHaveBeenCalledOnce();
    expect(adapter.releaseClaim).not.toHaveBeenCalled();
    expect(adapter.finalizeClaim).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ codes: { storage_failed: 1 }, failed: 1 });
  });

  it("keeps the lease when the prefix remains nonempty after bounded cleanup", async () => {
    const claim = createClaim(1);
    const remainingPath = `${claim.userId}/${claim.id}/late.webm`;
    const adapter = createAdapter({
      claimDue: vi.fn().mockResolvedValue([claim]),
      listObjects: vi.fn().mockResolvedValue([remainingPath])
    });
    const response = await createHandler(adapter)(authorizedRequest());

    expect(adapter.removeObjects).toHaveBeenCalledTimes(3);
    expect(adapter.releaseClaim).not.toHaveBeenCalled();
    expect(adapter.finalizeClaim).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ codes: { storage_incomplete: 1 }, failed: 1 });
  });

  it("never finalizes or releases another lease after claim loss", async () => {
    const claim = createClaim(1);
    const adapter = createAdapter({
      claimDue: vi.fn().mockResolvedValue([claim]),
      refreshClaim: vi.fn().mockResolvedValue(false)
    });
    const response = await createHandler(adapter)(authorizedRequest());

    expect(adapter.listObjects).not.toHaveBeenCalled();
    expect(adapter.finalizeClaim).not.toHaveBeenCalled();
    expect(adapter.releaseClaim).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ codes: { claim_lost: 1 }, failed: 1 });
  });

  it("emits only sanitized counts and codes", async () => {
    const claim = createClaim(1);
    const logger = vi.fn();
    const adapter = createAdapter({ claimDue: vi.fn().mockResolvedValue([claim]) });
    const response = await createHandler(adapter, "true", logger)(authorizedRequest());
    const responseText = await response.text();
    const logText = JSON.stringify(logger.mock.calls);

    for (const privateValue of [token, claim.id, claim.userId, claim.storagePath]) {
      expect(responseText).not.toContain(privateValue);
      expect(logText).not.toContain(privateValue);
    }
  });

  it("contains no SQL Storage deletion, schedule or Vercel integration", () => {
    const worker = readFileSync(join(process.cwd(), "supabase", "functions", "trash-retention", "worker.ts"), "utf8");
    const entrypoint = readFileSync(join(process.cwd(), "supabase", "functions", "trash-retention", "index.ts"), "utf8");
    const config = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");
    const source = `${worker}\n${entrypoint}\n${config}`.toLowerCase();

    expect(entrypoint).toContain('from "./worker.ts"');
    expect(source).toContain("/storage/v1/object/");
    expect(config).toMatch(/\[functions\.trash-retention\][\s\S]*verify_jwt\s*=\s*false/u);
    expect(source).not.toMatch(/delete\s+from\s+storage\./u);
    expect(source).not.toMatch(/pg_cron|pg_net|cron\.schedule|vercel/u);
  });
});
