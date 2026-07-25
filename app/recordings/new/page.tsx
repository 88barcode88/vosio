import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { getRecordingStorageConfig } from "@/lib/recordings/storage-config.server";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { createClient } from "@/lib/supabase/server";

// NewRecordingPage renders the dedicated capture workspace.
export default async function NewRecordingPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/recordings/new");
  }

  const recordingStorageConfig = await getRecordingStorageConfig();

  return (
    <VosioWorkspace
      aiOutputs={[]}
      isCreatingRecording
      recordingStorageConfig={recordingStorageConfig}
      recordings={[]}
      transcripts={[]}
      userSettings={getUserSettingsFromMetadata(user.user_metadata)}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="recordings"
    />
  );
}
