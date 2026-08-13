"use server";

import type { PromptTemplateActionState } from "@/lib/prompt-templates/action-state";

const fixtureUserTemplateId = "00000000-0000-4000-8000-000000000902";

// assertDevelopmentAction prevents fixture actions from becoming a production mutation surface.
function assertDevelopmentAction() {
  if (process.env.NODE_ENV !== "development") throw new Error("Fixture is unavailable.");
}

// inertPromptAction settles locally without a database, provider or network mutation.
export async function inertPromptAction(
  _state: PromptTemplateActionState,
  _formData: FormData
): Promise<PromptTemplateActionState> {
  assertDevelopmentAction();
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { message: "Fixture zůstala pouze lokální.", status: "success", templateId: fixtureUserTemplateId };
}

// rejectPromptAction settles a safe validation-style failure while the browser keeps its draft mounted.
export async function rejectPromptAction(
  _state: PromptTemplateActionState,
  _formData: FormData
): Promise<PromptTemplateActionState> {
  assertDevelopmentAction();
  await new Promise((resolve) => setTimeout(resolve, 700));
  return { message: "Prompt se nepodařilo uložit. Zkontrolujte povinná pole a JSON schéma.", status: "error", templateId: null };
}

// rejectAiDeleteAction proves exact optimistic restoration without touching stored output rows.
export async function rejectAiDeleteAction(_formData: FormData): Promise<void> {
  assertDevelopmentAction();
  throw new Error("fixture-private-delete-failure");
}
