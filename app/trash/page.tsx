import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { listDeletedRecordings } from "@/lib/recordings/queries";
import { createClient } from "@/lib/supabase/server";

// TrashPage renders soft-deleted recordings that are still visible through RLS.
export default async function TrashPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/trash");
  }

  const deletedRecordings = await listDeletedRecordings(supabase);

  return (
    <VosioWorkspace
      aiOutputs={[]}
      deletedRecordings={deletedRecordings}
      recordings={[]}
      transcripts={[]}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="trash"
    />
  );
}
