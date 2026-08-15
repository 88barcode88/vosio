"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PromptTemplateActionState } from "@/lib/prompt-templates/action-state";
import { createClient } from "@/lib/supabase/server";

const saveRevisionSchema = z.string()
  .regex(/^(0|[1-9]\d*)$/u)
  .transform(Number)
  .refine(Number.isSafeInteger);
const resetRevisionSchema = z.string()
  .regex(/^[1-9]\d*$/u)
  .transform(Number)
  .refine(Number.isSafeInteger);
const overrideFormSchema = z.object({
  systemPromptId: z.uuid(),
  revision: saveRevisionSchema,
  promptText: z.string().trim().min(20).max(20000),
});
const resetFormSchema = overrideFormSchema.omit({ promptText: true }).extend({
  revision: resetRevisionSchema,
});
const saveFailureMessage = "Prompt se nepodařilo uložit.";
const resetFailureMessage = "Prompt se nepodařilo obnovit.";

// getAuthenticatedPromptClient returns the request client or follows the normal login recovery path.
async function getAuthenticatedPromptClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/templates");
  return supabase;
}

// conflictOrFailure maps only the stable concurrency code and keeps all database details server-private.
function conflictOrFailure(
  error: { code?: string } | null,
  failureMessage: string,
): PromptTemplateActionState {
  return error?.code === "40001"
    ? {
        status: "conflict",
        message: "Prompt se mezitím změnil v jiné kartě. Obnovte stránku a zkuste změnu znovu.",
        systemPromptId: null,
        revision: null,
      }
    : {
        status: "error",
        message: failureMessage,
        systemPromptId: null,
        revision: null,
      };
}

// savePromptOverrideAction persists only prompt text against an authoritative system prompt revision.
export async function savePromptOverrideAction(
  _previousState: PromptTemplateActionState,
  formData: FormData,
): Promise<PromptTemplateActionState> {
  const parsed = overrideFormSchema.safeParse({
    systemPromptId: formData.get("systemPromptId"),
    revision: formData.get("revision"),
    promptText: formData.get("promptText"),
  });
  if (!parsed.success) return conflictOrFailure(null, saveFailureMessage);

  try {
    const supabase = await getAuthenticatedPromptClient();
    const { data, error } = await supabase.rpc("save_prompt_template_override_v1", {
      p_system_prompt_id: parsed.data.systemPromptId,
      p_prompt_text: parsed.data.promptText,
      p_expected_revision: parsed.data.revision,
    }).returns<Array<{ revision: number }>>().single();

    if (error || !data) return conflictOrFailure(error, saveFailureMessage);
    revalidatePath("/templates");
    return {
      status: "success",
      message: "AI prompt je uložený.",
      systemPromptId: parsed.data.systemPromptId,
      revision: data.revision,
    };
  } catch (error) {
    if (isRedirectSignal(error)) throw error;
    return conflictOrFailure(null, saveFailureMessage);
  }
}

// resetPromptOverrideAction deactivates one owner override using its expected revision.
export async function resetPromptOverrideAction(
  _previousState: PromptTemplateActionState,
  formData: FormData,
): Promise<PromptTemplateActionState> {
  const parsed = resetFormSchema.safeParse({
    systemPromptId: formData.get("systemPromptId"),
    revision: formData.get("revision"),
  });
  if (!parsed.success) return conflictOrFailure(null, resetFailureMessage);

  try {
    const supabase = await getAuthenticatedPromptClient();
    const { data, error } = await supabase.rpc("reset_prompt_template_override_v1", {
      p_system_prompt_id: parsed.data.systemPromptId,
      p_expected_revision: parsed.data.revision,
    }).returns<Array<{ revision: number }>>().single();

    if (error || !data) return conflictOrFailure(error, resetFailureMessage);
    revalidatePath("/templates");
    return {
      status: "success",
      message: "AI prompt používá systémové nastavení.",
      systemPromptId: parsed.data.systemPromptId,
      revision: data.revision,
    };
  } catch (error) {
    if (isRedirectSignal(error)) throw error;
    return conflictOrFailure(null, resetFailureMessage);
  }
}

// isRedirectSignal preserves Next navigation control flow across safe action error handling.
function isRedirectSignal(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT");
}
