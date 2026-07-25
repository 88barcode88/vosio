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
});
