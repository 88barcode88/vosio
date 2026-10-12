import { NextResponse, type NextRequest } from "next/server";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

// authRedirect applies privacy headers equally to successful, rejected and failed callbacks.
function authRedirect(destination: URL) {
  return NextResponse.redirect(destination, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

// GET validates supported Auth callbacks; exchanging identity never redeems an invitation.
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next"));
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const failure = new URL("/login?error=Ověření%20se%20nepovedlo.", request.url);
  try {
    if ((!code && !tokenHash) || (code && tokenHash)) return authRedirect(failure);
    if (tokenHash && type !== "invite" && type !== "email" && type !== "magiclink" && type !== "recovery") return authRedirect(failure);
    const supabase = await createClient();
    const result = code ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type as "invite" | "email" | "magiclink" | "recovery" });
    if (result.error) return authRedirect(failure);
    return authRedirect(new URL(nextPath, request.url));
  } catch { return authRedirect(failure); }
}
