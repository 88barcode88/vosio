import { getServerEnv } from "@/lib/env.server";
import {
  getSonioxRegionTarget,
  type SonioxRegion
} from "@/lib/soniox/region";

const TEMPORARY_KEY_CONNECTION_WINDOW_SECONDS = 60;

type SonioxTranscriptionStatus = "queued" | "processing" | "completed" | "error";

export type SonioxTranscriptionOptions = {
  enable_language_identification: boolean;
  enable_speaker_diarization: boolean;
  language_hints: string[];
  model: string;
};

export type SonioxTranscription = {
  audio_duration_ms?: number;
  error_message?: string | null;
  error_type?: string | null;
  id: string;
  status: SonioxTranscriptionStatus;
};

export type SonioxTranscript = {
  id: string;
  text: string;
  tokens: unknown[];
};

export type SonioxTemporaryKey = {
  api_key: string;
  expires_at: string;
};

// getSonioxErrorMessage extracts a safe provider message without exposing credentials.
function getSonioxErrorMessage(payload: unknown, status: number, apiKey: string) {
  if (typeof payload !== "object" || payload === null) {
    return `Soniox request failed with status ${status}.`;
  }

  if ("error_message" in payload && typeof payload.error_message === "string") {
    return `${payload.error_message.replaceAll(apiKey, "[redacted]")} (${status})`;
  }

  if ("message" in payload && typeof payload.message === "string") {
    return `${payload.message.replaceAll(apiKey, "[redacted]")} (${status})`;
  }

  return `Soniox request failed with status ${status}.`;
}

// sonioxFetch calls Soniox REST API with server-only bearer authentication.
async function sonioxFetch<T>(region: SonioxRegion, path: string, init?: RequestInit) {
  const env = getServerEnv();
  const target = getSonioxRegionTarget(region);
  const response = await fetch(`${target.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.sonioxApiKey}`,
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  const payload = (await response.json().catch(() => null)) as T | unknown;

  if (!response.ok) {
    throw new Error(getSonioxErrorMessage(payload, response.status, env.sonioxApiKey));
  }

  return payload as T;
}

// getSonioxTranscriptionOptions returns the reusable async STT provider config.
export function getSonioxTranscriptionOptions(): SonioxTranscriptionOptions {
  const env = getServerEnv();

  return {
    enable_language_identification: true,
    enable_speaker_diarization: true,
    language_hints: ["cs"],
    model: env.sonioxAsyncModel
  };
}

// createSonioxTemporaryKey mints a short-lived browser key for realtime STT only.
export async function createSonioxTemporaryKey(input: {
  clientReferenceId: string;
  region: SonioxRegion;
}) {
  return sonioxFetch<SonioxTemporaryKey>(input.region, "/v1/auth/temporary-api-key", {
    body: JSON.stringify({
      client_reference_id: input.clientReferenceId,
      expires_in_seconds: TEMPORARY_KEY_CONNECTION_WINDOW_SECONDS,
      single_use: true,
      usage_type: "transcribe_websocket"
    }),
    method: "POST"
  });
}

// getSonioxRealtimeClientConfig returns browser-safe realtime defaults.
export function getSonioxRealtimeClientConfig(region: SonioxRegion) {
  const target = getSonioxRegionTarget(region);

  return {
    region,
    websocketUrl: target.sttWsUrl
  };
}

// createSonioxTranscription creates an async transcription from a temporary audio URL.
export async function createSonioxTranscription(input: {
  audioUrl: string;
  clientReferenceId: string;
  options: SonioxTranscriptionOptions;
  region: SonioxRegion;
}) {
  return sonioxFetch<SonioxTranscription>(input.region, "/v1/transcriptions", {
    body: JSON.stringify({
      audio_url: input.audioUrl,
      client_reference_id: input.clientReferenceId,
      ...input.options
    }),
    method: "POST"
  });
}

// getSonioxTranscription retrieves async transcription status from Soniox.
export async function getSonioxTranscription(
  region: SonioxRegion,
  transcriptionId: string
) {
  return sonioxFetch<SonioxTranscription>(region, `/v1/transcriptions/${transcriptionId}`);
}

// getSonioxTranscript retrieves completed transcript text and tokens from Soniox.
export async function getSonioxTranscript(region: SonioxRegion, transcriptionId: string) {
  return sonioxFetch<SonioxTranscript>(
    region,
    `/v1/transcriptions/${transcriptionId}/transcript`
  );
}

// mapSonioxStatus maps Soniox states onto Vosio job states.
export function mapSonioxStatus(status: SonioxTranscriptionStatus) {
  if (status === "completed") {
    return "done";
  }

  if (status === "error") {
    return "failed";
  }

  if (status === "processing") {
    return "running";
  }

  return "queued";
}
