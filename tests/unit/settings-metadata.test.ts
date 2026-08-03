import { describe, expect, it } from "vitest";
import { getUserSettingsFromMetadata, USER_SETTINGS_METADATA_KEY } from "@/lib/settings/metadata";

describe("settings metadata", () => {
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
    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { defaultOpenaiModel: "gpt-4.1-mini" }
    }).defaultOpenaiModel).toBe("gpt-5.6-terra");

    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { defaultOpenaiModel: "gemini-3.5-flash" }
    }).defaultOpenaiModel).toBe("gemini-3.6-flash");
  });
});
