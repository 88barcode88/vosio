"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSettingsActionError, type SettingsActionState } from "@/lib/settings/action-state";
import { parseSettingsForm } from "@/lib/settings/form";
import type { UserSettings } from "@/lib/settings/types";
import { USER_SETTINGS_METADATA_KEY } from "@/lib/settings/metadata";
import { createClient } from "@/lib/supabase/server";

// updateUserSettingsAction stores non-secret Vosio preferences in Supabase Auth metadata.
export async function updateUserSettingsAction(
  _previousState: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return redirect("/login?next=/settings");
  }

  let settings: UserSettings;

  try {
    settings = parseSettingsForm(formData);
  } catch {
    return createSettingsActionError("invalid_settings", formData.get("sonioxRegion"));
  }

  const { error } = await supabase.auth.updateUser({
    data: {
      ...(user.user_metadata ?? {}),
      [USER_SETTINGS_METADATA_KEY]: settings
    }
  });

  if (error) {
    return createSettingsActionError("save_failed", settings.sonioxRegion);
  }

  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath("/settings");
  return redirect("/settings?saved=1");
}
