import type { User } from "@supabase/supabase-js";
import {
  defaultUserSettings,
  userSettingsSchema,
  type UserSettings
} from "@/lib/settings/types";

export const USER_SETTINGS_METADATA_KEY = "vosio_settings";

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
