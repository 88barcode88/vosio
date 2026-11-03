import { redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { resolveTeamRole } from "@/lib/team/queries.server";
import { createClient } from "@/lib/supabase/server";

// WhatsNewPage renders the protected in-app release notes written for users.
export default async function WhatsNewPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/whats-new");
  }

  return (
    <VosioWorkspace
      canManageTeam={Boolean(await resolveTeamRole(supabase))}
      aiOutputs={[]}
      recordings={[]}
      transcripts={[]}
      userEmail={user.email ?? "uzivatel@vosio.local"}
      view="whats-new"
    />
  );
}
