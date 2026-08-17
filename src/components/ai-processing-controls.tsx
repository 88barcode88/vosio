"use client";

import { useRef, useState } from "react";
import {
  type AiProcessingType,
  useAiProcessingRun
} from "@/components/transcript-tabs/use-ai-processing-run";
import { defaultUserSettings, type UserSettings } from "@/lib/settings/types";
import { aiModelOptions, getAiModelDescription } from "@/lib/model-options";
import { quickActions } from "@/lib/workspace-data";

type AiProcessingControlsProps = {
  settings?: UserSettings;
  transcriptId: string | null;
};

// getAiProcessingModelHint renders a short model price and quality hint below the selector.
function getAiProcessingModelHint(modelId: string) {
  return getAiModelDescription(modelId);
}

// getQuickActionDescription explains what each AI action creates in the recording detail tab.
function getQuickActionDescription(processingType: AiProcessingType) {
  const descriptions: Record<AiProcessingType, string> = {
    action_items: "Konkrétní úkoly, vlastníci, termíny.",
    crm_note: "Krátký obchodní zápis do CRM.",
    follow_up_email: "Formální e-mail zákazníkovi po hovoru.",
    meeting_minutes: "Interní zápis, rozhodnutí a rizika.",
    summary: "Krátké shrnutí hlavních bodů.",
    timeline_chapters: "Kapitoly hovoru podle témat."
  };

  return descriptions[processingType];
}

// getQuickActionLabel returns the visible Czech label for a processing type.
function getQuickActionLabel(processingType: AiProcessingType) {
  return quickActions.find((action) => action.processingType === processingType)?.label ?? "AI výstup";
}

// getSelectedModelOption returns UI metadata for the currently selected model id.
function getSelectedModelOption(modelId: string) {
  return aiModelOptions.find((option) => option.id === modelId) ?? aiModelOptions[0];
}

// AiProcessingControls runs stored prompt templates against a completed transcript.
export function AiProcessingControls({
  settings = defaultUserSettings,
  transcriptId
}: AiProcessingControlsProps) {
  const modelPickerRef = useRef<HTMLDetailsElement>(null);
  const modelOptions = aiModelOptions;
  const [model, setModel] = useState<string>(settings.defaultOpenaiModel);
  const processing = useAiProcessingRun(transcriptId);
  const selectedModel = getSelectedModelOption(model);
  const canProcess = Boolean(transcriptId);

  // processTranscript delegates one existing quick action to the shared request lifecycle.
  async function processTranscript(processingType: AiProcessingType) {
    await processing.run({ model, processingType });
  }

  // selectModel updates the local model and closes the custom picker popover.
  function selectModel(modelId: string) {
    setModel(modelId);
    if (modelPickerRef.current) {
      modelPickerRef.current.open = false;
    }
  }

  return (
    <>
      <details className="ai-settings-details">
        <summary>
          <span>Model</span>
          <strong>{selectedModel.label}</strong>
        </summary>
        <div className="ai-settings" aria-label="Nastavení AI modelu">
          <div className="model-picker">
            <span>Model AI</span>
            <details ref={modelPickerRef}>
              <summary>
                <strong>{selectedModel.label}</strong>
                <small>{selectedModel.price}</small>
              </summary>
              <div className="model-picker-menu">
                {modelOptions.map((option) => (
                  <button
                    className={option.id === model ? "model-picker-option model-picker-option-active" : "model-picker-option"}
                    key={option.id}
                    onClick={() => selectModel(option.id)}
                    type="button"
                  >
                    <strong>{option.label}</strong>
                    <span>{option.price}</span>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>
            </details>
            <small>{getAiProcessingModelHint(model)}</small>
          </div>
        </div>
      </details>
      <div className="quick-grid">
        {quickActions.map((action) => (
          <button
            className={processing.isRunning(action.processingType) ? "quick-action-running" : undefined}
            disabled={!canProcess}
            onClick={() => processTranscript(action.processingType)}
            type="button"
            key={action.label}
          >
            <action.icon size={16} />
            <span>
              <strong>{action.label}</strong>
              <small>
                {processing.isRunning(action.processingType)
                  ? "Běží. Kliknutím spustíte další výstup."
                  : getQuickActionDescription(action.processingType)}
              </small>
            </span>
          </button>
        ))}
      </div>
      {processing.activeRuns.length > 0 ? (
        <div className="ai-running-state" role="status" aria-live="polite">
          <strong>AI generuje výstup</strong>
          <span>{processing.activeRuns.map((run) => getQuickActionLabel(run.processingType)).join(", ")}</span>
        </div>
      ) : null}
      {processing.message ? <p className="ai-state">{processing.message}</p> : null}
    </>
  );
}
