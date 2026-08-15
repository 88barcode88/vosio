import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mapEffectivePromptRow,
  quickPromptProcessingTypes,
  type EffectivePromptRpcRow,
} from "@/lib/prompt-templates/effective";

// listEffectivePromptTemplates resolves the six owner-scoped quick-action prompts through authenticated RPC calls.
export async function listEffectivePromptTemplates(supabase: SupabaseClient) {
  return Promise.all(quickPromptProcessingTypes.map(async (processingType) => {
    const { data, error } = await supabase
      .rpc("resolve_effective_prompt_template_v1", { p_processing_type: processingType })
      .returns<EffectivePromptRpcRow[]>()
      .single();

    if (error || !data) {
      throw new Error(`Unable to resolve ${processingType} prompt`);
    }

    return mapEffectivePromptRow(data);
  }));
}
