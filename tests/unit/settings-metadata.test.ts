import { describe, expect, it } from "vitest";
import { getUserSettingsFromMetadata, USER_SETTINGS_METADATA_KEY } from "@/lib/settings/metadata";
import { DEFAULT_AI_MODEL_ID } from "@/lib/model-options";

describe("settings metadata", () => {
  it("defaults missing and invalid Trash retention metadata to thirty days", () => {
    expect(getUserSettingsFromMetadata({} as never).trashRetentionHours).toBe(720);
    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { trashRetentionHours: 48 }
    }).trashRetentionHours).toBe(720);
  });

  it.each([24, 168, 720] as const)("keeps the supported %s-hour Trash retention", (hours) => {
    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { trashRetentionHours: hours }
    }).trashRetentionHours).toBe(hours);
  });

  it("keeps automatic timeline generation opt-in off for legacy metadata", () => {
    expect(getUserSettingsFromMetadata({} as never).autoTimelineAfterTranscription).toBe(false);
  });

  it("does not reinterpret dormant automatic-processing metadata as timeline consent", () => {
    const settings = getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: {
        autoProcessAfterTranscription: true,
        autoProcessingTypes: ["summary", "action_items"]
      }
    });

    expect(settings.autoTimelineAfterTranscription).toBe(false);
    expect(settings.autoProcessAfterTranscription).toBe(true);
    expect(settings.autoProcessingTypes).toEqual(["summary", "action_items"]);
  });

  it("keeps explicit automatic timeline consent", () => {
    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { autoTimelineAfterTranscription: true }
    }).autoTimelineAfterTranscription).toBe(true);
  });

  it.each([
    ["empty metadata", {}],
    ["legacy metadata", { display_name: "Marie" }]
  ])("defaults %s to the global Soniox region", (_label, metadata) => {
    expect(getUserSettingsFromMetadata(metadata).sonioxRegion).toBe("global");
  });

  it("preserves the global Soniox region default for partial settings metadata", () => {
    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { outputLanguage: "en" }
    }).sonioxRegion).toBe("global");
  });

  it("keeps a valid saved Soniox EU region", () => {
    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { sonioxRegion: "eu" }
    }).sonioxRegion).toBe("eu");
  });

  it("rejects an invalid Soniox region and restores the safe defaults", () => {
    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { sonioxRegion: "jp" }
    })).toEqual(expect.objectContaining({
      aiTemperature: 0.2,
      sonioxRegion: "global",
      supabaseStoragePlan: "auto"
    }));
  });

  it("defaults legacy metadata to automatic Supabase plan detection", () => {
    expect(getUserSettingsFromMetadata({} as never).supabaseStoragePlan).toBe("auto");
  });

  it("keeps a valid per-user Supabase storage plan", () => {
    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { supabaseStoragePlan: "paid" }
    }).supabaseStoragePlan).toBe("paid");
  });

  it("rejects an invalid Supabase storage plan and falls back safely", () => {
    expect(getUserSettingsFromMetadata({
      [USER_SETTINGS_METADATA_KEY]: { supabaseStoragePlan: "enterprise" }
    }).supabaseStoragePlan).toBe("auto");
  });

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
