import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/auth/callback/route";
import { getSafeNextPath } from "@/lib/auth/redirects";

const { exchangeCodeForSession } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession }
  }))
}));

const requestOrigin = "https://vosio.test";

const maliciousNextPaths = [
  "//evil.example/login",
  "/\\evil.example",
  "/safe/\\evil.example",
  "/%5Cevil.example",
  "/%2F%5Cevil.example",
  "/%2Fevil.example",
  "/recordings/\nevil",
  "/recordings/\tevil",
  "/recordings/\0evil",
  `/recordings/${String.fromCharCode(0x7f)}evil`,
  "/recordings/%0Aevil",
  "/recordings/%09evil",
  "/recordings/%00evil",
  "/recordings/%7Fevil",
  "/%",
  "/%2",
  "/%GG",
  "/%C0%AF",
  "/%252Fevil.example",
  "/%255Cevil.example",
  "/%25X%255Cevil.example",
  "/recordings/%250Aevil"
];

describe("getSafeNextPath", () => {
  it("keeps ordinary same-app paths including query strings and fragments", () => {
    expect(getSafeNextPath("/recordings/123?tab=ai")).toBe("/recordings/123?tab=ai");
    expect(getSafeNextPath("/recordings/123?tab=ai#details")).toBe(
      "/recordings/123?tab=ai#details"
    );
    expect(getSafeNextPath("/recordings/%E2%9C%93?query=hello%20world")).toBe(
      "/recordings/%E2%9C%93?query=hello%20world"
    );
  });

  it.each([
    "/recordings?q=Sales%2FEurope",
    "/recordings?q=100%25",
    "/recordings#Sales%2FEurope",
    "/recordings#100%25"
  ])("preserves encoded separators and percent signs outside the pathname in %j", (nextPath) => {
    expect(getSafeNextPath(nextPath)).toBe(nextPath);
  });

  it("rejects absolute URLs", () => {
    expect(getSafeNextPath("https://example.com")).toBe("/");
  });

  it("falls back for missing or malformed values", () => {
    expect(getSafeNextPath(null)).toBe("/");
    expect(getSafeNextPath("recordings")).toBe("/");
  });

  it.each(maliciousNextPaths)("rejects ambiguous or unsafe path %j", (nextPath) => {
    const safePath = getSafeNextPath(nextPath);

    expect(safePath).toBe("/");
    expect(new URL(safePath, requestOrigin).origin).toBe(requestOrigin);
  });

  it("rejects a slash and backslash value after query decoding", () => {
    const queryDecodedPath = new URL(
      `${requestOrigin}/auth/callback?next=%2F%5Cevil.example`
    ).searchParams.get("next");

    expect(queryDecodedPath).toBe("/\\evil.example");
    expect(getSafeNextPath(queryDecodedPath)).toBe("/");
  });
});

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
  });

  it("keeps a query-decoded malicious redirect on the request origin", async () => {
    const response = await GET(
      new NextRequest(`${requestOrigin}/auth/callback?code=auth-code&next=%2F%5Cevil.example`)
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("auth-code");
    expect(response.headers.get("location")).toBe(`${requestOrigin}/`);
  });

  it("preserves an ordinary same-origin redirect after exchanging the code", async () => {
    const response = await GET(
      new NextRequest(
        `${requestOrigin}/auth/callback?code=safe-code&next=%2Frecordings%2F123%3Ftab%3Dai`
      )
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("safe-code");
    expect(response.headers.get("location")).toBe(`${requestOrigin}/recordings/123?tab=ai`);
  });
});
