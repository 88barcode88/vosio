import { z } from "zod";

// isHttpUrl limits Supabase endpoints to the schemes supported by its clients.
function isHttpUrl(value: string) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const publicSupabaseUrlSchema = z.url().refine(isHttpUrl);

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: publicSupabaseUrlSchema,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().refine((value) => value.trim().length > 0)
});

export const PUBLIC_ENVIRONMENT_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
] as const;

export type PublicEnvironmentName = (typeof PUBLIC_ENVIRONMENT_NAMES)[number];

export type PublicEnv = {
  supabasePublishableKey: string;
  supabaseUrl: string;
};

// getPublicEnvSource reads public keys through direct property access so Next.js can inline them.
function getPublicEnvSource() {
  return {
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL
  };
}

// getPublicEnvironmentIssues reports only invalid or missing public variable names without throwing.
export function getPublicEnvironmentIssues(): PublicEnvironmentName[] {
  const source = getPublicEnvSource();

  return PUBLIC_ENVIRONMENT_NAMES.filter((name) => (
    !publicEnvSchema.shape[name].safeParse(source[name]).success
  ));
}

// getPublicEnv validates browser-safe runtime configuration for Supabase clients.
export function getPublicEnv(): PublicEnv {
  const parsed = publicEnvSchema.safeParse(getPublicEnvSource());

  if (!parsed.success) {
    throw new Error("Missing or invalid public Supabase environment variables.");
  }

  return {
    supabasePublishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL
  };
}
