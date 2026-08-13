import "server-only";
import { z } from "zod";

// emptyStringToUndefined lets optional Vercel env vars be left blank without failing validation.
function emptyStringToUndefined(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

const optionalEnvString = z.preprocess(emptyStringToUndefined, z.string().min(1).optional());
const requiredEnvString = z.preprocess(emptyStringToUndefined, z.string().min(1));

const supabaseAdminEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1)
});

const providerEnvSchema = supabaseAdminEnvSchema.extend({
  GEMINI_API_KEY: optionalEnvString,
  OPENAI_API_KEY: optionalEnvString,
  SONIOX_API_KEY: z.string().min(1),
  SONIOX_ASYNC_MODEL: optionalEnvString
});

export type ServerEnv = {
  geminiApiKey: string | null;
  openaiApiKey: string | null;
  sonioxApiKey: string;
  sonioxAsyncModel: string;
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
};

type AiProviderName = "openai" | "gemini";

// parseServerEnv validates shared server-side configuration once per caller.
function parseServerEnv(): ServerEnv {
  const parsed = providerEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error("Missing or invalid server environment variables.");
  }

  return {
    geminiApiKey: parsed.data.GEMINI_API_KEY ?? null,
    openaiApiKey: parsed.data.OPENAI_API_KEY ?? null,
    sonioxApiKey: parsed.data.SONIOX_API_KEY,
    sonioxAsyncModel: parsed.data.SONIOX_ASYNC_MODEL ?? "stt-async-v5",
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL
  };
}

// getServerEnv returns all validated server-side configuration for provider clients.
export function getServerEnv(): ServerEnv {
  return parseServerEnv();
}

// getSupabaseAdminEnv returns only the values needed for service-role Supabase access.
export function getSupabaseAdminEnv() {
  const parsed = supabaseAdminEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error("Missing or invalid Supabase admin environment variables.");
  }

  return {
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL
  };
}

// getOpenAIEnv returns required OpenAI configuration for AI processing.
export function getOpenAIEnv() {
  const parsed = supabaseAdminEnvSchema.extend({
    OPENAI_API_KEY: requiredEnvString
  }).safeParse(process.env);

  if (!parsed.success) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  return {
    openaiApiKey: parsed.data.OPENAI_API_KEY
  };
}

// getGeminiEnv returns required Google Gemini configuration for AI processing.
export function getGeminiEnv() {
  const parsed = supabaseAdminEnvSchema.extend({
    GEMINI_API_KEY: requiredEnvString
  }).safeParse(process.env);

  if (!parsed.success) {
    throw new Error("Missing GEMINI_API_KEY.");
  }

  return {
    geminiApiKey: parsed.data.GEMINI_API_KEY
  };
}

// getAiProviderConfigurationError returns a user-facing setup issue before an AI job is created.
export function getAiProviderConfigurationError(provider: AiProviderName) {
  if (provider === "gemini") {
    const parsed = z.object({ GEMINI_API_KEY: requiredEnvString }).safeParse(process.env);

    return parsed.success
      ? null
      : "Gemini není nakonfigurované. Přidejte GEMINI_API_KEY ve Vercelu, nebo zvolte OpenAI model.";
  }

  const parsed = z.object({ OPENAI_API_KEY: requiredEnvString }).safeParse(process.env);

  return parsed.success
    ? null
    : "OpenAI není nakonfigurované. Přidejte OPENAI_API_KEY ve Vercelu, nebo zvolte jiný dostupný model.";
}
