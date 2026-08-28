import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteRecordingAction,
  purgeRecordingAction,
  restoreRecordingAction
} from "@/lib/recordings/actions";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

const recordingId = "00000000-0000-4000-8000-000000000801";
const otherRecordingId = "00000000-0000-4000-8000-000000000802";
const userId = "00000000-0000-4000-8000-000000000803";

// createTrashForm builds a restore or purge payload with an optional filtered return URL.
function createTrashForm(next = "/trash", id = recordingId) {
  const formData = new FormData();
  formData.set("recordingId", id);
  formData.set("next", next);
  return formData;
}

// createQuery builds the chainable subset of Supabase used by recording trash actions.
function createQuery(result: unknown) {
  const query = {
    delete: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    lte: vi.fn(),
    maybeSingle: vi.fn(),
    neq: vi.fn(),
    or: vi.fn(),
    select: vi.fn(),
    update: vi.fn()
  };

  query.delete.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.lte.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.update.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue(result);
  query.neq.mockReturnValue(query);
  return query;
}

// arrangeUserClient installs an authenticated RLS client for one action invocation.
function arrangeUserClient(
  user: { id: string; user_metadata?: Record<string, unknown> } | null = { id: userId },
  userError: unknown = null
) {
  const getUser = vi.fn().mockResolvedValue({ data: { user }, error: userError });
  const from = vi.fn();
  mocks.createClient.mockResolvedValue({ auth: { getUser }, from });
  return { from, getUser };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  });
});

describe("deleteRecordingAction", () => {
  it.each([
    ["saved", { vosio_settings: { trashRetentionHours: 168 } }, 168],
    ["legacy", {}, 720],
    ["invalid", { vosio_settings: { trashRetentionHours: 48 } }, 720]
  ])("passes the %s sanitized retention snapshot into the database transition", async (_label, metadata, expectedHours) => {
    const { from } = arrangeUserClient({ id: userId, user_metadata: metadata });
    const update = createQuery({ data: { id: recordingId }, error: null });
    from.mockReturnValue(update);
    const formData = new FormData();
    formData.set("recordingId", recordingId);

    await deleteRecordingAction(formData);

    expect(update.update).toHaveBeenCalledWith({
      status: "deleted",
      trash_retention_hours: expectedHours
    });
    expect(update.eq).toHaveBeenCalledWith("user_id", userId);
    expect(update.neq).toHaveBeenCalledWith("status", "deleted");
  });
});

describe("restoreRecordingAction", () => {
  it("replaces a stale error on an invalid payload without dropping other URL state", async () => {
    arrangeUserClient();

    await expect(
      restoreRecordingAction(createTrashForm("/trash?kind=audio&error=old", "not-a-uuid"))
    ).rejects.toThrow("REDIRECT:/trash?kind=audio&error=invalid_restore");
    expect(mocks.createClient).not.toHaveBeenCalled();
    const redirected = new URL(mocks.redirect.mock.calls[0]![0], "https://vosio.local");
    expect(redirected.searchParams.getAll("error")).toEqual(["invalid_restore"]);
  });

  it.each([
    ["missing user", null, null],
    ["authentication error", { id: userId }, { message: "expired" }]
  ])("requires verified auth for %s", async (_label, user, userError) => {
    arrangeUserClient(user, userError);

    await expect(restoreRecordingAction(createTrashForm("/trash?kind=audio"))).rejects.toThrow(
      "REDIRECT:/login?next=%2Ftrash%3Fkind%3Daudio"
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each(["missing", "foreign"])('rejects a %s row without attempting an update', async () => {
    const { from } = arrangeUserClient();
    const lookup = createQuery({ data: null, error: null });
    from.mockReturnValue(lookup);

    await expect(restoreRecordingAction(createTrashForm("/trash?kind=audio"))).rejects.toThrow(
      "REDIRECT:/trash?kind=audio&error=restore_not_found"
    );
    expect(lookup.eq).toHaveBeenCalledWith("id", recordingId);
    expect(lookup.eq).toHaveBeenCalledWith("user_id", userId);
    expect(lookup.eq).toHaveBeenCalledWith("status", "deleted");
    expect(lookup.is).toHaveBeenCalledWith("purge_started_at", null);
    expect(lookup.is).toHaveBeenCalledWith("purge_claim_id", null);
    expect(lookup.update).not.toHaveBeenCalled();
  });

  it("restores the exact captured status through the authenticated RLS client", async () => {
    const { from } = arrangeUserClient();
    const lookup = createQuery({
      data: { deleted_from_status: "transcribing", id: recordingId },
      error: null
    });
    const update = createQuery({ data: { id: recordingId }, error: null });
    from.mockReturnValueOnce(lookup).mockReturnValueOnce(update);

    await expect(
      restoreRecordingAction(createTrashForm("/trash?kind=audio&error=old"))
    ).rejects.toThrow("REDIRECT:/trash?kind=audio");

    expect(update.update).toHaveBeenCalledWith({ status: "transcribing" });
    expect(update.eq.mock.calls).toEqual([
      ["id", recordingId],
      ["user_id", userId],
      ["status", "deleted"]
    ]);
    expect(lookup.is).toHaveBeenCalledWith("purge_started_at", null);
    expect(update.is).toHaveBeenCalledWith("purge_started_at", null);
    expect(update.is).toHaveBeenCalledWith("purge_claim_id", null);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/"],
      ["/recordings"],
      [`/recordings/${recordingId}`],
      ["/trash"]
    ]);
  });

  it("reports a strict update error while preserving existing query parameters", async () => {
    const { from } = arrangeUserClient();
    const lookup = createQuery({
      data: { deleted_from_status: "completed", id: recordingId },
      error: null
    });
    const update = createQuery({ data: null, error: { message: "private detail" } });
    from.mockReturnValueOnce(lookup).mockReturnValueOnce(update);

    await expect(
      restoreRecordingAction(createTrashForm("/trash?kind=audio&error=old"))
    ).rejects.toThrow("REDIRECT:/trash?kind=audio&error=restore_failed");
    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(mocks.redirect.mock.calls[0]![0]).not.toContain("private detail");
  });

  it("cannot restore a row after purge has claimed it", async () => {
    const { from } = arrangeUserClient();
    const lookup = createQuery({ data: null, error: null });
    from.mockReturnValue(lookup);

    await expect(restoreRecordingAction(createTrashForm())).rejects.toThrow(
      "REDIRECT:/trash?error=restore_not_found"
    );
    expect(lookup.is).toHaveBeenCalledWith("purge_started_at", null);
    expect(lookup.update).not.toHaveBeenCalled();
  });

  it("loses safely when purge claims the row between restore lookup and update", async () => {
    const { from } = arrangeUserClient();
    const lookup = createQuery({
      data: { deleted_from_status: "completed", id: recordingId },
      error: null
    });
    const update = createQuery({ data: null, error: null });
    from.mockReturnValueOnce(lookup).mockReturnValueOnce(update);

    await expect(restoreRecordingAction(createTrashForm())).rejects.toThrow(
      "REDIRECT:/trash?error=restore_failed"
    );
    expect(update.is).toHaveBeenCalledWith("purge_started_at", null);
  });
});

describe("purgeRecordingAction", () => {
  // arrangePurge installs lookup, claim, and enough ordered mutation queries for lease fencing.
  function arrangePurge(storagePath: string | null, options: {
    claimData?: { id: string; storage_path: string | null } | null;
    claimError?: unknown;
    deleteError?: unknown;
    lookupData?: {
      id: string;
      purge_claim_id?: string;
      purge_started_at?: string;
      storage_path: string | null;
    } | null;
    lookupError?: unknown;
    releaseError?: unknown;
    storageError?: unknown;
  } = {}) {
    arrangeUserClient();
    const lookup = createQuery({
      data: options.lookupData === undefined ? { id: recordingId, storage_path: storagePath } : options.lookupData,
      error: options.lookupError ?? null
    });
    const claim = createQuery({
      data: options.claimData === undefined
        ? { id: recordingId, storage_path: storagePath }
        : options.claimData,
      error: options.claimError ?? null
    });
    const mutations = Array.from({ length: 16 }, () => createQuery({
      data: { id: recordingId },
      error: null
    }));
    mutations[2]!.maybeSingle.mockResolvedValue({
      data: options.deleteError ? null : { id: recordingId },
      error: options.deleteError ?? null
    });
    const listCounts = new Map<string, number>();
    const list = vi.fn().mockImplementation(async (
      folder: string,
      listOptions?: { search?: string }
    ) => {
      const key = `${folder}|${listOptions?.search ?? ""}`;
      const count = listCounts.get(key) ?? 0;
      listCounts.set(key, count + 1);

      return {
        data: folder.endsWith("/live") && !listOptions?.search && count === 0
          ? [{ id: "storage-object-1", name: "part-1.webm" }]
          : [],
        error: null
      };
    });
    const remove = vi.fn().mockResolvedValue({ error: options.storageError ?? null });
    const storageFrom = vi.fn().mockReturnValue({ list, remove });
    const queries = [lookup, claim, ...mutations];
    const from = vi.fn().mockImplementation(() => queries.shift());
    mocks.createAdminClient.mockReturnValue({ from, storage: { from: storageFrom } });
    return {
      claim,
      from,
      list,
      lookup,
      mutations,
      remove,
      retryRelease: mutations[3]!,
      storageFrom,
      terminal: mutations[2]!
    };
  }

  it("replaces a stale error on an invalid payload without creating an admin client", async () => {
    arrangeUserClient();

    await expect(
      purgeRecordingAction(createTrashForm("/trash?kind=audio&error=old", "not-a-uuid"))
    ).rejects.toThrow("REDIRECT:/trash?kind=audio&error=invalid_purge");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed before creating an admin client when auth is missing", async () => {
    arrangeUserClient(null);

    await expect(purgeRecordingAction(createTrashForm("/trash?kind=audio"))).rejects.toThrow(
      "REDIRECT:/login?next=%2Ftrash%3Fkind%3Daudio"
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("does not mutate storage or the database for a foreign or missing row", async () => {
    const arranged = arrangePurge(null, { claimData: null, lookupData: null });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow(
      "REDIRECT:/trash?error=purge_not_found"
    );
    expect(arranged.remove).not.toHaveBeenCalled();
    expect(arranged.claim.update).not.toHaveBeenCalled();
    expect(arranged.terminal.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["same-user other-recording folder", `${userId}/${otherRecordingId}/audio.webm`],
    ["traversal segment", `${userId}/${recordingId}/../${otherRecordingId}/audio.webm`],
    ["backslash", `${userId}\\${recordingId}\\audio.webm`],
    ["empty extra path", `${userId}/${recordingId}/`]
  ])("rejects a noncanonical %s before any mutation", async (_label, storagePath) => {
    const arranged = arrangePurge(storagePath);

    await expect(
      purgeRecordingAction(createTrashForm("/trash?kind=audio&error=old"))
    ).rejects.toThrow("REDIRECT:/trash?kind=audio&error=purge_failed");
    expect(arranged.list).not.toHaveBeenCalled();
    expect(arranged.remove).not.toHaveBeenCalled();
    expect(arranged.claim.update).not.toHaveBeenCalled();
    expect(arranged.terminal.delete).not.toHaveBeenCalled();
    const redirected = new URL(mocks.redirect.mock.calls[0]![0], "https://vosio.local");
    expect(redirected.searchParams.getAll("error")).toEqual(["purge_failed"]);
  });

  it("treats only the exact canonical live folder as segmented storage", async () => {
    const canonicalLiveFolder = `${userId}/${recordingId}/live/`;
    const arranged = arrangePurge(canonicalLiveFolder);

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow("REDIRECT:/trash");
    expect(arranged.list).toHaveBeenCalledWith(
      `${userId}/${recordingId}/live`,
      expect.objectContaining({ limit: 100, offset: 0 })
    );
    expect(arranged.remove).toHaveBeenCalledWith([
      `${userId}/${recordingId}/live/part-1.webm`
    ]);
  });

  it("collects every segmented page before removing objects in bounded chunks", async () => {
    const liveFolder = `${userId}/${recordingId}/live`;
    const arranged = arrangePurge(`${liveFolder}/`);
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `object-${index}`,
      name: `part-${String(index).padStart(3, "0")}.webm`
    }));
    const secondPage = [
      { id: "object-100", name: "part-100.webm" },
      { id: "object-101", name: "part-101.webm" }
    ];
    arranged.list
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null })
      .mockResolvedValue({ data: [], error: null });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow("REDIRECT:/trash");
    expect(arranged.list).toHaveBeenCalledTimes(3);
    expect(arranged.remove).toHaveBeenCalledTimes(2);
    expect(arranged.remove.mock.calls[0]![0]).toHaveLength(100);
    expect(arranged.remove.mock.calls[1]![0]).toEqual([
      `${liveFolder}/part-100.webm`,
      `${liveFolder}/part-101.webm`
    ]);
    expect(arranged.list.mock.invocationCallOrder[1]).toBeLessThan(
      arranged.remove.mock.invocationCallOrder[0]!
    );
    expect(arranged.remove.mock.invocationCallOrder.at(-1)).toBeLessThan(
      arranged.list.mock.invocationCallOrder[2]!
    );
  });

  it("recursively collects nested folder objects before the first remove", async () => {
    const liveFolder = `${userId}/${recordingId}/live`;
    const nestedFolder = `${liveFolder}/recovered`;
    const arranged = arrangePurge(`${liveFolder}/`);
    arranged.list
      .mockResolvedValueOnce({
        data: [
          { id: "root-object", name: "root.webm" },
          { id: null, name: "recovered" }
        ],
        error: null
      })
      .mockResolvedValueOnce({
        data: [{ id: "nested-object", name: "nested.webm" }],
        error: null
      })
      .mockResolvedValue({ data: [], error: null });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow("REDIRECT:/trash");
    expect(arranged.list.mock.calls.map(([folder]) => folder)).toEqual([
      liveFolder,
      nestedFolder,
      `${userId}/${recordingId}`
    ]);
    expect(arranged.remove).toHaveBeenCalledWith([
      `${liveFolder}/root.webm`,
      `${nestedFolder}/nested.webm`
    ]);
    expect(arranged.list.mock.invocationCallOrder[1]).toBeLessThan(
      arranged.remove.mock.invocationCallOrder[0]!
    );
    expect(arranged.remove.mock.invocationCallOrder.at(-1)).toBeLessThan(
      arranged.list.mock.invocationCallOrder[2]!
    );
  });

  it("releases only its new token when a stale retry fails safely during listing", async () => {
    const liveFolder = `${userId}/${recordingId}/live`;
    const oldClaimId = "00000000-0000-4000-8000-000000000899";
    const arranged = arrangePurge(`${liveFolder}/`, {
      lookupData: {
        id: recordingId,
        purge_claim_id: oldClaimId,
        purge_started_at: "2026-08-10T00:00:00.000Z",
        storage_path: `${liveFolder}/`
      }
    });
    arranged.list.mockResolvedValue({ data: [{ id: null, name: ".." }], error: null });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow(
      "REDIRECT:/trash?error=purge_storage_failed"
    );
    expect(arranged.remove).not.toHaveBeenCalled();
    expect(arranged.mutations[0]!.update).toHaveBeenCalledWith({
      purge_claim_id: null,
      purge_started_at: null
    });
    const claimId = arranged.claim.update.mock.calls[0]![0].purge_claim_id;
    expect(arranged.claim.or).toHaveBeenCalledWith(expect.stringContaining("purge_started_at.lt."));
    expect(claimId).not.toBe(oldClaimId);
    expect(arranged.mutations[0]!.eq).toHaveBeenCalledWith("purge_claim_id", claimId);
    expect(arranged.mutations[0]!.eq).not.toHaveBeenCalledWith("purge_claim_id", oldClaimId);
  });

  it("does not touch storage when another purge holds a fresh claim", async () => {
    const arranged = arrangePurge(`${userId}/${recordingId}/audio.webm`, {
      claimData: null
    });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow(
      "REDIRECT:/trash?error=purge_in_progress"
    );
    expect(arranged.claim.or).toHaveBeenCalledWith(expect.stringContaining("purge_started_at.lt."));
    expect(arranged.remove).not.toHaveBeenCalled();
    expect(arranged.terminal.delete).not.toHaveBeenCalled();
  });

  it("rejects a recording deleted less than 24 hours ago before claim or storage mutation", async () => {
    const arranged = arrangePurge(`${userId}/${recordingId}/audio.webm`, {
      lookupData: null
    });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow(
      "REDIRECT:/trash?error=purge_too_recent"
    );
    expect(arranged.lookup.lte).toHaveBeenCalledWith("deleted_at", expect.any(String));
    expect(arranged.claim.select).toHaveBeenCalledWith("id");
    expect(arranged.claim.update).not.toHaveBeenCalled();
    expect(arranged.list).not.toHaveBeenCalled();
    expect(arranged.remove).not.toHaveBeenCalled();
  });

  it("allows the exact 24-hour boundary in both lookup and atomic claim", async () => {
    const arranged = arrangePurge(`${userId}/${recordingId}/audio.webm`);

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow("REDIRECT:/trash");
    const lookupBoundary = arranged.lookup.lte.mock.calls[0]![1];
    expect(arranged.lookup.lte).toHaveBeenCalledWith("deleted_at", lookupBoundary);
    expect(arranged.claim.lte).toHaveBeenCalledWith("deleted_at", lookupBoundary);
    expect(arranged.claim.update).toHaveBeenCalledOnce();
  });

  it("reclaims a stale claim with a new unique token and completes the retry", async () => {
    const arranged = arrangePurge(`${userId}/${recordingId}/audio.webm`);

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow("REDIRECT:/trash");
    const staleFilter = arranged.claim.or.mock.calls[0]![0] as string;
    const staleBefore = staleFilter.match(/purge_started_at\.lt\.([^,]+)/u)?.[1];
    expect(staleBefore).toBeTruthy();
    const claim = arranged.claim.update.mock.calls[0]![0];
    expect(claim.purge_claim_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(claim.purge_started_at).toMatch(/^\d{4}-\d{2}-\d{2}t/i);
    expect(Date.parse(claim.purge_started_at) - Date.parse(staleBefore!)).toBe(15 * 60 * 1000);
    expect(arranged.terminal.eq).toHaveBeenCalledWith("purge_claim_id", claim.purge_claim_id);
  });

  it("fences a stale actor that loses its token after listing and before the first remove", async () => {
    const liveFolder = `${userId}/${recordingId}/live`;
    const arranged = arrangePurge(`${liveFolder}/`);
    arranged.mutations[0]!.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow(
      "REDIRECT:/trash?error=purge_failed"
    );
    const claimId = arranged.claim.update.mock.calls[0]![0].purge_claim_id;
    expect(arranged.list).toHaveBeenCalledOnce();
    expect(arranged.mutations[0]!.update).toHaveBeenCalledWith({
      purge_started_at: expect.any(String)
    });
    expect(arranged.mutations[0]!.eq).toHaveBeenCalledWith("purge_claim_id", claimId);
    expect(arranged.mutations[0]!.eq.mock.calls).toEqual([
      ["id", recordingId],
      ["user_id", userId],
      ["status", "deleted"],
      ["purge_claim_id", claimId]
    ]);
    expect(arranged.mutations[0]!.select).toHaveBeenCalledWith("id");
    expect(arranged.mutations[0]!.maybeSingle).toHaveBeenCalledOnce();
    expect(arranged.remove).not.toHaveBeenCalled();
    expect(arranged.mutations[1]!.delete).not.toHaveBeenCalled();
    expect(arranged.mutations[1]!.update).not.toHaveBeenCalled();
    expect(arranged.list.mock.invocationCallOrder.at(-1)).toBeLessThan(
      arranged.mutations[0]!.update.mock.invocationCallOrder[0]!
    );
  });

  it("fences a stale actor between remove batches without releasing the new token", async () => {
    const liveFolder = `${userId}/${recordingId}/live`;
    const arranged = arrangePurge(`${liveFolder}/`);
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `object-${index}`,
      name: `part-${String(index).padStart(3, "0")}.webm`
    }));
    arranged.list
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: [{ id: "object-100", name: "part-100.webm" }],
        error: null
      });
    arranged.mutations[1]!.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow(
      "REDIRECT:/trash?error=purge_failed"
    );
    const claimId = arranged.claim.update.mock.calls[0]![0].purge_claim_id;
    expect(arranged.remove).toHaveBeenCalledTimes(1);
    expect(arranged.mutations[0]!.eq).toHaveBeenCalledWith("purge_claim_id", claimId);
    expect(arranged.mutations[1]!.eq).toHaveBeenCalledWith("purge_claim_id", claimId);
    expect(arranged.mutations[0]!.update.mock.invocationCallOrder[0]).toBeLessThan(
      arranged.remove.mock.invocationCallOrder[0]!
    );
    expect(arranged.remove.mock.invocationCallOrder[0]).toBeLessThan(
      arranged.mutations[1]!.update.mock.invocationCallOrder[0]!
    );
    expect(arranged.mutations[2]!.delete).not.toHaveBeenCalled();
    expect(arranged.mutations[2]!.update).not.toHaveBeenCalled();
  });

  it("stops before database deletion when storage deletion fails", async () => {
    const arranged = arrangePurge(`${userId}/${recordingId}/audio.webm`, {
      storageError: { message: "storage detail" }
    });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow(
      "REDIRECT:/trash?error=purge_storage_failed"
    );
    expect(arranged.remove).toHaveBeenCalledWith([`${userId}/${recordingId}/audio.webm`]);
    expect(arranged.terminal.delete).not.toHaveBeenCalled();
    expect(arranged.mutations[0]!.update).toHaveBeenCalledWith({
      purge_started_at: expect.any(String)
    });
    expect(arranged.terminal.update).not.toHaveBeenCalled();
  });

  it("keeps its claim when a later removal chunk fails after partial mutation", async () => {
    const liveFolder = `${userId}/${recordingId}/live`;
    const arranged = arrangePurge(`${liveFolder}/`);
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `object-${index}`,
      name: `part-${String(index).padStart(3, "0")}.webm`
    }));
    arranged.list
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: [{ id: "object-100", name: "part-100.webm" }],
        error: null
      });
    arranged.remove
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "second chunk failed" } });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow(
      "REDIRECT:/trash?error=purge_storage_failed"
    );
    expect(arranged.remove).toHaveBeenCalledTimes(2);
    expect(arranged.mutations[0]!.update).toHaveBeenCalledWith({
      purge_started_at: expect.any(String)
    });
    expect(arranged.mutations[1]!.update).toHaveBeenCalledWith({
      purge_started_at: expect.any(String)
    });
    expect(arranged.mutations[2]!.update).not.toHaveBeenCalled();
    expect(arranged.mutations[2]!.delete).not.toHaveBeenCalled();
    expect(arranged.from).toHaveBeenCalledTimes(4);
  });

  it("removes a late simple object found between initial removal and final verification", async () => {
    const storagePath = `${userId}/${recordingId}/audio.webm`;
    const arranged = arrangePurge(storagePath);
    arranged.list
      .mockResolvedValueOnce({ data: [{ id: "late-object", name: "audio.webm" }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow("REDIRECT:/trash");
    expect(arranged.remove).toHaveBeenNthCalledWith(1, [storagePath]);
    expect(arranged.remove).toHaveBeenNthCalledWith(2, [storagePath]);
    expect(arranged.list).toHaveBeenCalledTimes(2);
    expect(arranged.mutations[4]!.delete).toHaveBeenCalledOnce();
  });

  it("bounds persistent late objects, keeps the claim, and never deletes the row", async () => {
    const storagePath = `${userId}/${recordingId}/audio.webm`;
    const arranged = arrangePurge(storagePath);
    arranged.list.mockResolvedValue({
      data: [{ id: "persistent-object", name: "audio.webm" }],
      error: null
    });

    await expect(purgeRecordingAction(createTrashForm())).rejects.toThrow(
      "REDIRECT:/trash?error=purge_storage_failed"
    );
    expect(arranged.list).toHaveBeenCalledTimes(4);
    expect(arranged.remove).toHaveBeenCalledTimes(4);
    expect(arranged.mutations.some((query) => query.delete.mock.calls.length > 0)).toBe(false);
    expect(arranged.mutations.some((query) => query.update.mock.calls.some(
      ([value]) => value.purge_claim_id === null
    ))).toBe(false);
  });

  it("reports database deletion failure after canonical storage is removed", async () => {
    const arranged = arrangePurge(`${userId}/${recordingId}/audio.webm`, {
      deleteError: { message: "database detail" }
    });

    await expect(purgeRecordingAction(createTrashForm("/trash?kind=audio"))).rejects.toThrow(
      "REDIRECT:/trash?kind=audio&error=purge_failed"
    );
    expect(arranged.remove).toHaveBeenCalledOnce();
    expect(arranged.terminal.delete).toHaveBeenCalledOnce();
    expect(arranged.retryRelease.update).not.toHaveBeenCalled();
  });

  it("purges a canonical object and returns to the exact filtered URL without stale errors", async () => {
    const arranged = arrangePurge(`${userId}/${recordingId}/audio.webm`);

    await expect(
      purgeRecordingAction(createTrashForm("/trash?kind=audio&error=old"))
    ).rejects.toThrow("REDIRECT:/trash?kind=audio");
    const claim = arranged.claim.update.mock.calls[0]![0];
    expect(arranged.claim.update).toHaveBeenCalledWith({
      purge_claim_id: claim.purge_claim_id,
      purge_started_at: claim.purge_started_at
    });
    expect(arranged.terminal.eq.mock.calls).toEqual([
      ["id", recordingId],
      ["user_id", userId],
      ["status", "deleted"],
      ["purge_claim_id", claim.purge_claim_id]
    ]);
    expect(mocks.redirect).toHaveBeenCalledOnce();
  });
});
