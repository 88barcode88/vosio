"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
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
  promptText: z.string().trim().min(20)
});

// getRequiredString reads a required FormData text field for prompt template actions.
function getRequiredString(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" ? value : "";
}

// parseOutputSchema converts a textarea JSON schema into a JSONB-safe value.
function parseOutputSchema(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("Invalid output schema JSON.");
  }
}

// parsePromptTemplateForm validates shared prompt template form fields.
function parsePromptTemplateForm(formData: FormData) {
  return promptTemplateFormSchema.parse({
    name: getRequiredString(formData, "name"),
    outputSchema: parseOutputSchema(getRequiredString(formData, "outputSchema")),
    processingType: getRequiredString(formData, "processingType"),
    promptText: getRequiredString(formData, "promptText")
  });
}

// redirectTemplateError sends invalid prompt form submissions back to templates.
function redirectTemplateError(): never {
  redirect("/templates?error=template_failed");
}

// parsePromptTemplateFormOrRedirect returns valid prompt data or leaves via redirect.
function parsePromptTemplateFormOrRedirect(
  formData: FormData
): z.infer<typeof promptTemplateFormSchema> {
  try {
    return parsePromptTemplateForm(formData);
  } catch {
    redirectTemplateError();
  }
}

// createPromptTemplateAction creates a new user-owned prompt template.
export async function createPromptTemplateAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?next=/templates");
  }

  const parsed = parsePromptTemplateFormOrRedirect(formData);

  const { error } = await supabase.from("prompt_templates").insert({
    is_system: false,
    name: parsed.name,
    output_schema: parsed.outputSchema,
    processing_type: parsed.processingType,
    prompt_text: parsed.promptText,
    user_id: user.id
  });

  if (error) {
    redirectTemplateError();
  }

  revalidatePath("/templates");
  redirect("/templates?created=1");
}

// updatePromptTemplateAction updates a user-owned prompt template through RLS.
export async function updatePromptTemplateAction(formData: FormData) {
  const templateId = getRequiredString(formData, "templateId");
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?next=/templates");
  }

  const parsed = parsePromptTemplateFormOrRedirect(formData);

  const { data, error } = await supabase
    .from("prompt_templates")
    .update({
      name: parsed.name,
      output_schema: parsed.outputSchema,
      processing_type: parsed.processingType,
      prompt_text: parsed.promptText
    })
    .eq("id", templateId)
    .eq("is_system", false)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirectTemplateError();
  }

  revalidatePath("/templates");
  redirect("/templates?saved=1");
}

// duplicatePromptTemplateAction saves edited system template values as a user-owned copy.
export async function duplicatePromptTemplateAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?next=/templates");
  }

  const parsed = parsePromptTemplateFormOrRedirect(formData);

  const { error } = await supabase.from("prompt_templates").insert({
    is_system: false,
    name: `${parsed.name} - vlastní`,
    output_schema: parsed.outputSchema,
    processing_type: parsed.processingType,
    prompt_text: parsed.promptText,
    user_id: user.id
  });

  if (error) {
    redirectTemplateError();
  }

  revalidatePath("/templates");
  redirect("/templates?duplicated=1");
}
