import { invitationFailure, invitationResponse, invitationSession } from "@/lib/recording-sharing/invitation-http.server";
import { loadTeamWorkspace } from "@/lib/team/queries.server";

// GET returns the current manager's own team; the session RPC independently denies ordinary members.
export async function GET() {
  try {
    const { client } = await invitationSession();
    return invitationResponse(await loadTeamWorkspace(client));
  } catch (error) { return invitationFailure(error); }
}
