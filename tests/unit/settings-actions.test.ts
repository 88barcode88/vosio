import { describe, expect, it, vi } from "vitest";

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

describe("settings form", () => {
  it("keeps the paid storage preference in a complete settings submission without dropping metadata", async () => {
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
                  outputLanguage: "en",
                  supabaseStoragePlan: "paid"
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
    formData.set("audioRetentionPolicy", "delete_audio_after_transcription");
    formData.set("autoProcessAfterTranscription", "on");
    formData.append("autoProcessingTypes", "summary");
    formData.append("autoProcessingTypes", "action_items");
    formData.set("defaultOpenaiModel", "gpt-5.6-terra");
    formData.set("outputLanguage", "cs");
    formData.set("sonioxRealtimeLanguage", "de");
    formData.set("sonioxRealtimeModel", "stt-rt-v5");
    formData.set("supabaseStoragePlan", "paid");

    await updateUserSettingsAction(formData);

    expect(updateUser).toHaveBeenCalledWith({
      data: {
        display_name: "Marie",
        onboarding_complete: true,
        vosio_settings: {
          aiTemperature: 0,
          audioRetentionPolicy: "delete_audio_after_transcription",
          autoProcessAfterTranscription: true,
          autoProcessingTypes: ["summary", "action_items"],
          defaultOpenaiModel: "gpt-5.6-terra",
          outputLanguage: "cs",
          sonioxRealtimeLanguage: "de",
          sonioxRealtimeModel: "stt-rt-v5",
          supabaseStoragePlan: "paid"
        }
      }
    });
  });

  it("parses the selected Supabase storage plan", () => {
    const formData = new FormData();
    formData.set("supabaseStoragePlan", "free");

    expect(parseSettingsForm(formData).supabaseStoragePlan).toBe("free");
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

  it("rejects an unsupported Soniox live language", () => {
    const formData = new FormData();
    formData.set("sonioxRealtimeLanguage", "xx");

    expect(() => parseSettingsForm(formData)).toThrow("Invalid settings form payload.");
  });
});
