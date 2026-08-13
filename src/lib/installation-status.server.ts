import "server-only";

const requiredEnvironmentNames = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SONIOX_API_KEY",
  "OPENAI_API_KEY"
] as const;

export type InstallationEnvironment = "production" | "preview" | "development" | "unknown";

export type InstallationStatus = {
  environment: InstallationEnvironment;
  geminiConfigured: boolean;
  missingRequiredNames: string[];
  ready: boolean;
};

// isConfiguredValue checks presence without copying an environment value into the returned status.
function isConfiguredValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

// getInstallationEnvironment reduces runtime-specific values to the public installation enum.
export function getInstallationEnvironment(): InstallationEnvironment {
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "development") {
    return process.env.VERCEL_ENV;
  }

  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "development") {
    return process.env.NODE_ENV;
  }

  return "unknown";
}

// getInstallationStatus returns only safe configuration presence metadata for the settings UI.
export function getInstallationStatus(): InstallationStatus {
  const missingRequiredNames = requiredEnvironmentNames.filter(
    (name) => !isConfiguredValue(process.env[name])
  );

  return {
    environment: getInstallationEnvironment(),
    geminiConfigured: isConfiguredValue(process.env.GEMINI_API_KEY),
    missingRequiredNames,
    ready: missingRequiredNames.length === 0
  };
}
