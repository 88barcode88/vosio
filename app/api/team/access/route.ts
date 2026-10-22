import type { NextRequest } from "next/server";
import { assertInvitationOrigin, invitationBody, invitationFailure, invitationResponse, invitationSession } from "@/lib/recording-sharing/invitation-http.server";
import { saveTeamAccess, revokeTeamAccess } from "@/lib/team/queries.server";
import { teamAccessIdentitySchema, teamAccessMutationSchema } from "@/lib/team/types";

// POST changes one confirmed person's exact access through the current authenticated session.
export async function POST(request: NextRequest) {
  try {
    assertInvitationOrigin(request);
    const { client } = await invitationSession();
    return invitationResponse(await saveTeamAccess(client, teamAccessMutationSchema.parse(await invitationBody(request))));
  } catch (error) { return invitationFailure(error); }
}

// DELETE revokes only the submitted access path and requires fresh database authority.
export async function DELETE(request: NextRequest) {
  try {
    assertInvitationOrigin(request);
    const { client } = await invitationSession();
    return invitationResponse(await revokeTeamAccess(client, teamAccessIdentitySchema.parse(await invitationBody(request))));
  } catch (error) { return invitationFailure(error); }
}
