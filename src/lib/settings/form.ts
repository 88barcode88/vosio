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

// getNumberField reads a finite number from a nonblank string and otherwise preserves its fallback.
function getNumberField(formData: FormData, name: string, fallback: number) {
  const value = formData.get(name);

  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

// getProcessingTypes reads allowed automatic AI output types from checkboxes.
function getProcessingTypes(formData: FormData) {
  const allowed = new Set<string>(settingsProcessingTypes);
  const values = [...new Set(formData
    .getAll("autoProcessingTypes")
    .filter((value): value is string => typeof value === "string" && allowed.has(value)))];

  if (values.length > 0) return values;

  return formData.get("autoProcessingTypesPresent") === "1" ? [] : ["summary"];
}

// parseSettingsForm converts the settings form into a validated user settings object.
export function parseSettingsForm(formData: FormData): UserSettings {
  const parsed = userSettingsSchema.safeParse({
    aiTemperature: getNumberField(formData, "aiTemperature", 0.2),
    audioRetentionPolicy: getStringField(formData, "audioRetentionPolicy", "keep_audio"),
    autoProcessAfterTranscription: formData.get("autoProcessAfterTranscription") === "on",
    autoProcessingTypes: getProcessingTypes(formData),
    autoTimelineAfterTranscription: formData.get("autoTimelineAfterTranscription") === "on",
    defaultOpenaiModel: getStringField(
      formData,
      "defaultOpenaiModel",
      defaultUserSettings.defaultOpenaiModel
    ),
    liveAudioQuality: getStringField(
      formData,
      "liveAudioQuality",
      defaultUserSettings.liveAudioQuality
    ),
    outputLanguage: getStringField(formData, "outputLanguage", "call_language"),
    sonioxRegion: getStringField(
      formData,
      "sonioxRegion",
      defaultUserSettings.sonioxRegion
    ),
    sonioxRealtimeLanguage: getStringField(
      formData,
      "sonioxRealtimeLanguage",
      defaultUserSettings.sonioxRealtimeLanguage
    ),
    sonioxRealtimeModel: getStringField(formData, "sonioxRealtimeModel", "stt-rt-v5"),
    supabaseStoragePlan: getStringField(
      formData,
      "supabaseStoragePlan",
      defaultUserSettings.supabaseStoragePlan
    ),
    trashRetentionHours: getNumberField(
      formData,
      "trashRetentionHours",
      defaultUserSettings.trashRetentionHours
    )
  });

  if (!parsed.success) {
    throw new Error("Invalid settings form payload.");
  }

  return parsed.data;
}
