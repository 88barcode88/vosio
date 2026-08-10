"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PromptTemplateActionState } from "@/lib/prompt-templates/action-state";
import { createClient } from "@/lib/supabase/server";

const promptProcessingTypes = [
  "summary",
  "action_items",
  "meeting_minutes",
  "timeline_chapters",
  "structured_extraction",
  "crm_note",
  "follow_up_email",
  "custom_prompt"
] as const;

const promptTemplateFormSchema = z.object({
  name: z.string().trim().min(2).max(120),
  outputSchema: z.unknown(),
  processingType: z.enum(promptProcessingTypes),
  promptText: z.string().trim().min(20),
  templateId: z.uuid().optional()
});

const genericFailure = "Prompt se nepodařilo uložit. Zkontrolujte povinná pole a JSON schéma.";

// getRequiredString reads one FormData text field without trusting non-string values.
function getRequiredString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// parseOutputSchema converts textarea JSON into a JSONB-safe value.
function parseOutputSchema(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as unknown;
}

// parsePromptTemplateForm validates editable fields while preserving the mounted browser draft on failure.
function parsePromptTemplateForm(formData: FormData) {
  try {
    return promptTemplateFormSchema.safeParse({
      name: getRequiredString(formData, "name"),
      outputSchema: parseOutputSchema(getRequiredString(formData, "outputSchema")),
      processingType: getRequiredString(formData, "processingType"),
      promptText: getRequiredString(formData, "promptText"),
      templateId: getRequiredString(formData, "templateId") || undefined
    });
  } catch {
    return { success: false as const };
  }
}

// getAuthenticatedPromptClient returns the request client or follows the normal login recovery path.
async function getAuthenticatedPromptClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/templates");
  return { supabase, user };
}

// failureState returns a sanitized action result without replacing the user's mounted draft.
function failureState(message = genericFailure): PromptTemplateActionState {
  return { message, status: "error", templateId: null };
}

// successState identifies the newly selected or updated prompt editor.
function successState(templateId: string, message: string): PromptTemplateActionState {
  return { message, status: "success", templateId };
}

// createPromptTemplateAction creates a new user-owned prompt through the authenticated RLS client.
export async function createPromptTemplateAction(
  _previousState: PromptTemplateActionState,
  formData: FormData
): Promise<PromptTemplateActionState> {
  const parsed = parsePromptTemplateForm(formData);
  if (!parsed.success) return failureState();

  try {
    const { supabase, user } = await getAuthenticatedPromptClient();
    const { data, error } = await supabase.from("prompt_templates").insert({
      is_system: false,
      name: parsed.data.name,
      output_schema: parsed.data.outputSchema,
      processing_type: parsed.data.processingType,
      prompt_text: parsed.data.promptText,
      user_id: user.id
    }).select("id").maybeSingle();

    if (error || !data?.id) return failureState();
    revalidatePath("/templates");
    return successState(data.id, "Prompt je vytvořený.");
  } catch (error) {
    if (isRedirectSignal(error)) throw error;
    return failureState();
  }
}

// updatePromptTemplateAction updates only the current user's non-system prompt through RLS.
export async function updatePromptTemplateAction(
  _previousState: PromptTemplateActionState,
  formData: FormData
): Promise<PromptTemplateActionState> {
  const parsed = parsePromptTemplateForm(formData);
  if (!parsed.success || !parsed.data.templateId) return failureState();

  try {
    const { supabase, user } = await getAuthenticatedPromptClient();
    const { data, error } = await supabase
      .from("prompt_templates")
      .update({
        name: parsed.data.name,
        output_schema: parsed.data.outputSchema,
        processing_type: parsed.data.processingType,
        prompt_text: parsed.data.promptText
      })
      .eq("id", parsed.data.templateId)
      .eq("is_system", false)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error || !data?.id) return failureState();
    revalidatePath("/templates");
    return successState(data.id, "Prompt je uložený.");
  } catch (error) {
    if (isRedirectSignal(error)) throw error;
    return failureState();
  }
}

// duplicatePromptTemplateAction copies only an authoritative system row fetched by id and system flag.
export async function duplicatePromptTemplateAction(
  _previousState: PromptTemplateActionState,
  formData: FormData
): Promise<PromptTemplateActionState> {
  const templateId = z.uuid().safeParse(getRequiredString(formData, "templateId"));
  if (!templateId.success) return failureState("Systémový prompt nebyl nalezen.");

  try {
    const { supabase, user } = await getAuthenticatedPromptClient();
    const { data: source, error: sourceError } = await supabase
      .from("prompt_templates")
      .select("id,is_system,name,output_schema,processing_type,prompt_text")
      .eq("id", templateId.data)
      .eq("is_system", true)
      .maybeSingle();

    if (sourceError || !source || !source.is_system) {
      return failureState("Systémový prompt nebyl nalezen.");
    }

    const { data, error } = await supabase.from("prompt_templates").insert({
      is_system: false,
      name: `${source.name} - vlastní`,
      output_schema: source.output_schema,
      processing_type: source.processing_type,
      prompt_text: source.prompt_text,
      user_id: user.id
    }).select("id").maybeSingle();

    if (error || !data?.id) return failureState();
    revalidatePath("/templates");
    return successState(data.id, "Vlastní kopie systémového promptu je vytvořená.");
  } catch (error) {
    if (isRedirectSignal(error)) throw error;
    return failureState();
  }
}

// isRedirectSignal preserves Next navigation control flow across safe action error handling.
function isRedirectSignal(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT");
}
