import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  purgeRecordingMutationAction,
  restoreRecordingsBulkAction
} from "@/lib/recordings/actions";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

const ownedDeletedId = "00000000-0000-4000-8000-000000000901";
const missingId = "00000000-0000-4000-8000-000000000902";
const eligibleId = "00000000-0000-4000-8000-000000000903";
const tooRecentId = "00000000-0000-4000-8000-000000000904";
const userId = "00000000-0000-4000-8000-000000000905";

// createQuery models the chainable Supabase query subset used by trash mutations.
function createQuery(result: unknown) {
  const query = {
    delete: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    lte: vi.fn(),
    maybeSingle: vi.fn(),
    or: vi.fn(),
    select: vi.fn(),
    update: vi.fn()
  };
  for (const method of ["delete", "eq", "is", "lte", "or", "select", "update"] as const) {
    query[method].mockReturnValue(query);
  }
  query.maybeSingle.mockResolvedValue(result);
  return query;
}

// formDataWithIds builds stable repeated fields exactly as the client submits them.
function formDataWithIds(ids: string[]) {
  const formData = new FormData();
  for (const id of ids) formData.append("recordingId", id);
  return formData;
}

// arrangeUser authenticates the non-redirecting mutation actions with one fixed user.
function arrangeUser(from = vi.fn()) {
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from
  });
  return from;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("restoreRecordingsBulkAction", () => {
  it("returns stable partial results and scopes every lookup to the authenticated owner", async () => {
    const lookupOwned = createQuery({
      data: { deleted_from_status: "completed", id: ownedDeletedId },
      error: null
    });
    const updateOwned = createQuery({ data: { id: ownedDeletedId }, error: null });
    const lookupMissing = createQuery({ data: null, error: null });
    const from = arrangeUser();
    from.mockReturnValueOnce(lookupOwned).mockReturnValueOnce(updateOwned).mockReturnValueOnce(lookupMissing);

    await expect(restoreRecordingsBulkAction(formDataWithIds([ownedDeletedId, missingId])))
      .resolves.toEqual({
        failures: [{ code: "restore_not_found", id: missingId }],
        succeededIds: [ownedDeletedId]
      });
    expect(lookupOwned.eq).toHaveBeenCalledWith("user_id", userId);
    expect(lookupMissing.eq).toHaveBeenCalledWith("user_id", userId);
  });

  it("deduplicates in input order and rejects more than one hundred unique ids", async () => {
    const lookup = createQuery({
      data: { deleted_from_status: "completed", id: ownedDeletedId },
      error: null
    });
    const update = createQuery({ data: { id: ownedDeletedId }, error: null });
    const from = arrangeUser();
    from.mockReturnValueOnce(lookup).mockReturnValueOnce(update);

    await expect(restoreRecordingsBulkAction(formDataWithIds([ownedDeletedId, ownedDeletedId])))
      .resolves.toEqual({ failures: [], succeededIds: [ownedDeletedId] });
    expect(from).toHaveBeenCalledTimes(2);

    const ids = Array.from({ length: 101 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`
    );
    await expect(restoreRecordingsBulkAction(formDataWithIds(ids))).resolves.toEqual({
      failures: [{ code: "invalid_bulk", id: "bulk" }],
      succeededIds: []
    });
  });
});

describe("purgeRecordingMutationAction", () => {
  it("purges exactly one eligible user-owned item", async () => {
    arrangeUser();
    const lookup = createQuery({ data: { id: eligibleId, storage_path: null }, error: null });
    const claim = createQuery({ data: { id: eligibleId, storage_path: null }, error: null });
    const refresh = createQuery({ data: { id: eligibleId }, error: null });
    const deletion = createQuery({ data: { id: eligibleId }, error: null });
    const from = vi.fn()
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(claim)
      .mockReturnValueOnce(refresh)
      .mockReturnValueOnce(deletion);
    mocks.createAdminClient.mockReturnValue({
      from,
      storage: { from: vi.fn().mockReturnValue({ list: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
    });

    await expect(purgeRecordingMutationAction(formDataWithIds([eligibleId]))).resolves.toEqual({
      id: eligibleId,
      ok: true
    });
    expect(lookup.eq).toHaveBeenCalledWith("id", eligibleId);
    expect(lookup.eq).toHaveBeenCalledWith("user_id", userId);
  });

  it("returns a stable too-recent code without provider details", async () => {
    arrangeUser();
    const eligibleLookup = createQuery({ data: null, error: null });
    const recentLookup = createQuery({ data: { id: tooRecentId }, error: null });
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValueOnce(eligibleLookup).mockReturnValueOnce(recentLookup),
      storage: { from: vi.fn() }
    });

    await expect(purgeRecordingMutationAction(formDataWithIds([tooRecentId]))).resolves.toEqual({
      code: "purge_too_recent",
      id: tooRecentId,
      ok: false
    });
  });

  it("rejects an unsafe storage path with a sanitized failure", async () => {
    arrangeUser();
    const lookup = createQuery({
      data: { id: eligibleId, storage_path: `foreign-user/${eligibleId}/audio.webm` },
      error: null
    });
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValueOnce(lookup),
      storage: { from: vi.fn() }
    });

    const result = await purgeRecordingMutationAction(formDataWithIds([eligibleId]));
    expect(result).toEqual({ code: "purge_failed", id: eligibleId, ok: false });
    expect(JSON.stringify(result)).not.toContain("foreign-user");
  });

  it.each([[[]], [[eligibleId, tooRecentId]]])("rejects zero or multiple item ids", async (ids) => {
    await expect(purgeRecordingMutationAction(formDataWithIds(ids))).resolves.toEqual({
      code: "invalid_item",
      id: "item",
      ok: false
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
