export type PromptTemplateActionState = {
  message: string | null;
  status: "idle" | "error" | "success";
  templateId: string | null;
};

// createInitialPromptTemplateActionState returns the stable state shared by prompt editor actions.
export function createInitialPromptTemplateActionState(): PromptTemplateActionState {
  return { message: null, status: "idle", templateId: null };
}
