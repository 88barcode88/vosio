export const quickPromptProcessingTypes = [
  "summary",
  "action_items",
  "timeline_chapters",
  "meeting_minutes",
  "crm_note",
  "follow_up_email",
] as const;

export type QuickPromptProcessingType = typeof quickPromptProcessingTypes[number];

export type EffectivePromptRpcRow = {
  system_prompt_id: string;
  override_id: string | null;
  name: string;
  processing_type: QuickPromptProcessingType;
  prompt_text: string;
  output_schema: unknown;
  source: "system" | "user_override";
  revision: number | null;
};

// mapEffectivePromptRow preserves the system identity/schema while exposing the owner's effective text.
export function mapEffectivePromptRow(row: EffectivePromptRpcRow) {
  return {
    systemPromptId: row.system_prompt_id,
    overrideId: row.override_id,
    name: row.name,
    processingType: row.processing_type,
    promptText: row.prompt_text,
    outputSchema: row.output_schema,
    source: row.source,
    isModified: row.source === "user_override",
    revision: row.revision ?? 0,
  } as const;
}
