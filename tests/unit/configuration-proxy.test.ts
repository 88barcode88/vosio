import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { updateSession } = vi.hoisted(() => ({
  updateSession: vi.fn(async (request: NextRequest) => NextResponse.next({ request }))
}));

vi.mock("@/lib/supabase/proxy", () => ({
  updateSession
}));

import { proxy } from "../../proxy";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// configurePublicEnvironment provides a healthy baseline that tests can selectively break.
function configurePublicEnvironment() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
}

describe("safe configuration proxy", () => {
  it("redirects to configuration before the Supabase session runs", async () => {
    configurePublicEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const response = await proxy(new NextRequest("https://vosio.test/recordings?tab=all"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://vosio.test/configuration");
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("allows configuration without a redirect loop or Supabase session", async () => {
    configurePublicEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    const response = await proxy(new NextRequest("https://vosio.test/configuration"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("leaves internal and static assets available while configuration is incomplete", async () => {
    configurePublicEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    for (const pathname of ["/_next/static/chunks/app.js", "/favicon.ico", "/vosio-logo.svg"] as const) {
      const response = await proxy(new NextRequest(`https://vosio.test${pathname}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }

    expect(updateSession).not.toHaveBeenCalled();
  });

  it("preserves the local fixture bypass when public configuration is incomplete", async () => {
    configurePublicEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NODE_ENV", "development");

    const response = await proxy(new NextRequest("https://vosio.test/login/workspace-shell-e2e/settings"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("keeps the existing authenticated proxy behavior when configuration is healthy", async () => {
    configurePublicEnvironment();
    const request = new NextRequest("https://vosio.test/recordings");

    await proxy(request);

    expect(updateSession).toHaveBeenCalledOnce();
    expect(updateSession).toHaveBeenCalledWith(request);
  });
});
