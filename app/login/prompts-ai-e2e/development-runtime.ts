const fixtureScopePattern = /^[0-9a-f]{12}$/;

export type PromptsAiFixtureView = "templates" | "ai";

// validatePromptsAiFixtureAccess keeps inert prompt/archive fixtures development-only and scoped.
export function validatePromptsAiFixtureAccess(
  nodeEnv: string | undefined,
  scope: string | undefined,
  view: string | undefined
): { scope: string; view: PromptsAiFixtureView } | null {
  if (nodeEnv !== "development" || !scope || !fixtureScopePattern.test(scope)) return null;
  if (view !== "templates" && view !== "ai") return null;
  return { scope, view };
}
