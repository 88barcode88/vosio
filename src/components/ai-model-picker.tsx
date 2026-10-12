"use client";

import { useId, type CSSProperties, type KeyboardEvent } from "react";
import {
  aiModelOptions,
  aiReasoningEfforts,
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_REASONING_EFFORT,
  getActiveAiModelOption,
  getAiModelDescription,
  normalizeAiModelId,
  type AiReasoningEffort
} from "@/lib/model-options";

export type AiModelSelection = { model: string; reasoningEffort: AiReasoningEffort };

type AiModelPickerProps = {
  disabled?: boolean;
  modelLabel?: string;
  modelName?: string;
  onChange: (selection: AiModelSelection) => void;
  preserveReasoningPreference?: boolean;
  reasoningName?: string;
  scope: string;
  value: AiModelSelection;
};

const reasoningLabels: Record<AiReasoningEffort, string> = {
  low: "Nízké",
  medium: "Střední",
  high: "Vysoké",
  xhigh: "Velmi vysoké",
  max: "Maximum"
};

// createAiModelSelection normalizes future defaults while retaining a legacy Astra-low preference.
export function createAiModelSelection(model: string, effort?: AiReasoningEffort): AiModelSelection {
  const option = getActiveAiModelOption(String(normalizeAiModelId(model)))
    ?? getActiveAiModelOption(DEFAULT_AI_MODEL_ID)!;
  const preferredEffort = effort ?? (model === "gpt-6-astra-low" ? "low" : DEFAULT_AI_REASONING_EFFORT);
  const validEffort = aiReasoningEfforts.includes(preferredEffort) ? preferredEffort : DEFAULT_AI_REASONING_EFFORT;
  return {
    model: option.id,
    reasoningEffort: option.reasoningEfforts && !option.reasoningEfforts.includes(validEffort)
      ? option.reasoningEfforts.find((candidate) => candidate === DEFAULT_AI_REASONING_EFFORT)
        ?? option.reasoningEfforts[0] ?? DEFAULT_AI_REASONING_EFFORT
      : validEffort
  };
}

// getAiModelReasoningEffort includes only a level advertised by the active model's capabilities.
export function getAiModelReasoningEffort(selection: AiModelSelection) {
  return getActiveAiModelOption(selection.model)?.reasoningEfforts?.includes(selection.reasoningEffort)
    ? selection.reasoningEffort : undefined;
}

// AiModelPicker shares the approved stacked native model selector and discrete reasoning control.
export function AiModelPicker({
  disabled = false,
  modelLabel = "Model AI",
  modelName = "model",
  onChange,
  preserveReasoningPreference = false,
  reasoningName = "reasoningEffort",
  scope,
  value
}: AiModelPickerProps) {
  const id = useId();
  const option = getActiveAiModelOption(value.model) ?? getActiveAiModelOption(DEFAULT_AI_MODEL_ID)!;
  const efforts = option.reasoningEfforts ?? [];
  const supportedEffort = getAiModelReasoningEffort(value);
  const effort = supportedEffort ?? efforts.find((candidate) => candidate === DEFAULT_AI_REASONING_EFFORT) ?? efforts[0];
  const index = effort ? efforts.indexOf(effort) : 0;
  const rangeStyle = { "--ai-reasoning-progress": `${efforts.length > 1 ? index / (efforts.length - 1) * 100 : 0}%` } as CSSProperties;

  // selectEffort bounds pointer and keyboard input to the exact model-supported discrete levels.
  function selectEffort(nextIndex: number) {
    if (disabled || efforts.length === 0) return;
    const nextEffort = efforts[Math.max(0, Math.min(efforts.length - 1, nextIndex))];
    onChange({ model: option.id, reasoningEffort: nextEffort });
  }

  // handleReasoningKeyDown makes arrows, Home and End explicit without relying on pointer dragging.
  function handleReasoningKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? efforts.length - 1
      : event.key === "ArrowRight" || event.key === "ArrowUp" ? index + 1
      : event.key === "ArrowLeft" || event.key === "ArrowDown" ? index - 1 : null;
    if (nextIndex === null) return;
    event.preventDefault();
    selectEffort(nextIndex);
  }

  // selectModel preserves the separate OpenAI preference across providers and respects supported levels.
  function selectModel(model: string) {
    if (disabled) return;
    const nextOption = getActiveAiModelOption(model);
    if (!nextOption) return;
    const nextEffort = nextOption.reasoningEfforts && !nextOption.reasoningEfforts.includes(value.reasoningEffort)
      ? nextOption.reasoningEfforts.find((candidate) => candidate === DEFAULT_AI_REASONING_EFFORT)
        ?? nextOption.reasoningEfforts[0] ?? DEFAULT_AI_REASONING_EFFORT
      : value.reasoningEffort;
    onChange({ model, reasoningEffort: nextEffort });
  }

  return (
    <div className="ai-model-picker" aria-label="Nastavení AI modelu">
      <p className="ai-model-picker-scope" id={`${id}-scope`}>{scope}</p>
      <label className="ai-model-picker-field" htmlFor={`${id}-model`}>
        <span>{modelLabel}</span>
        <select
          aria-describedby={`${id}-scope ${id}-model-hint`}
          disabled={disabled}
          id={`${id}-model`}
          name={modelName}
          onChange={(event) => selectModel(event.currentTarget.value)}
          value={option.id}
        >
          {(["openai", "gemini", "mistral"] as const).map((provider) => (
            <optgroup key={provider} label={{ openai: "OpenAI", gemini: "Google Gemini", mistral: "Mistral" }[provider]}>
              {aiModelOptions.filter((model) => model.provider === provider).map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="ai-model-picker-hint" id={`${id}-model-hint`}>{getAiModelDescription(option.id)}</p>
      {effort ? (
        <div className="ai-model-picker-reasoning">
          <div className="ai-model-picker-reasoning-heading">
            <label htmlFor={`${id}-reasoning`}>Uvažování</label>
            <strong>{reasoningLabels[effort]} <small translate="no">({effort})</small></strong>
          </div>
          <input
            aria-describedby={`${id}-scope ${id}-reasoning-hint`}
            aria-valuetext={`${reasoningLabels[effort]} (${effort})`}
            disabled={disabled}
            id={`${id}-reasoning`}
            max={efforts.length - 1}
            min={0}
            onChange={(event) => selectEffort(Number(event.currentTarget.value))}
            onKeyDown={handleReasoningKeyDown}
            step={1}
            style={rangeStyle}
            type="range"
            value={index}
          />
          <div className="ai-reasoning-choices" aria-label="Stupně uvažování" role="group">
            {efforts.map((level, levelIndex) => (
              <button
                aria-label={`${reasoningLabels[level]} (${level})`}
                aria-pressed={level === effort}
                disabled={disabled}
                key={level}
                onClick={() => selectEffort(levelIndex)}
                type="button"
              >
                <span>{reasoningLabels[level]}</span><small translate="no">{level}</small>
              </button>
            ))}
          </div>
          <p className="ai-model-picker-hint" id={`${id}-reasoning-hint`}>
            Vyšší úroveň může prodloužit zpracování a zvýšit cenu. Žádný model nezaručuje úplnost.
          </p>
        </div>
      ) : (
        <p className="ai-model-picker-hint">U tohoto modelu nelze uvažování nastavit.</p>
      )}
      {effort || preserveReasoningPreference ? (
        <input disabled={disabled} name={reasoningName} type="hidden" value={effort ?? value.reasoningEffort} />
      ) : null}
    </div>
  );
}
