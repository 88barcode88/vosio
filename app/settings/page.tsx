import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { getRecordingStorageConfig } from "@/lib/recordings/storage-config.server";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentMonthUsageState } from "@/lib/usage/summary";

type SettingsPageProps = {
  searchParams: Promise<{
    error?: string;
    saved?: string;
  }>;
};

// SettingsPage renders user-editable non-secret app preferences.
export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/settings");
  }

  const userSettings = getUserSettingsFromMetadata(user.user_metadata);
  const [usageState, recordingStorageConfig] = await Promise.all([
    loadCurrentMonthUsageState(supabase),
    getRecordingStorageConfig(userSettings.supabaseStoragePlan)
  ]);

  return (
    <VosioWorkspace
      aiOutputs={[]}
      recordings={[]}
      recordingStorageConfig={recordingStorageConfig}
      settingsStatus={params.saved ? "saved" : params.error ? "error" : null}
      transcripts={[]}
      usageState={usageState}
      userSettings={userSettings}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="settings"
    />
  );
}
