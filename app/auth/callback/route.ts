import { NextResponse, type NextRequest } from "next/server";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

// GET exchanges Supabase auth codes and redirects only within the request origin.
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  const fallbackTarget = new URL("/", requestUrl.origin);
  let target = fallbackTarget;

  try {
    const candidate = new URL(nextPath, requestUrl.origin);
    if (candidate.origin === requestUrl.origin) {
      target = candidate;
    }
  } catch {
    target = fallbackTarget;
  }

  return NextResponse.redirect(target);
}
