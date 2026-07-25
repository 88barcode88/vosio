import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv } from "@/lib/env.server";

// createAdminClient builds a server-only Supabase client with service role privileges.
export function createAdminClient() {
  const env = getSupabaseAdminEnv();

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
