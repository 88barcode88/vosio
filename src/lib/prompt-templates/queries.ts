import type { SupabaseClient } from "@supabase/supabase-js";
import type { PromptTemplateRow } from "@/lib/prompt-templates/types";

// listPromptTemplates loads system and user-owned prompt templates through Supabase RLS.
export async function listPromptTemplates(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("prompt_templates")
    .select(
      "id,created_at,updated_at,is_system,name,output_schema,processing_type,prompt_text,user_id"
    )
    .order("is_system", { ascending: false })
    .order("processing_type", { ascending: true })
    .returns<PromptTemplateRow[]>();

  if (error) {
    throw new Error(`Unable to load prompt templates: ${error.message}`);
  }

  return data ?? [];
}
