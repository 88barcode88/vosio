import { type NextRequest } from "next/server";
import { z } from "zod";
import { invitationCreateSchema, invitationTokenSchema, revokeAccessSchema } from "@/lib/recording-sharing/invitation-contract";
import { createInvitation, listAccess, previewInvitation, revokeAccess } from "@/lib/recording-sharing/invitations.server";
import { assertInvitationOrigin, invitationBody, invitationFailure, invitationResponse, invitationSession } from "@/lib/recording-sharing/invitation-http.server";

// GET previews without consuming a header-carried token or lists one manager-authorized scope.
export async function GET(request: NextRequest) {
  try {
    const { client } = await invitationSession();
    const token = request.headers.get("x-invitation-token");
    if (token) return invitationResponse(await previewInvitation(client, invitationTokenSchema.parse(token)));
    const projectId = z.uuid().nullable().parse(request.nextUrl.searchParams.get("projectId"));
    const recordingId = z.uuid().nullable().parse(request.nextUrl.searchParams.get("recordingId"));
    if ((projectId === null) === (recordingId === null)) return invitationResponse({ error: "Vyberte jeden rozsah přístupu." }, 400);
    return invitationResponse(await listAccess(client, { projectId, recordingId }));
  } catch (error) { return invitationFailure(error); }
}

// POST creates a pending invitation before starting delivery, never an access grant.
export async function POST(request: NextRequest) {
  try {
    assertInvitationOrigin(request);
    const { client, user } = await invitationSession();
    const input = invitationCreateSchema.parse(await invitationBody(request));
    return invitationResponse(await createInvitation(client, user.id, input, request.nextUrl.origin), 201);
  } catch (error) { return invitationFailure(error); }
}

// DELETE revokes an existing member or exact recording grant through narrow manager RPCs.
export async function DELETE(request: NextRequest) {
  try {
    assertInvitationOrigin(request);
    const { client } = await invitationSession();
    return invitationResponse(await revokeAccess(client, revokeAccessSchema.parse(await invitationBody(request))));
  } catch (error) { return invitationFailure(error); }
}
