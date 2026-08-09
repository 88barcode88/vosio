export type NotionWarmPreviewAccess =
  | { ok: true; scope: string }
  | { ok: false; reason: "environment" | "scope" };

const scopePattern = /^[0-9a-f]{11}$/;

// validateNotionWarmPreviewAccess keeps the visual fixture unavailable in production.
export function validateNotionWarmPreviewAccess(
  environment: string | undefined,
  scope: unknown
): NotionWarmPreviewAccess {
  if (environment !== "development") return { ok: false, reason: "environment" };
  if (typeof scope !== "string" || !scopePattern.test(scope)) {
    return { ok: false, reason: "scope" };
  }
  return { ok: true, scope };
}
