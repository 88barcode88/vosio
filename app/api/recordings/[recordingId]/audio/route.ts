import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAudioPlaybackEligibility } from "@/lib/recordings/audio-playback";
import { RECORDINGS_BUCKET } from "@/lib/recordings/types";
import { createClient } from "@/lib/supabase/server";

const routeParamsSchema = z.object({
  recordingId: z.uuid()
});

const AUDIO_URL_EXPIRES_IN_SECONDS = 300;

type RouteContext = {
  params: Promise<{
    recordingId: string;
  }>;
};

type PlaybackRecording = {
  id: string;
  mime_type: string | null;
  storage_path: string | null;
  user_id: string;
};

type SettledOperation<T> =
  | { ok: true; value: T }
  | { ok: false };

// privateJson prevents browsers and intermediary caches from retaining private playback responses.
function privateJson(body: object, status = 200) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, no-store"
    },
    status
  });
}

// settleOperation converts provider exceptions into an explicit stage result without exposing details.
async function settleOperation<T>(operation: () => PromiseLike<T>): Promise<SettledOperation<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch {
    return { ok: false };
  }
}

// isValidSignedAudioUrl accepts only clean, parseable HTTP(S) URL strings from Storage.
function isValidSignedAudioUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    return false;
  }

  try {
    const parsedUrl = new URL(value);

    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
}

// GET signs one user-owned audio object only after request-scoped auth and ownership checks.
export async function GET(_request: NextRequest, context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return privateJson({ error: "Neplatné ID nahrávky." }, 400);
  }

  const clientResult = await settleOperation(() => createClient());

  if (!clientResult.ok) {
    return privateJson({ error: "Audio se nepodařilo načíst." }, 500);
  }

  const supabase = clientResult.value;
  const authResult = await settleOperation(() => supabase.auth.getUser());

  if (!authResult.ok) {
    return privateJson({ error: "Audio se nepodařilo načíst." }, 500);
  }

  const {
    data: { user },
    error: userError
  } = authResult.value;

  if (userError || !user) {
    return privateJson({ error: "Nejste přihlášený." }, 401);
  }

  const recordingResult = await settleOperation(() => supabase
    .from("recordings")
    .select("id,user_id,storage_path,mime_type")
    .eq("id", params.data.recordingId)
    .eq("user_id", user.id)
    .maybeSingle());

  if (!recordingResult.ok) {
    return privateJson({ error: "Audio se nepodařilo načíst." }, 500);
  }

  const { data, error } = recordingResult.value;

  if (error) {
    return privateJson({ error: "Audio se nepodařilo načíst." }, 500);
  }

  const recording = data as PlaybackRecording | null;

  if (!recording) {
    return privateJson({ error: "Nahrávka nebyla nalezena." }, 404);
  }

  const eligibility = getAudioPlaybackEligibility(recording);

  if (!eligibility.eligible) {
    return privateJson({
      error: "Audio nelze přehrát.",
      reason: eligibility.reason
    }, 409);
  }

  const signingResult = await settleOperation(() => supabase.storage
    .from(RECORDINGS_BUCKET)
    .createSignedUrl(recording.storage_path as string, AUDIO_URL_EXPIRES_IN_SECONDS));

  if (!signingResult.ok) {
    return privateJson({ error: "Odkaz na audio se nepodařilo vytvořit." }, 502);
  }

  const { data: signedData, error: signingError } = signingResult.value;
  const signedUrl = signedData?.signedUrl;

  if (signingError || !isValidSignedAudioUrl(signedUrl)) {
    return privateJson({ error: "Odkaz na audio se nepodařilo vytvořit." }, 502);
  }

  return privateJson({
    expiresIn: AUDIO_URL_EXPIRES_IN_SECONDS,
    mimeType: recording.mime_type ?? "application/octet-stream",
    url: signedUrl
  });
}
