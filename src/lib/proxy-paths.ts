const WORKSPACE_SHELL_FIXTURE_PATH = "/login/workspace-shell-e2e";
const SONIOX_INSTALLATION_FIXTURE_PATH = "/login/soniox-installation-e2e";
const CONFIGURATION_PATH = "/configuration";
const PUBLIC_ASSET_PATHS = new Set([
  "/favicon.ico",
  "/manifest.webmanifest",
  "/sw.js"
]);
const PUBLIC_ASSET_EXTENSION = /\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/iu;

// isDevelopmentWorkspaceShellFixture recognizes the guarded local-only E2E fixture namespaces.
export function isDevelopmentWorkspaceShellFixture(pathname: string, nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "development"
    && (
      pathname === WORKSPACE_SHELL_FIXTURE_PATH
      || pathname.startsWith(`${WORKSPACE_SHELL_FIXTURE_PATH}/`)
      || pathname === SONIOX_INSTALLATION_FIXTURE_PATH
      || pathname.startsWith(`${SONIOX_INSTALLATION_FIXTURE_PATH}/`)
    );
}

// isConfigurationBypassPath keeps diagnostics and required static assets reachable without app configuration.
export function isConfigurationBypassPath(pathname: string) {
  return pathname === CONFIGURATION_PATH
    || pathname.startsWith(`${CONFIGURATION_PATH}/`)
    || pathname.startsWith("/_next/")
    || PUBLIC_ASSET_PATHS.has(pathname)
    || PUBLIC_ASSET_EXTENSION.test(pathname);
}
