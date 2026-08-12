const fixtureScopePattern = /^[0-9a-f]{12}$/u;

// validateSonioxInstallationFixtureAccess limits the inert installation fixture to scoped development use.
export function validateSonioxInstallationFixtureAccess(
  nodeEnv: string | undefined,
  scope: string | undefined
) {
  if (nodeEnv !== "development" || !scope || !fixtureScopePattern.test(scope)) return null;
  return { scope };
}
