import { describe, expect, it } from "vitest";
import {
  createInitialSaveActionState,
  createSaveError,
  createSaveSuccess,
  initialSaveActionState
} from "@/lib/forms/save-action-state";

describe("save action state", () => {
  it("creates a fresh idle state", () => {
    const state = createInitialSaveActionState();

    expect(state).toEqual({
      message: null,
      revision: 0,
      scopeKey: null,
      status: "idle"
    });
    expect(state).not.toBe(initialSaveActionState);
  });

  it("creates a success settlement for the next revision", () => {
    expect(createSaveSuccess(4, "recording-a", "Název byl uložen.")).toEqual({
      message: "Název byl uložen.",
      revision: 5,
      scopeKey: "recording-a",
      status: "success"
    });
  });

  it("creates an error settlement for the next revision", () => {
    expect(createSaveError(4, "recording-a", "Název se nepodařilo uložit.")).toEqual({
      message: "Název se nepodařilo uložit.",
      revision: 5,
      scopeKey: "recording-a",
      status: "error"
    });
  });
});
