import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTranscriptionOperation } from "@/lib/recordings/transcription-dispatch.server";

export const runtime = "nodejs";
export const maxDuration = 300;
const bodySchema = z.object({ operationId: z.uuid() }).strict();

// Constant-time Bearer check against the dedicated dispatch token (never the worker token).
function authorized(request: Request) {
  const expected = process.env.RECORDING_TRANSCRIPTION_DISPATCH_TOKEN;
  if (!expected) return false;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expectedBytes = Buffer.from(`Bearer ${expected}`);
  return supplied.length === expectedBytes.length && timingSafeEqual(supplied, expectedBytes);
}

// Server-to-server dispatch of exactly one already started capture transcription operation, called by the vosio-mcp Function.
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { operationId } = body.data;
  after(async () => {
    try { await runTranscriptionOperation(createAdminClient(), operationId); }
    catch { console.error("[Vosio transcription] Dispatch requires recovery."); }
  });
  return NextResponse.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
