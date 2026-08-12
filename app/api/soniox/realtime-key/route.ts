import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  createSonioxTemporaryKey,
  getSonioxRealtimeClientConfig
} from "@/lib/soniox/client";
import { createClient } from "@/lib/supabase/server";

// Generous per-user cap: live sessions re-request keys on reconnects, abuse loops do not.
const realtimeKeyRateLimit = createRateLimiter({ limit: 20, windowMs: 60_000 });

// getRealtimeKeyErrorCode maps internal failures to safe client-visible diagnostics.
function getRealtimeKeyErrorCode(error: unknown) {
  if (!(error instanceof Error)) {
    return "unknown";
  }

  if (error.message.includes("environment variables")) {
    return "server_env_invalid";
  }

  if (/api key|unauthorized|forbidden|401|403/i.test(error.message)) {
    return "soniox_auth_or_region";
  }

  return "soniox_request_failed";
}

// POST creates a short-lived Soniox key scoped only to realtime websocket transcription.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  }

  const rateLimit = realtimeKeyRateLimit(user.id);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Příliš mnoho požadavků na realtime klíč. Zkuste to za chvíli." },
      { headers: { "Retry-After": String(rateLimit.retryAfterSeconds) }, status: 429 }
    );
  }

  try {
    const realtimeConfig = getSonioxRealtimeClientConfig("global");
    const temporaryKey = await createSonioxTemporaryKey({
      clientReferenceId: `vosio-live:${user.id}:${randomUUID()}`,
      region: "global"
    });

    return NextResponse.json({
      api_key: temporaryKey.api_key,
      expires_at: temporaryKey.expires_at,
      region: realtimeConfig.region,
      stt_ws_url: realtimeConfig.websocketUrl
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error("[Vosio realtime key]", error.message);
    }

    return NextResponse.json(
      { code: getRealtimeKeyErrorCode(error), error: "Nepodařilo se vytvořit realtime klíč." },
      { status: 500 }
    );
  }
}
