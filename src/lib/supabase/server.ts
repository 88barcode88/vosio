import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";

// createClient builds a request-scoped Supabase client backed by Next.js cookies.
export async function createClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies; proxy refresh handles it.
        }
      }
    }
  });
}
