import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { parseSettingsForm } from "@/lib/settings/form";
import { updateUserSettingsAction } from "@/lib/settings/actions";
import { idleSettingsActionState } from "@/lib/settings/action-state";

beforeEach(() => {
  mocks.createClient.mockReset();
  mocks.redirect.mockReset();
  mocks.revalidatePath.mockReset();
});

// createCompleteSettingsForm supplies every active and stored-only field to the real save action.
function createCompleteSettingsForm(region: "eu" | "global") {
  const formData = new FormData();
  formData.set("aiTemperature", "0.7");
  formData.set("audioRetentionPolicy", "delete_audio_after_transcription");
  formData.set("autoProcessAfterTranscription", "on");
  formData.set("autoProcessingTypesPresent", "1");
  formData.append("autoProcessingTypes", "summary");
  formData.set("defaultOpenaiModel", "gpt-5.6-terra");
  formData.set("outputLanguage", "cs");
  formData.set("sonioxRegion", region);
  formData.set("sonioxRealtimeLanguage", "de");
  formData.set("sonioxRealtimeModel", "stt-rt-v5");
  formData.set("supabaseStoragePlan", "paid");
  return formData;
}

describe("settings form", () => {
  it("updates a storage preference without dropping the saved temperature or unrelated metadata", async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              user_metadata: {
                display_name: "Marie",
                onboarding_complete: true,
                vosio_settings: {
                  aiTemperature: 0.7,
                  outputLanguage: "en",
                  supabaseStoragePlan: "free"
                }
              }
            }
          },
          error: null
        }),
        updateUser
      }
    });

    const formData = new FormData();
    formData.set("aiTemperature", "0.7");
    formData.set("audioRetentionPolicy", "delete_audio_after_transcription");
    formData.set("autoProcessAfterTranscription", "on");
    formData.set("autoProcessingTypesPresent", "1");
    formData.append("autoProcessingTypes", "summary");
    formData.append("autoProcessingTypes", "action_items");
    formData.set("defaultOpenaiModel", "gpt-5.6-terra");
    formData.set("outputLanguage", "cs");
    formData.set("sonioxRegion", "eu");
    formData.set("sonioxRealtimeLanguage", "de");
    formData.set("sonioxRealtimeModel", "stt-rt-v5");
    formData.set("supabaseStoragePlan", "paid");

    await updateUserSettingsAction(idleSettingsActionState, formData);

    expect(updateUser).toHaveBeenCalledWith({
      data: {
        display_name: "Marie",
        onboarding_complete: true,
        vosio_settings: {
          aiTemperature: 0.7,
          audioRetentionPolicy: "delete_audio_after_transcription",
          autoProcessAfterTranscription: true,
          autoProcessingTypes: ["summary", "action_items"],
          defaultOpenaiModel: "gpt-5.6-terra",
          outputLanguage: "cs",
          sonioxRegion: "eu",
          sonioxRealtimeLanguage: "de",
          sonioxRealtimeModel: "stt-rt-v5",
          supabaseStoragePlan: "paid"
        }
      }
    });
  });

  it("preserves only the validated submitted Soniox region when the real Auth update fails", async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: { message: "private provider detail" } });
    const persistedMetadata = { vosio_settings: { sonioxRegion: "global" } };
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { user_metadata: persistedMetadata } },
          error: null
        }),
        updateUser
      }
    });
    const result = await updateUserSettingsAction(
      idleSettingsActionState,
      createCompleteSettingsForm("eu")
    );

    expect(updateUser).toHaveBeenCalledOnce();
    expect(result).toEqual({ errorCode: "save_failed", sonioxRegion: "eu", status: "error" });
    expect(JSON.stringify(result)).not.toContain("private provider detail");
    expect(JSON.stringify(result)).not.toContain("aiTemperature");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(persistedMetadata.vosio_settings.sonioxRegion).toBe("global");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns an allowlisted invalid-form state without exposing submitted fields", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { user_metadata: {} } }, error: null })
      }
    });
    const invalid = createCompleteSettingsForm("eu");
    invalid.set("audioRetentionPolicy", "private-invalid-policy");
    const result = await updateUserSettingsAction(idleSettingsActionState, invalid);

    expect(result).toEqual({ errorCode: "invalid_settings", sonioxRegion: "eu", status: "error" });
    expect(JSON.stringify(result)).not.toContain("private-invalid-policy");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("parses the selected Supabase storage plan", () => {
    const formData = new FormData();
    formData.set("supabaseStoragePlan", "free");

    expect(parseSettingsForm(formData).supabaseStoragePlan).toBe("free");
  });

  it("parses the selected Soniox region", () => {
    const formData = new FormData();
    formData.set("sonioxRegion", "eu");

    expect(parseSettingsForm(formData).sonioxRegion).toBe("eu");
  });

  it("rejects an unsupported Soniox region", () => {
    const formData = new FormData();
    formData.set("sonioxRegion", "jp");

    expect(() => parseSettingsForm(formData)).toThrow("Invalid settings form payload.");
  });

  it("uses the default AI temperature when the field is missing", () => {
    expect(parseSettingsForm(new FormData()).aiTemperature).toBe(0.2);
  });

  it("defaults legacy form submissions to automatic Supabase plan detection", () => {
    expect(parseSettingsForm(new FormData()).supabaseStoragePlan).toBe("auto");
  });

  it("rejects an unsupported Supabase storage plan", () => {
    const formData = new FormData();
    formData.set("supabaseStoragePlan", "team");

    expect(() => parseSettingsForm(formData)).toThrow("Invalid settings form payload.");
  });

  it("parses the selected Soniox live language", () => {
    const formData = new FormData();
    formData.set("sonioxRealtimeLanguage", "de");

    expect(parseSettingsForm(formData).sonioxRealtimeLanguage).toBe("de");
  });

  it("defaults legacy form submissions to automatic language detection", () => {
    const settings = parseSettingsForm(new FormData());

    expect(settings.sonioxRealtimeLanguage).toBe("auto");
    expect(settings).not.toHaveProperty("longRecordingWarningMinutes");
  });

  it("round-trips an explicitly empty automatic processing type collection", () => {
    const formData = new FormData();
    formData.set("autoProcessingTypesPresent", "1");

    expect(parseSettingsForm(formData).autoProcessingTypes).toEqual([]);
  });

  it("keeps the legacy default when automatic processing types are completely missing", () => {
    expect(parseSettingsForm(new FormData()).autoProcessingTypes).toEqual(["summary"]);
  });

  it("deduplicates valid automatic processing types when the collection sentinel is present", () => {
    const formData = new FormData();
    formData.set("autoProcessingTypesPresent", "1");
    formData.append("autoProcessingTypes", "summary");
    formData.append("autoProcessingTypes", "summary");
    formData.append("autoProcessingTypes", "action_items");

    expect(parseSettingsForm(formData).autoProcessingTypes).toEqual(["summary", "action_items"]);
  });

  it("rejects an unsupported Soniox live language", () => {
    const formData = new FormData();
    formData.set("sonioxRealtimeLanguage", "xx");

    expect(() => parseSettingsForm(formData)).toThrow("Invalid settings form payload.");
  });
});
