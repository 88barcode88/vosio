import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

describe("createRateLimiter", () => {
  it("allows requests under the limit inside one window", () => {
    const check = createRateLimiter({ limit: 3, windowMs: 60_000 });

    expect(check("user-1", 1_000).allowed).toBe(true);
    expect(check("user-1", 2_000).allowed).toBe(true);
    expect(check("user-1", 3_000).allowed).toBe(true);
  });

  it("rejects requests over the limit and reports retry seconds", () => {
    const check = createRateLimiter({ limit: 2, windowMs: 60_000 });

    check("user-1", 1_000);
    check("user-1", 2_000);

    const rejected = check("user-1", 3_000);

    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBe(58);
  });

  it("resets the window after it expires", () => {
    const check = createRateLimiter({ limit: 1, windowMs: 10_000 });

    expect(check("user-1", 1_000).allowed).toBe(true);
    expect(check("user-1", 5_000).allowed).toBe(false);
    expect(check("user-1", 11_000).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const check = createRateLimiter({ limit: 1, windowMs: 60_000 });

    expect(check("user-1", 1_000).allowed).toBe(true);
    expect(check("user-2", 1_000).allowed).toBe(true);
    expect(check("user-1", 2_000).allowed).toBe(false);
  });

  it("returns at least one retry second right before the window ends", () => {
    const check = createRateLimiter({ limit: 1, windowMs: 10_000 });

    check("user-1", 1_000);

    expect(check("user-1", 10_999).retryAfterSeconds).toBe(1);
  });
});
