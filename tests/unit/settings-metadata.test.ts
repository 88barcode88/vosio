import { describe, expect, it } from "vitest";
import { getUserSettingsFromMetadata, USER_SETTINGS_METADATA_KEY } from "@/lib/settings/metadata";
import { DEFAULT_AI_MODEL_ID } from "@/lib/model-options";

describe("settings metadata", () => {
  it("defaults live language detection for legacy metadata", () => {
    expect(getUserSettingsFromMetadata({} as never).sonioxRealtimeLanguage).toBe("auto");
  });

  it("keeps a valid default Soniox live language", () => {
    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { sonioxRealtimeLanguage: "de" }
    }).sonioxRealtimeLanguage).toBe("de");
  });

  it("rejects an invalid live language and falls back to safe defaults", () => {
    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { sonioxRealtimeLanguage: "xx" }
    }).sonioxRealtimeLanguage).toBe("auto");
  });

  it("ignores the removed long-recording warning preference", () => {
    const settings = getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { longRecordingWarningMinutes: 60 }
    });

    expect(settings.sonioxRealtimeLanguage).toBe("auto");
    expect(settings).not.toHaveProperty("longRecordingWarningMinutes");
  });

  it("upgrades legacy Soniox realtime model metadata without dropping other settings", () => {
    const settings = getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: {
        aiTemperature: 0.7,
        sonioxRealtimeModel: "stt-rt-v4"
      }
    });

    expect(settings.aiTemperature).toBe(0.7);
    expect(settings.sonioxRealtimeModel).toBe("stt-rt-v5");
  });

  it("migrates removed AI models to the new provider defaults", () => {
    expect(DEFAULT_AI_MODEL_ID).toBe("gpt-5.6-terra");

    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { defaultOpenaiModel: "gpt-4.1-mini" }
    }).defaultOpenaiModel).toBe("gpt-5.6-terra");

    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { defaultOpenaiModel: "gpt-5.4" }
    }).defaultOpenaiModel).toBe("gpt-5.6-terra");

    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { defaultOpenaiModel: "gpt-5.4-mini" }
    }).defaultOpenaiModel).toBe("gpt-5.6-terra");

    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { defaultOpenaiModel: "gemini-3.5-flash" }
    }).defaultOpenaiModel).toBe("gemini-3.6-flash");
  });
});
