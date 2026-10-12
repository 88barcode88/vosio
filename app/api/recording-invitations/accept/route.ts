import { type NextRequest } from "next/server";
import { z } from "zod";
import { invitationTokenSchema } from "@/lib/recording-sharing/invitation-contract";
import { acceptInvitation } from "@/lib/recording-sharing/invitations.server";
import { assertInvitationOrigin, invitationBody, invitationFailure, invitationResponse, invitationSession } from "@/lib/recording-sharing/invitation-http.server";

// POST is the only application invitation redemption path; GET and callbacks never grant access.
export async function POST(request: NextRequest) {
  try {
    assertInvitationOrigin(request);
    const { client } = await invitationSession();
    const { token } = z.strictObject({ token: invitationTokenSchema }).parse(await invitationBody(request));
    return invitationResponse(await acceptInvitation(client, token));
  } catch (error) { return invitationFailure(error); }
}
