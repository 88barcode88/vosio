import {
  defaultUserSettings,
  settingsProcessingTypes,
  userSettingsSchema,
  type UserSettings
} from "@/lib/settings/types";

// getStringField reads a string from FormData while preserving an explicit fallback.
function getStringField(formData: FormData, name: string, fallback: string) {
  const value = formData.get(name);

  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// getNumberField reads a numeric FormData field with bounded schema validation later.
function getNumberField(formData: FormData, name: string, fallback: number) {
  const value = Number(formData.get(name));

  return Number.isFinite(value) ? value : fallback;
}

// getProcessingTypes reads allowed automatic AI output types from checkboxes.
function getProcessingTypes(formData: FormData) {
  const allowed = new Set<string>(settingsProcessingTypes);
  const values = formData
    .getAll("autoProcessingTypes")
    .filter((value): value is string => typeof value === "string" && allowed.has(value));

  return values.length > 0 ? values : ["summary"];
}

// parseSettingsForm converts the settings form into a validated user settings object.
export function parseSettingsForm(formData: FormData): UserSettings {
  const parsed = userSettingsSchema.safeParse({
    aiTemperature: getNumberField(formData, "aiTemperature", 0.2),
    audioRetentionPolicy: getStringField(formData, "audioRetentionPolicy", "keep_audio"),
    autoProcessAfterTranscription: formData.get("autoProcessAfterTranscription") === "on",
    autoProcessingTypes: getProcessingTypes(formData),
    defaultOpenaiModel: getStringField(
      formData,
      "defaultOpenaiModel",
      defaultUserSettings.defaultOpenaiModel
    ),
    outputLanguage: getStringField(formData, "outputLanguage", "call_language"),
    sonioxRealtimeLanguage: getStringField(
      formData,
      "sonioxRealtimeLanguage",
      defaultUserSettings.sonioxRealtimeLanguage
    ),
    sonioxRealtimeModel: getStringField(formData, "sonioxRealtimeModel", "stt-rt-v5")
  });

  if (!parsed.success) {
    throw new Error("Invalid settings form payload.");
  }

  return parsed.data;
}
