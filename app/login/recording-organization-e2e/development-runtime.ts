export type OrganizationFixtureAccess =
  | { ok: true; scope: string }
  | { ok: false; reason: "environment" | "scope" };

const scopePattern = /^[0-9a-f]{11}$/;

// validateOrganizationFixtureAccess keeps the development gate pure and reusable before side effects.
export function validateOrganizationFixtureAccess(
  environment: string | undefined,
  scope: unknown
): OrganizationFixtureAccess {
  if (environment !== "development") return { ok: false, reason: "environment" };
  if (typeof scope !== "string" || !scopePattern.test(scope)) {
    return { ok: false, reason: "scope" };
  }
  return { ok: true, scope };
}

// requireOrganizationFixtureAccess hard-fails server actions outside the development fixture boundary.
export function requireOrganizationFixtureAccess(
  environment: string | undefined,
  scope: unknown
) {
  const access = validateOrganizationFixtureAccess(environment, scope);
  if (!access.ok) {
    throw new Error("Recording organization E2E fixture is development-only.");
  }
  return access.scope;
}
