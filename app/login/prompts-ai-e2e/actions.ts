"use server";

import { z } from "zod";
import type { PromptTemplateActionState } from "@/lib/prompt-templates/action-state";
import {
  forceFixtureConcurrentChange,
  resetFixturePromptOverride,
  saveFixturePromptOverride,
} from "./fixture-state";

const fixtureOverrideSchema = z.object({
  promptText: z.string().trim().min(20).max(20000),
  revision: z.coerce.number().int().min(0),
  systemPromptId: z.uuid(),
});
const fixtureResetSchema = fixtureOverrideSchema.omit({ promptText: true }).extend({
  revision: z.coerce.number().int().positive(),
});
const conflictMessage = "Prompt se mezitím změnil v jiné kartě. Obnovte stránku a zkuste změnu znovu.";

// assertDevelopmentAction prevents fixture actions from becoming a production mutation surface.
function assertDevelopmentAction() {
  if (process.env.NODE_ENV !== "development") throw new Error("Fixture is unavailable.");
}

// saveFixturePromptOverrideAction emulates an isolated save and deterministic stale-revision conflict.
export async function saveFixturePromptOverrideAction(
  scope: string,
  actionMode: "conflict" | null,
  _state: PromptTemplateActionState,
  formData: FormData,
): Promise<PromptTemplateActionState> {
  assertDevelopmentAction();
  const parsed = fixtureOverrideSchema.safeParse({
    promptText: formData.get("promptText"),
    revision: formData.get("revision"),
    systemPromptId: formData.get("systemPromptId"),
  });
  if (!parsed.success) return fixtureFailureState("Prompt se nepodařilo uložit.");

  await new Promise((resolve) => setTimeout(resolve, 300));
  if (actionMode === "conflict") {
    forceFixtureConcurrentChange(scope, parsed.data.systemPromptId);
  }
  const revision = saveFixturePromptOverride(
    scope,
    parsed.data.systemPromptId,
    parsed.data.revision,
    parsed.data.promptText,
  );
  if (revision === null) return fixtureConflictState();

  return {
    message: "AI prompt je uložený.",
    revision,
    status: "success",
    systemPromptId: parsed.data.systemPromptId,
  };
}

// resetFixturePromptOverrideAction emulates a revision-checked reset to the system prompt.
export async function resetFixturePromptOverrideAction(
  scope: string,
  _state: PromptTemplateActionState,
  formData: FormData,
): Promise<PromptTemplateActionState> {
  assertDevelopmentAction();
  const parsed = fixtureResetSchema.safeParse({
    revision: formData.get("revision"),
    systemPromptId: formData.get("systemPromptId"),
  });
  if (!parsed.success) return fixtureFailureState("Prompt se nepodařilo obnovit.");

  await new Promise((resolve) => setTimeout(resolve, 300));
  const revision = resetFixturePromptOverride(scope, parsed.data.systemPromptId, parsed.data.revision);
  if (revision === null) return fixtureConflictState();

  return {
    message: "AI prompt používá systémové nastavení.",
    revision,
    status: "success",
    systemPromptId: parsed.data.systemPromptId,
  };
}

// fixtureConflictState exposes only the same allowlisted concurrency message as production.
function fixtureConflictState(): PromptTemplateActionState {
  return {
    message: conflictMessage,
    revision: null,
    status: "conflict",
    systemPromptId: null,
  };
}

// fixtureFailureState keeps internal fixture details out of the browser response.
function fixtureFailureState(message: string): PromptTemplateActionState {
  return {
    message,
    revision: null,
    status: "error",
    systemPromptId: null,
  };
}

// rejectAiDeleteAction proves exact optimistic restoration without touching stored output rows.
export async function rejectAiDeleteAction(_formData: FormData): Promise<void> {
  assertDevelopmentAction();
  throw new Error("fixture-private-delete-failure");
}
