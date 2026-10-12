import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv } from "@/lib/env.server";

// createAdminClient builds a server-only Supabase client with service role privileges.
export function createAdminClient(options?: { fetchTimeoutMs?: number }) {
  const timeout = options?.fetchTimeoutMs;
  if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000)) {
    throw new Error("Invalid admin fetch timeout");
  }
  const env = getSupabaseAdminEnv();

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    ...(timeout === undefined ? {} : { global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const existing = init?.signal ?? (input instanceof Request ? input.signal : null);
        const deadline = AbortSignal.timeout(timeout);
        return fetch(input, { ...init, redirect: "error", signal: existing ? AbortSignal.any([existing, deadline]) : deadline });
      }
    } }),
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
