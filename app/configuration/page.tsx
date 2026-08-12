import type { Metadata } from "next";
import { ConfigurationDiagnostics } from "./configuration-diagnostics";
import { getPublicEnvironmentIssues } from "@/lib/env";
import { getInstallationEnvironment } from "@/lib/installation-status.server";

export const metadata: Metadata = {
  title: "Konfigurace aplikace | Vosio"
};

// ConfigurationPage renders public-only setup diagnostics without loading a Supabase client.
export default function ConfigurationPage() {
  const missingNames = getPublicEnvironmentIssues();
  const environment = getInstallationEnvironment();

  return <ConfigurationDiagnostics environment={environment} missingNames={missingNames} />;
}
