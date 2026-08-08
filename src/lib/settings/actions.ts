"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseSettingsForm } from "@/lib/settings/form";
import type { UserSettings } from "@/lib/settings/types";
import { USER_SETTINGS_METADATA_KEY } from "@/lib/settings/metadata";
import { createClient } from "@/lib/supabase/server";

// updateUserSettingsAction stores non-secret Vosio preferences in Supabase Auth metadata.
export async function updateUserSettingsAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?next=/settings");
  }

  let settings: UserSettings;

  try {
    settings = parseSettingsForm(formData);
  } catch {
    redirect("/settings?error=invalid_settings");
  }

  const { error } = await supabase.auth.updateUser({
    data: {
      ...(user.user_metadata ?? {}),
      [USER_SETTINGS_METADATA_KEY]: settings
    }
  });

  if (error) {
    redirect("/settings?error=save_failed");
  }

  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
