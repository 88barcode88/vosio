import { type NextRequest } from "next/server";
import { z } from "zod";
import { resendInvitation, revokeInvitation } from "@/lib/recording-sharing/invitations.server";
import { assertInvitationOrigin, invitationFailure, invitationResponse, invitationSession } from "@/lib/recording-sharing/invitation-http.server";
type Context = { params: Promise<{ invitationId: string }> };

// PATCH reserves a fresh token for the same invitation within the bounded DB retry budget.
export async function PATCH(request: NextRequest, context: Context) {
  try {
    assertInvitationOrigin(request);
    const id = z.uuid().parse((await context.params).invitationId);
    const { client, user } = await invitationSession();
    return invitationResponse(await resendInvitation(client, user.id, id, request.nextUrl.origin));
  } catch (error) { return invitationFailure(error); }
}

// DELETE revokes a pending invitation without modifying other invitations or active access.
export async function DELETE(request: NextRequest, context: Context) {
  try {
    assertInvitationOrigin(request);
    const id = z.uuid().parse((await context.params).invitationId);
    const { client } = await invitationSession();
    return invitationResponse(await revokeInvitation(client, id));
  } catch (error) { return invitationFailure(error); }
}
