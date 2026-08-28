import { notFound } from "next/navigation";
import { ConfigurationDiagnostics } from "../../configuration/configuration-diagnostics";
import { SettingsPanel } from "@/components/settings-panel";
import { ACCEPTED_RECORDING_MIME_TYPES } from "@/lib/recordings/types";
import { defaultUserSettings } from "@/lib/settings/types";
import { saveFixtureSettingsAction } from "./actions";
import { validateSonioxInstallationFixtureAccess } from "./development-runtime";

export const dynamic = "force-dynamic";

const fixtureStorage = {
  allowedMimeTypes: [...ACCEPTED_RECORDING_MIME_TYPES],
  bucketMaxFileSizeBytes: 100 * 1024 * 1024,
  detectedGlobalMaxFileSizeBytes: null,
  maxFileSizeBytes: 50 * 1024 * 1024,
  planMaxFileSizeBytes: 50 * 1024 * 1024
};

const fixtureUsage = {
  error: "Usage není v izolované testovací stránce dostupné.",
  summary: null
};

type FixtureQuery = {
  configuration?: string;
  gemini?: string;
  installation?: string;
  region?: string;
  save?: string;
  saved?: string;
  scope?: string;
  surface?: string;
};

// SonioxInstallationE2EPage mounts real settings and configuration UI over inert local-only state.
export default async function SonioxInstallationE2EPage({
  searchParams
}: {
  searchParams: Promise<FixtureQuery>;
}) {
  const query = await searchParams;
  const access = validateSonioxInstallationFixtureAccess(process.env.NODE_ENV, query.scope);
  if (!access) notFound();

  if (query.surface === "configuration") {
    const missingNames = query.configuration === "ready"
      ? []
      : query.configuration === "key"
        ? ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const
        : ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;
    return (
      <ConfigurationDiagnostics
        environment="preview"
        missingNames={[...missingNames]}
      />
    );
  }

  const installation = query.installation === "ready" ? "ready" : "missing";
  const gemini = query.gemini === "configured" ? "configured" : "missing";
  const saveMode = query.save === "error" ? "error" : "success";
  const sonioxRegion = query.region === "eu" ? "eu" : "global";
  const status = query.saved === "1" ? "saved" : null;
  const installationStatus = installation === "ready"
    ? { environment: "preview" as const, geminiConfigured: gemini === "configured", missingRequiredNames: [], ready: true }
    : {
        environment: "preview" as const,
        geminiConfigured: gemini === "configured",
        missingRequiredNames: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "OPENAI_API_KEY"],
        ready: false
      };

  return (
    <main className="content-area content-area-document">
      <SettingsPanel
        accountEmail="fixture@vosio.local"
        disableAccountSecurity
        installationStatus={installationStatus}
        recordingStorageConfig={fixtureStorage}
        saveAction={saveFixtureSettingsAction.bind(null, access.scope, saveMode, installation, gemini)}
        settings={{ ...defaultUserSettings, sonioxRegion, supabaseStoragePlan: "free" }}
        status={status}
        usageState={fixtureUsage}
      />
    </main>
  );
}
