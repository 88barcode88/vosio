const fixtureScopePattern = /^[0-9a-f]{12}$/;

export type NewRecordingFixtureMode = "success" | "error";

// validateNewRecordingFixtureAccess keeps the upload transport fixture development-only and scoped.
export function validateNewRecordingFixtureAccess(
  nodeEnv: string | undefined,
  scope: string | undefined,
  mode: string | undefined
): { mode: NewRecordingFixtureMode; scope: string } | null {
  if (nodeEnv === "production" || !scope || !fixtureScopePattern.test(scope)) return null;
  if (mode !== "success" && mode !== "error") return null;
  return { mode, scope };
}
