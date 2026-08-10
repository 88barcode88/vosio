import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/auth"];
const WORKSPACE_SHELL_FIXTURE_PATH = "/login/workspace-shell-e2e";

// isPublicPath returns whether the request may run without an authenticated user.
function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

// isDevelopmentWorkspaceShellFixture avoids auth/provider traffic for the guarded local-only shell fixture.
export function isDevelopmentWorkspaceShellFixture(pathname: string, nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "development"
    && (pathname === WORKSPACE_SHELL_FIXTURE_PATH || pathname.startsWith(`${WORKSPACE_SHELL_FIXTURE_PATH}/`));
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
