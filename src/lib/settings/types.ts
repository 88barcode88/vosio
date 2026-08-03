import { z } from "zod";
import {
  aiModelIds,
  DEFAULT_AI_MODEL_ID,
  normalizeAiModelId,
  sonioxRealtimeModelIds
} from "@/lib/model-options";

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
  defaultOpenaiModel: DEFAULT_AI_MODEL_ID,
  longRecordingWarningMinutes: 60,
  outputLanguage: "call_language",
  sonioxRealtimeModel: "stt-rt-v5"
} satisfies UserSettings;

export const userSettingsSchema = z.object({
  aiTemperature: z.number().min(0).max(2),
  audioRetentionPolicy: z.enum(audioRetentionPolicies),
  autoProcessAfterTranscription: z.boolean(),
  autoProcessingTypes: z.array(z.enum(settingsProcessingTypes)),
  defaultOpenaiModel: aiModelSchema,
  longRecordingWarningMinutes: z.number().int().min(5).max(24 * 60),
  outputLanguage: z.enum(outputLanguages),
  sonioxRealtimeModel: sonioxRealtimeModelSchema
});

export type UserSettings = z.infer<typeof userSettingsSchema>;
