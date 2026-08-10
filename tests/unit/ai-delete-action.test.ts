import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAiOutputAction } from "@/lib/ai/actions";

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

const outputId = "00000000-0000-4000-8000-000000000751";
const recordingId = "00000000-0000-4000-8000-000000000752";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  });
});

describe("deleteAiOutputAction expected failure redirect", () => {
  it("sets one allowlisted error and preserves existing archive filters", async () => {
    const deleteChain = {
      delete: vi.fn(), eq: vi.fn(), in: vi.fn(), select: vi.fn(), returns: vi.fn()
    };
    for (const key of ["delete", "eq", "in", "select"] as const) deleteChain[key].mockReturnValue(deleteChain);
    deleteChain.returns.mockResolvedValue({ data: [], error: { message: "private database error" } });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) }
    });
    mocks.createAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(deleteChain) });
    const formData = new FormData();
    formData.append("outputIds", outputId);
    formData.set("next", `/ai?type=summary&recording=${recordingId}&error=old-value`);

    await expect(deleteAiOutputAction(formData)).rejects.toThrow(
      `REDIRECT:/ai?type=summary&recording=${recordingId}&error=ai_output_delete_failed`
    );
    expect(mocks.redirect).toHaveBeenCalledOnce();
    const redirected = new URL(mocks.redirect.mock.calls[0]![0], "https://vosio.local");
    expect(redirected.searchParams.getAll("error")).toEqual(["ai_output_delete_failed"]);
    expect(redirected.searchParams.get("type")).toBe("summary");
    expect(redirected.searchParams.get("recording")).toBe(recordingId);
    expect(redirected.toString()).not.toContain("private database error");
  });
});
