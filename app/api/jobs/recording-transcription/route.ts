import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { discoverTranscriptionWork } from "@/lib/recordings/transcription-worker.server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Only the dedicated service token can dispatch transcription work without cookies.
export async function POST(request: Request) {
  const expected = process.env.RECORDING_TRANSCRIPTION_WORKER_TOKEN;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expectedBytes = Buffer.from(`Bearer ${expected ?? ""}`);
  if (!expected || supplied.length !== expectedBytes.length || !timingSafeEqual(supplied, expectedBytes)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await discoverTranscriptionWork(createAdminClient()), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Transcription recovery unavailable" }, { status: 503 }); }
}
