import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  createSonioxTemporaryKey,
  getSonioxRealtimeClientConfig,
  SonioxRequestError
} from "@/lib/soniox/client";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import type { SonioxRegion } from "@/lib/soniox/region";
import { createClient } from "@/lib/supabase/server";

// Generous per-user cap: live sessions re-request keys on reconnects, abuse loops do not.
const realtimeKeyRateLimit = createRateLimiter({ limit: 20, windowMs: 60_000 });

// isSonioxAuthenticationFailure recognizes only structured provider auth and permission failures.
function isSonioxAuthenticationFailure(error: SonioxRequestError) {
  return error.status === 401 || error.status === 403 || [
    "unauthenticated",
    "unauthorized",
    "forbidden",
    "permission_denied"
  ].includes(error.errorType?.toLowerCase() ?? "");
}

// getRealtimeKeyErrorCode maps structured failures to safe client-visible diagnostics.
function getRealtimeKeyErrorCode(error: unknown, region: SonioxRegion) {
  if (!(error instanceof Error)) {
    return "unknown";
  }

  if (error.message.includes("environment variables")) {
    return "server_env_invalid";
  }

  if (error instanceof SonioxRequestError && isSonioxAuthenticationFailure(error)) {
    if (region === "eu") {
      return "soniox_eu_access_required";
    }

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

  const region = getUserSettingsFromMetadata(user.user_metadata).sonioxRegion;
  const rateLimit = realtimeKeyRateLimit(user.id);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Příliš mnoho požadavků na realtime klíč. Zkuste to za chvíli." },
      { headers: { "Retry-After": String(rateLimit.retryAfterSeconds) }, status: 429 }
    );
  }

  try {
    const realtimeConfig = getSonioxRealtimeClientConfig(region);
    const temporaryKey = await createSonioxTemporaryKey({
      clientReferenceId: `vosio-live:${user.id}:${randomUUID()}`,
      region
    });

    return NextResponse.json({
      api_key: temporaryKey.api_key,
      expires_at: temporaryKey.expires_at,
      region: realtimeConfig.region,
      stt_ws_url: realtimeConfig.websocketUrl
    });
  } catch (error) {
    if (error instanceof SonioxRequestError) {
      console.error("[Vosio realtime key]", {
        message: error.message,
        requestId: error.requestId
      });
    } else if (error instanceof Error) {
      console.error("[Vosio realtime key]", error.message);
    }

    const code = getRealtimeKeyErrorCode(error, region);
    const requestId = error instanceof SonioxRequestError ? error.requestId : undefined;

    return NextResponse.json(
      {
        code,
        error: code === "soniox_eu_access_required"
          ? "Region EU vyžaduje Soniox EU projekt a odpovídající regionální API key."
          : "Nepodařilo se vytvořit realtime klíč.",
        ...(requestId ? { request_id: requestId } : {})
      },
      { status: 500 }
    );
  }
}
