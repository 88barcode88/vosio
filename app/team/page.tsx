import { notFound, redirect } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import { createClient } from "@/lib/supabase/server";
import { loadTeamWorkspace, resolveTeamRole } from "@/lib/team/queries.server";
import { InvitationError } from "@/lib/recording-sharing/invitations.server";
import type { TeamWorkspace } from "@/lib/team/types";

// TeamPage checks current session authority before requesting any management projection.
export default async function TeamPage() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login?next=/team");
  const role = await resolveTeamRole(client);
  if (!role) notFound();
  let workspace: TeamWorkspace;
  try {
    workspace = await loadTeamWorkspace(client);
  } catch (error) {
    if (error instanceof InvitationError && error.status === 403) notFound();
    throw new Error("Tým se nepodařilo načíst.");
  }
  return <VosioWorkspace canManageTeam teamWorkspace={workspace} aiOutputs={[]} recordings={[]} transcripts={[]} userEmail={user.email ?? ""} view="team" />;
}
