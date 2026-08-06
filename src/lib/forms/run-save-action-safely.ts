import { createSaveError, type SaveActionState } from "@/lib/forms/save-action-state";

const interruptedConnectionMessage =
  "Spojení se přerušilo. Zkontrolujte připojení a zkuste uložit znovu.";

// Settles transport failures as scoped save errors instead of rejected promises.
export async function runSaveActionSafely(
  action: (state: SaveActionState, formData: FormData) => Promise<SaveActionState>,
  previousState: SaveActionState,
  formData: FormData,
  scopeKey: string
): Promise<SaveActionState> {
  try {
    return await action(previousState, formData);
  } catch {
    return createSaveError(previousState.revision, scopeKey, interruptedConnectionMessage);
  }
}
