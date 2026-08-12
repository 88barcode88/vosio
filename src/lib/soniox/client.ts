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

type SonioxRequestErrorInput = {
  errorType?: string;
  message: string;
  requestId?: string;
  status: number;
};

// SonioxRequestError preserves safe provider diagnostics for server-side classification.
export class SonioxRequestError extends Error {
  readonly errorType?: string;
  readonly requestId?: string;
  readonly status: number;

  // constructor records only diagnostics already sanitized at the provider boundary.
  constructor(input: SonioxRequestErrorInput) {
    super(`${input.message} (${input.status})`);
    this.name = "SonioxRequestError";
    this.errorType = input.errorType;
    this.requestId = input.requestId;
    this.status = input.status;
  }
}

// getSafeProviderIdentifier accepts only bounded identifier characters from provider diagnostics.
function getSafeProviderIdentifier(value: unknown, apiKey: string) {
  return typeof value === "string" && !value.includes(apiKey) && /^[a-z0-9._:-]{1,200}$/i.test(value)
    ? value
    : undefined;
}

// getSonioxRequestError extracts safe structured diagnostics without exposing credentials.
function getSonioxRequestError(payload: unknown, status: number, apiKey: string) {
  if (typeof payload !== "object" || payload === null) {
    return new SonioxRequestError({
      message: "Soniox request failed",
      status
    });
  }

  const errorType = "error_type" in payload
    ? getSafeProviderIdentifier(payload.error_type, apiKey)
    : undefined;
  const requestId = "request_id" in payload
    ? getSafeProviderIdentifier(payload.request_id, apiKey)
    : undefined;
  let message = "Soniox request failed";

  if ("error_message" in payload && typeof payload.error_message === "string") {
    message = payload.error_message.replaceAll(apiKey, "[redacted]");
  } else if ("message" in payload && typeof payload.message === "string") {
    message = payload.message.replaceAll(apiKey, "[redacted]");
  }

  return new SonioxRequestError({ errorType, message, requestId, status });
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
    throw getSonioxRequestError(payload, response.status, env.sonioxApiKey);
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
