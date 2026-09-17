import type { User } from "@supabase/supabase-js";
import {
  defaultUserSettings,
  automaticOutputTypes,
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
  const freshConsent = userSettingsSchema.shape.automaticOutputTypes.safeParse(candidate?.automaticOutputTypes);
  const parsed = userSettingsSchema.partial().safeParse(candidate && typeof candidate === "object"
    ? { ...candidate, automaticOutputTypes: freshConsent.success ? freshConsent.data : [] }
    : candidate);

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

// resolveAutomaticOutputTypes requires fresh consent for the five newly active outputs.
export function resolveAutomaticOutputTypes(metadata: User["user_metadata"]) {
  const settings = getUserSettingsFromMetadata(metadata);
  return automaticOutputTypes.filter((type) => type === "timeline_chapters"
    ? settings.autoTimelineAfterTranscription
    : settings.automaticOutputTypes.includes(type));
}
