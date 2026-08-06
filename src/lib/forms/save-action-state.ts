export type SaveActionState = {
  message: string | null;
  revision: number;
  scopeKey: string | null;
  status: "idle" | "success" | "error";
};

export type SaveAction = (
  state: SaveActionState,
  formData: FormData
) => Promise<SaveActionState>;

export const initialSaveActionState: SaveActionState = {
  message: null,
  revision: 0,
  scopeKey: null,
  status: "idle"
};

// Creates an independent initial state for each save-action consumer.
export function createInitialSaveActionState(): SaveActionState {
  return { ...initialSaveActionState };
}

// Records a successful save as the next settlement revision for its scope.
export function createSaveSuccess(
  revision: number,
  scopeKey: string,
  message: string
): SaveActionState {
  return { message, revision: revision + 1, scopeKey, status: "success" };
}

// Records a failed save as the next settlement revision without losing its scope.
export function createSaveError(
  revision: number,
  scopeKey: string | null,
  message: string
): SaveActionState {
  return { message, revision: revision + 1, scopeKey, status: "error" };
}
