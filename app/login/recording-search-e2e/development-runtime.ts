export type RecordingSearchFixtureAccess =
  | { ok: true; scope: string }
  | { ok: false; reason: "environment" | "scope" };

const fixtureScopePattern = /^[0-9a-f]{11}$/;

// validateRecordingSearchFixtureAccess keeps the external fixture inaccessible outside scoped development runs.
export function validateRecordingSearchFixtureAccess(
  environment: string | undefined,
  scope: unknown
): RecordingSearchFixtureAccess {
  if (environment !== "development") return { ok: false, reason: "environment" };
  if (typeof scope !== "string" || !fixtureScopePattern.test(scope)) {
    return { ok: false, reason: "scope" };
  }

  return { ok: true, scope };
}
