import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { InvitationError } from "./invitations.server";

// invitationResponse forbids caching of recipient and manager responses, including errors.
export function invitationResponse(value: unknown, status = 200, retryAfterSeconds?: number) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", ...(status === 429 && retryAfterSeconds !== undefined ? { "Retry-After": String(retryAfterSeconds) } : {}) } });
}

// assertInvitationOrigin rejects missing/cross-site origins before cookie-authenticated mutations.
export function assertInvitationOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new InvitationError(403);
}

// invitationSession checks a current verified user before using any session-scoped sharing RPC.
export async function invitationSession() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new InvitationError(401);
  if (!data.user.email_confirmed_at) throw new InvitationError(403);
  return { client, user: data.user };
}

// invitationBody caps streamed JSON so item bounds cannot be bypassed with an oversized body.
export async function invitationBody(request: NextRequest): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new InvitationError(400);
  const reader = request.body?.getReader();
  if (!reader) throw new InvitationError(400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new InvitationError(413); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) { if (error instanceof InvitationError) throw error; throw new InvitationError(400); }
}

// invitationFailure never echoes database, Auth, tokens, body data or provider messages.
export function invitationFailure(error: unknown) {
  const status = error instanceof InvitationError ? error.status : error instanceof z.ZodError ? 400 : 500;
  const code = error instanceof InvitationError ? error.code : "invitation_unavailable";
  const retryAfterSeconds = error instanceof InvitationError ? error.retryAfterSeconds : undefined;
  return invitationResponse({ error: status === 429 ? "Příliš mnoho pokusů. Zkuste to později." : "Pozvánka není dostupná nebo akci nelze dokončit.", code, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) }, status, retryAfterSeconds);
}
