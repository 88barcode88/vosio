import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1)
});

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
