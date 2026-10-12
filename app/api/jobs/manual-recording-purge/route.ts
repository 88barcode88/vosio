import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { discoverManualPurges } from "@/lib/recordings/manual-purge-worker.server";

export const runtime = "nodejs";
export const maxDuration = 300;

// The existing retention scheduler secret and explicit enable switch guard bounded manual-receipt recovery.
export async function POST(request: Request) {
  const expected = process.env.TRASH_RETENTION_SCHEDULER_TOKEN;
  const supplied = request.headers.get("authorization") ?? "";
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(`Bearer ${expected ?? ""}`);
  if (!expected || suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.TRASH_RETENTION_ENABLED !== "true") return NextResponse.json({ error: "Disabled" }, { status: 503 });
  try { return NextResponse.json(await discoverManualPurges(createAdminClient()), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Purge recovery failed" }, { status: 500 }); }
}
