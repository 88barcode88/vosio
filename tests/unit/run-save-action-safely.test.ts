import { describe, expect, it, vi } from "vitest";
import { createInitialSaveActionState, createSaveSuccess } from "@/lib/forms/save-action-state";
import { runSaveActionSafely } from "@/lib/forms/run-save-action-safely";

describe("runSaveActionSafely", () => {
  it("returns a server action settlement unchanged", async () => {
    const previousState = createInitialSaveActionState();
    const formData = new FormData();
    const success = createSaveSuccess(previousState.revision, "recording-a", "Uloženo.");
    const action = vi.fn(async () => success);

    await expect(
      runSaveActionSafely(action, previousState, formData, "recording-a")
    ).resolves.toBe(success);
    expect(action).toHaveBeenCalledWith(previousState, formData);
  });

  it("converts a rejected action into an error for the current scope", async () => {
    const previousState = {
      message: "Předchozí chyba.",
      revision: 8,
      scopeKey: "recording-old",
      status: "error" as const
    };
    const action = vi.fn(async () => {
      throw new Error("transport disconnected");
    });

    await expect(
      runSaveActionSafely(action, previousState, new FormData(), "recording-current")
    ).resolves.toEqual({
      message: "Spojení se přerušilo. Zkontrolujte připojení a zkuste uložit znovu.",
      revision: 9,
      scopeKey: "recording-current",
      status: "error"
    });
  });
});
