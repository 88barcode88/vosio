export type PromptTemplateActionState = {
  message: string | null;
  status: "idle" | "error" | "success" | "conflict";
  systemPromptId?: string | null;
  revision?: number | null;
};

// createInitialPromptTemplateActionState returns the stable state shared by prompt editor actions.
export function createInitialPromptTemplateActionState(): PromptTemplateActionState {
  return {
    message: null,
    revision: null,
    status: "idle",
    systemPromptId: null,
  };
}
