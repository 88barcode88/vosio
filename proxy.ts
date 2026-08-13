import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnvironmentIssues } from "@/lib/env";
import { isConfigurationBypassPath, isDevelopmentWorkspaceShellFixture } from "@/lib/proxy-paths";

// proxy exposes safe setup diagnostics before loading Supabase and otherwise refreshes auth sessions.
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isDevelopmentWorkspaceShellFixture(pathname)) {
    return NextResponse.next({ request });
  }

  const publicEnvironmentIssues = getPublicEnvironmentIssues();

  if (publicEnvironmentIssues.length > 0) {
    if (isConfigurationBypassPath(pathname)) {
      return NextResponse.next({ request });
    }

    const configurationUrl = request.nextUrl.clone();
    configurationUrl.pathname = "/configuration";
    configurationUrl.search = "";
    return NextResponse.redirect(configurationUrl);
  }

  const { updateSession } = await import("@/lib/supabase/proxy");
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};
