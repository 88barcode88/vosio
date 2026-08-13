import { sonioxRegionSchema, type SonioxRegion } from "@/lib/soniox/region";

export type SettingsActionState = {
  errorCode: "invalid_settings" | "save_failed" | null;
  sonioxRegion: SonioxRegion | null;
  status: "error" | "idle" | "saved";
};

export const idleSettingsActionState: SettingsActionState = {
  errorCode: null,
  sonioxRegion: null,
  status: "idle"
};

// createSettingsActionError returns only the safe fields the settings form may restore after failure.
export function createSettingsActionError(
  errorCode: "invalid_settings" | "save_failed",
  submittedRegion: FormDataEntryValue | null
): SettingsActionState {
  const parsedRegion = sonioxRegionSchema.safeParse(submittedRegion);
  return {
    errorCode,
    sonioxRegion: parsedRegion.success ? parsedRegion.data : null,
    status: "error"
  };
}

// createInitialSettingsActionState maps URL-backed success only into the first mounted form state.
export function createInitialSettingsActionState(status: "error" | "saved" | null): SettingsActionState {
  if (status === "saved") return { errorCode: null, sonioxRegion: null, status: "saved" };
  if (status === "error") return { errorCode: "save_failed", sonioxRegion: null, status: "error" };
  return idleSettingsActionState;
}
