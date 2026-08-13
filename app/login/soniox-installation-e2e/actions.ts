"use server";

import { redirect } from "next/navigation";
import { parseSettingsForm } from "@/lib/settings/form";
import { createSettingsActionError, type SettingsActionState } from "@/lib/settings/action-state";
import { validateSonioxInstallationFixtureAccess } from "./development-runtime";

// saveFixtureSettingsAction simulates a bounded settings mutation without external calls or persistence.
export async function saveFixtureSettingsAction(
  scope: string,
  saveMode: "error" | "success",
  installation: "missing" | "ready",
  gemini: "configured" | "missing",
  _previousState: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const access = validateSonioxInstallationFixtureAccess(process.env.NODE_ENV, scope);
  if (!access) throw new Error("Fixture is unavailable.");

  const settings = parseSettingsForm(formData);
  await new Promise((resolve) => setTimeout(resolve, 650));
  if (saveMode === "error") {
    return createSettingsActionError("save_failed", settings.sonioxRegion);
  }

  const query = new URLSearchParams({ saved: "1" });
  query.set("gemini", gemini);
  query.set("installation", installation);
  query.set("region", settings.sonioxRegion);
  query.set("save", saveMode);
  query.set("scope", scope);
  query.set("surface", "settings");
  return redirect(`/login/soniox-installation-e2e?${query.toString()}`);
}
