import { redirect } from "next/navigation";
import { z } from "zod";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { getInstallationStatus } from "@/lib/installation-status.server";
import { getRecordingStorageConfig } from "@/lib/recordings/storage-config.server";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentMonthUsageState } from "@/lib/usage/summary";

type SettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// AccountEmailUnavailable renders a stable authenticated error without exposing a password form.
function AccountEmailUnavailable() {
  return (
    <main className="content-area content-area-document">
      <section className="utility-panel settings-panel" aria-label="Nastavení účtu">
        <div className="settings-section">
          <h1>Nastavení účtu není dostupné</h1>
          <p role="alert">Přihlášený účet nemá použitelný e-mail. Obraťte se na správce účtu.</p>
        </div>
      </section>
    </main>
  );
}

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

  const accountEmail = z.email().safeParse(user.email);
  if (!accountEmail.success) {
    return <AccountEmailUnavailable />;
  }

  const userSettings = getUserSettingsFromMetadata(user.user_metadata);
  const installationStatus = getInstallationStatus();
  const [usageState, recordingStorageConfig] = await Promise.all([
    loadCurrentMonthUsageState(supabase),
    getRecordingStorageConfig(userSettings.supabaseStoragePlan)
  ]);

  return (
    <VosioWorkspace
      aiOutputs={[]}
      installationStatus={installationStatus}
      recordings={[]}
      recordingStorageConfig={recordingStorageConfig}
      settingsStatus={params.saved === "1" ? "saved" : null}
      transcripts={[]}
      usageState={usageState}
      userSettings={userSettings}
      userEmail={accountEmail.data}
      view="settings"
    />
  );
}
