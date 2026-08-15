import { mapEffectivePromptRow, type QuickPromptProcessingType } from "@/lib/prompt-templates/effective";
import type { EffectivePromptTemplate } from "@/lib/prompt-templates/types";

type FixtureSystemPrompt = {
  id: string;
  name: string;
  processingType: QuickPromptProcessingType;
  promptText: string;
};

type FixtureOverride = {
  active: boolean;
  promptText: string;
  revision: number;
};

type FixtureScopeState = Map<string, FixtureOverride>;

const fixtureStoreKey = "__vosioPromptOverrideFixtureStore";

export const fixtureActionItemsId = "00000000-0000-4000-8000-000000000952";
export const fixtureConcurrentActionItemsPrompt = "Současná změna z jiné karty má přednost před zastaralým konceptem.";

const fixtureSystemPrompts: readonly FixtureSystemPrompt[] = [
  {
    id: "00000000-0000-4000-8000-000000000951",
    name: "Systémové shrnutí",
    processingType: "summary",
    promptText: "Shrň hovor podle systémového kontraktu a uváděj pouze doložené závěry z přepisu.",
  },
  {
    id: fixtureActionItemsId,
    name: "Systémové úkoly",
    processingType: "action_items",
    promptText: "Najdi v přepisu potvrzené úkoly, termíny a jejich vlastníky.",
  },
  {
    id: "00000000-0000-4000-8000-000000000953",
    name: "Systémová časová osa",
    processingType: "timeline_chapters",
    promptText: "Rozděl přepis do věcných časových kapitol podle průběhu hovoru.",
  },
  {
    id: "00000000-0000-4000-8000-000000000954",
    name: "Systémový zápis ze schůzky",
    processingType: "meeting_minutes",
    promptText: "Vytvoř stručný zápis schůzky s rozhodnutími, úkoly a otevřenými otázkami.",
  },
  {
    id: "00000000-0000-4000-8000-000000000955",
    name: "Systémová CRM poznámka",
    processingType: "crm_note",
    promptText: "Připrav přesnou CRM poznámku s kontextem, stavem příležitosti a dalšími kroky.",
  },
  {
    id: "00000000-0000-4000-8000-000000000956",
    name: "Systémový e-mail po hovoru",
    processingType: "follow_up_email",
    promptText: "Vytvoř konkrétní follow-up e-mail a zachovej všechny potvrzené dohody z hovoru.",
  },
];

// getFixturePromptTemplates resolves system metadata with the active scoped override.
export function getFixturePromptTemplates(scope: string): EffectivePromptTemplate[] {
  const scopeState = getFixtureScopeState(scope);
  return fixtureSystemPrompts.map((systemPrompt) => {
    const override = scopeState.get(systemPrompt.id);
    const activeOverride = override?.active ? override : null;
    return mapEffectivePromptRow({
      name: systemPrompt.name,
      output_schema: {
        additionalProperties: false,
        properties: { markdown: { type: "string" } },
        required: ["markdown"],
        type: "object",
      },
      override_id: activeOverride ? `10000000-0000-4000-8000-${systemPrompt.id.slice(-12)}` : null,
      processing_type: systemPrompt.processingType,
      prompt_text: activeOverride?.promptText ?? systemPrompt.promptText,
      revision: activeOverride?.revision ?? null,
      source: activeOverride ? "user_override" : "system",
      system_prompt_id: systemPrompt.id,
    });
  });
}

// saveFixturePromptOverride emulates the optimistic revision contract used by the production RPC.
export function saveFixturePromptOverride(
  scope: string,
  systemPromptId: string,
  expectedRevision: number,
  promptText: string,
) {
  const scopeState = getFixtureScopeState(scope);
  const current = scopeState.get(systemPromptId);
  const visibleRevision = current?.active ? current.revision : 0;
  if (!isFixtureSystemPrompt(systemPromptId) || visibleRevision !== expectedRevision) return null;

  const nextRevision = (current?.revision ?? 0) + 1;
  scopeState.set(systemPromptId, { active: true, promptText, revision: nextRevision });
  return nextRevision;
}

// resetFixturePromptOverride deactivates a matching active revision without deleting its history row.
export function resetFixturePromptOverride(scope: string, systemPromptId: string, expectedRevision: number) {
  const scopeState = getFixtureScopeState(scope);
  const current = scopeState.get(systemPromptId);
  if (!current?.active || current.revision !== expectedRevision) return null;

  const nextRevision = current.revision + 1;
  scopeState.set(systemPromptId, { ...current, active: false, revision: nextRevision });
  return nextRevision;
}

// forceFixtureConcurrentChange creates one newer row so a stale submitted revision must conflict.
export function forceFixtureConcurrentChange(scope: string, systemPromptId: string) {
  const scopeState = getFixtureScopeState(scope);
  const current = scopeState.get(systemPromptId);
  scopeState.set(systemPromptId, {
    active: true,
    promptText: fixtureConcurrentActionItemsPrompt,
    revision: (current?.revision ?? 0) + 1,
  });
}

// getFixtureScopeState isolates browser workers while keeping page renders and server actions consistent.
function getFixtureScopeState(scope: string) {
  const runtime = globalThis as typeof globalThis & {
    [fixtureStoreKey]?: Map<string, FixtureScopeState>;
  };
  runtime[fixtureStoreKey] ??= new Map<string, FixtureScopeState>();
  const store = runtime[fixtureStoreKey];
  let scopeState = store.get(scope);
  if (!scopeState) {
    scopeState = new Map<string, FixtureOverride>();
    store.set(scope, scopeState);
  }
  return scopeState;
}

// isFixtureSystemPrompt rejects action ids outside the six authoritative fixture prompts.
function isFixtureSystemPrompt(systemPromptId: string) {
  return fixtureSystemPrompts.some((prompt) => prompt.id === systemPromptId);
}
