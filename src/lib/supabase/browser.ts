import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

// createClient builds the browser Supabase client with only publishable config.
export function createClient() {
  const env = getPublicEnv();

  return createBrowserClient(
    env.supabaseUrl,
    env.supabasePublishableKey
  );
}
