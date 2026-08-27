import { z } from "zod";
import {
  aiModelIds,
  DEFAULT_AI_MODEL_ID,
  normalizeAiModelId,
  sonioxRealtimeModelIds
} from "@/lib/model-options";
import { sonioxRealtimeLanguageIds } from "@/lib/soniox/languages";
import { sonioxRegionSchema } from "@/lib/soniox/region";

export const settingsProcessingTypes = [
  "summary",
  "action_items",
  "meeting_minutes",
  "crm_note",
  "follow_up_email"
] as const;

export const outputLanguages = ["call_language", "cs", "en"] as const;

export const audioRetentionPolicies = [
  "keep_audio",
  "delete_audio_after_transcription"
] as const;

export const supabaseStoragePlans = ["auto", "free", "paid"] as const;

const sonioxRealtimeModelSchema = z.preprocess(
  (value) => value === "stt-rt-v4" ? "stt-rt-v5" : value,
  z.enum(sonioxRealtimeModelIds)
);

const aiModelSchema = z.preprocess(normalizeAiModelId, z.enum(aiModelIds));

export const defaultUserSettings = {
  aiTemperature: 0.2,
  audioRetentionPolicy: "keep_audio",
  autoProcessAfterTranscription: false,
  autoProcessingTypes: ["summary"],
  autoTimelineAfterTranscription: false,
  defaultOpenaiModel: DEFAULT_AI_MODEL_ID,
  outputLanguage: "call_language",
  sonioxRegion: "global",
  sonioxRealtimeLanguage: "auto",
  sonioxRealtimeModel: "stt-rt-v5",
  supabaseStoragePlan: "auto"
} satisfies UserSettings;

export const userSettingsSchema = z.object({
  aiTemperature: z.number().min(0).max(2),
  audioRetentionPolicy: z.enum(audioRetentionPolicies),
  autoProcessAfterTranscription: z.boolean(),
  autoProcessingTypes: z.array(z.enum(settingsProcessingTypes)),
  autoTimelineAfterTranscription: z.boolean(),
  defaultOpenaiModel: aiModelSchema,
  outputLanguage: z.enum(outputLanguages),
  sonioxRegion: sonioxRegionSchema,
  sonioxRealtimeLanguage: z.enum(sonioxRealtimeLanguageIds),
  sonioxRealtimeModel: sonioxRealtimeModelSchema,
  supabaseStoragePlan: z.enum(supabaseStoragePlans)
});

export type SupabaseStoragePlan = (typeof supabaseStoragePlans)[number];
export type UserSettings = z.infer<typeof userSettingsSchema>;
