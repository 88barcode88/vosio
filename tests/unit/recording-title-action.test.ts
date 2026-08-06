import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialSaveActionState, type SaveActionState } from "@/lib/forms/save-action-state";
import { updateRecordingTitleStateAction } from "@/lib/recordings/actions";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient
}));

const recordingId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";

type QueryResult = {
  data: { id: string; title: string } | null;
  error: { message: string } | null;
};

// Creates the submitted rename payload used by action-level tests.
function createTitleForm(title = "Nový název", id = recordingId): FormData {
  const formData = new FormData();
  formData.set("recordingId", id);
  formData.set("title", title);
  return formData;
}

// Builds a chainable Supabase update query with a controlled settlement.
function createUpdateQuery(result: QueryResult | Error) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    neq: vi.fn(),
    select: vi.fn(),
    update: vi.fn()
  };

  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  if (result instanceof Error) {
    query.maybeSingle.mockRejectedValue(result);
  } else {
    query.maybeSingle.mockResolvedValue(result);
  }

  return query;
}

// Installs a request-scoped Supabase mock for one action invocation.
function arrangeSupabase({
  queryResult = { data: { id: recordingId, title: "Nový název" }, error: null },
  user = { id: userId },
  userError = null
}: {
  queryResult?: QueryResult | Error;
  user?: { id: string } | null;
  userError?: { message: string } | null;
} = {}) {
  const query = createUpdateQuery(queryResult);
  const getUser = vi.fn().mockResolvedValue({ data: { user }, error: userError });
  const from = vi.fn().mockReturnValue(query);
  mocks.createClient.mockResolvedValue({ auth: { getUser }, from });

  return { from, getUser, query };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("updateRecordingTitleStateAction", () => {
  it("returns a scoped validation error without contacting Supabase", async () => {
    const previousState = createInitialSaveActionState();

    await expect(
      updateRecordingTitleStateAction(previousState, createTitleForm("   "))
    ).resolves.toEqual({
      message: "Zkontrolujte název nahrávky.",
      revision: 1,
      scopeKey: recordingId,
      status: "error"
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["missing user", null, null],
    ["authentication error", { id: userId }, { message: "token expired" }]
  ])("returns a scoped authentication error for %s", async (_label, user, userError) => {
    arrangeSupabase({ user, userError });

    await expect(
      updateRecordingTitleStateAction(createInitialSaveActionState(), createTitleForm())
    ).resolves.toEqual({
      message: "Přihlášení vypršelo. Přihlaste se a zkuste to znovu.",
      revision: 1,
      scopeKey: recordingId,
      status: "error"
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("updates only the owned, non-deleted recording and returns success", async () => {
    const { from, query } = arrangeSupabase();
    const previousState: SaveActionState = {
      message: "Starší chyba.",
      revision: 6,
      scopeKey: recordingId,
      status: "error"
    };

    await expect(
      updateRecordingTitleStateAction(previousState, createTitleForm())
    ).resolves.toEqual({
      message: "Název byl uložen.",
      revision: 7,
      scopeKey: recordingId,
      status: "success"
    });

    expect(from).toHaveBeenCalledWith("recordings");
    expect(query.update).toHaveBeenCalledWith({ title: "Nový název" });
    expect(query.eq).toHaveBeenNthCalledWith(1, "id", recordingId);
    expect(query.eq).toHaveBeenNthCalledWith(2, "user_id", userId);
    expect(query.neq).toHaveBeenCalledWith("status", "deleted");
    expect(query.select).toHaveBeenCalledWith("id,title");
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/"],
      ["/recordings"],
      [`/recordings/${recordingId}`]
    ]);
  });

  it.each(["missing", "foreign", "deleted"])(
    "returns an error when the %s recording produces no row",
    async () => {
      arrangeSupabase({ queryResult: { data: null, error: null } });

      await expect(
        updateRecordingTitleStateAction(createInitialSaveActionState(), createTitleForm())
      ).resolves.toEqual({
        message: "Název se nepodařilo uložit.",
        revision: 1,
        scopeKey: recordingId,
        status: "error"
      });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    }
  );

  it("returns an error when Supabase rejects the update result", async () => {
    arrangeSupabase({
      queryResult: { data: null, error: { message: "permission denied" } }
    });

    await expect(
      updateRecordingTitleStateAction(createInitialSaveActionState(), createTitleForm())
    ).resolves.toEqual({
      message: "Název se nepodařilo uložit.",
      revision: 1,
      scopeKey: recordingId,
      status: "error"
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("settles a thrown authentication exception as an error", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockRejectedValue(new Error("auth unavailable")) }
    });

    await expect(
      updateRecordingTitleStateAction(createInitialSaveActionState(), createTitleForm())
    ).resolves.toEqual({
      message: "Název se nepodařilo uložit. Zkuste to znovu.",
      revision: 1,
      scopeKey: recordingId,
      status: "error"
    });
  });

  it("settles a thrown Supabase query exception as an error", async () => {
    arrangeSupabase({ queryResult: new Error("database unavailable") });

    await expect(
      updateRecordingTitleStateAction(createInitialSaveActionState(), createTitleForm())
    ).resolves.toEqual({
      message: "Název se nepodařilo uložit. Zkuste to znovu.",
      revision: 1,
      scopeKey: recordingId,
      status: "error"
    });
  });
});
