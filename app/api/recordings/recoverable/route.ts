import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Bound authorized recovery rows inside the database without reading transcript bodies into the route.
export async function GET() {
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  const result = await client.rpc("list_recoverable_recording_captures_v1");
  if (result.error || !Array.isArray(result.data)) return NextResponse.json({ error: "Obnovu nelze načíst." }, { status: 503 });
  return NextResponse.json({ ownerId: auth.data.user.id, recordings: result.data }, { headers: { "Cache-Control": "no-store" } });
}
