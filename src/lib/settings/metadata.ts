import type { User } from "@supabase/supabase-js";
import {
  defaultUserSettings,
  userSettingsSchema,
  type UserSettings
} from "@/lib/settings/types";

export const USER_SETTINGS_METADATA_KEY = "vosio_settings";

// createUserSettingsMetadata preserves unrelated Auth metadata while replacing the validated settings document.
export function createUserSettingsMetadata(
  metadata: User["user_metadata"],
  settings: UserSettings
) {
  return {
    ...(metadata && typeof metadata === "object" ? metadata : {}),
    [USER_SETTINGS_METADATA_KEY]: settings
  };
}

// getUserSettingsFromMetadata reads safe user preferences from Supabase Auth metadata.
export function getUserSettingsFromMetadata(metadata: User["user_metadata"]): UserSettings {
  const candidate =
    metadata && typeof metadata === "object" ? metadata[USER_SETTINGS_METADATA_KEY] : null;
  const parsed = userSettingsSchema.partial().safeParse(candidate);

  if (!parsed.success) {
    return defaultUserSettings;
  }

  return {
    ...defaultUserSettings,
    ...parsed.data
  };
}

// hasAutomaticTimelineConsent accepts only the dedicated opt-in and never infers it from dormant automation fields.
export function hasAutomaticTimelineConsent(metadata: User["user_metadata"]) {
  return getUserSettingsFromMetadata(metadata).autoTimelineAfterTranscription === true;
}
