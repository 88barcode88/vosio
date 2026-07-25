type RateLimitBucket = {
  count: number;
  resetAtMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const MAX_TRACKED_KEYS = 10_000;

// createRateLimiter builds a fixed-window per-key request cap held in process memory.
// This is a pragmatic cost brake for single-instance/self-hosted deployments; serverless
// instances each keep their own window, so treat the limit as best-effort, not exact.
export function createRateLimiter(config: { limit: number; windowMs: number }) {
  const buckets = new Map<string, RateLimitBucket>();

  // pruneExpired drops finished windows so the bucket map cannot grow without bound.
  function pruneExpired(nowMs: number) {
    if (buckets.size < MAX_TRACKED_KEYS) {
      return;
    }

    for (const [key, bucket] of buckets) {
      if (nowMs >= bucket.resetAtMs) {
        buckets.delete(key);
      }
    }
  }

  // check consumes one request slot for the key and reports whether it fit the window.
  return function check(key: string, nowMs = Date.now()): RateLimitResult {
    pruneExpired(nowMs);

    const bucket = buckets.get(key);

    if (!bucket || nowMs >= bucket.resetAtMs) {
      buckets.set(key, { count: 1, resetAtMs: nowMs + config.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (bucket.count < config.limit) {
      buckets.set(key, { ...bucket, count: bucket.count + 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000))
    };
  };
}
