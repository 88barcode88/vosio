import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { listRecordings, normalizeRecordingSearchQuery } from "@/lib/recordings/queries";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { createClient } from "@/lib/supabase/server";

type RecordingsPageProps = {
  searchParams: Promise<{
    error?: string;
    q?: string;
  }>;
};

// RecordingsPage renders the protected recordings workspace list entry point.
export default async function RecordingsPage({ searchParams }: RecordingsPageProps) {
  const params = await searchParams;
  const searchQuery = normalizeRecordingSearchQuery(params.q);
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/recordings");
  }

  const recordings = await listRecordings(supabase, { searchQuery });

  return (
    <VosioWorkspace
      aiOutputs={[]}
      recordings={recordings}
      recordingsError={params.error ?? null}
      recordingsSearchQuery={searchQuery}
      transcripts={[]}
      userSettings={getUserSettingsFromMetadata(user.user_metadata)}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="recordings"
    />
  );
}
