import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env";
import { isDevelopmentWorkspaceShellFixture } from "@/lib/proxy-paths";

export { isDevelopmentWorkspaceShellFixture } from "@/lib/proxy-paths";

const PUBLIC_PATHS = ["/login", "/auth"];

// isPublicPath returns whether the request may run without an authenticated user.
function isPublicPath(pathname: string) {
  return pathname === "/invitations/accept"
    || pathname === "/api/recording-invitations" || pathname.startsWith("/api/recording-invitations/")
    || PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

// createLoginRedirect builds a safe login redirect that preserves the requested path.
function createLoginRedirect(request: NextRequest) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/login";
  redirectUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(redirectUrl);
}

// updateSession refreshes Supabase auth cookies and protects private app routes.
export async function updateSession(request: NextRequest) {
  // Exact cookie-less scheduler and per-job callback POSTs use their own Bearer/HMAC guards.
  const schedulerPaths = ["/api/jobs/manual-recording-purge", "/api/jobs/recording-transcription"];
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const callbackPath = new RegExp(`^/api/jobs/recording-transcription/${uuid}/${uuid}$`, "i").test(request.nextUrl.pathname);
  if (request.method === "POST" && (schedulerPaths.includes(request.nextUrl.pathname) || callbackPath)
    && request.url === new URL(request.nextUrl.pathname, request.url).href) {
    return NextResponse.next({ request });
  }

  if (isDevelopmentWorkspaceShellFixture(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });
  const env = getPublicEnv();

  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        supabaseResponse = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });

        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    return createLoginRedirect(request);
  }

  if (user && request.nextUrl.pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return supabaseResponse;
}
