import type { NextRequest } from "next/server";
import { assertInvitationOrigin, invitationBody, invitationFailure, invitationResponse, invitationSession } from "@/lib/recording-sharing/invitation-http.server";
import { saveTeamAccessBatch } from "@/lib/team/queries.server";
import { teamAccessBatchMutationSchema } from "@/lib/team/types";

// POST submits one bounded atomic command through the caller's verified session.
export async function POST(request: NextRequest) {
  try {
    assertInvitationOrigin(request);
    const { client } = await invitationSession();
    return invitationResponse(await saveTeamAccessBatch(client, teamAccessBatchMutationSchema.parse(await invitationBody(request))));
  } catch (error) { return invitationFailure(error); }
}
