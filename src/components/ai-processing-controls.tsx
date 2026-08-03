"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultUserSettings, type UserSettings } from "@/lib/settings/types";
import { aiModelOptions, getAiModelDescription } from "@/lib/model-options";
import { quickActions } from "@/lib/workspace-data";

type AiProcessingControlsProps = {
  settings?: UserSettings;
  transcriptId: string | null;
};

type ActiveAiRun = {
  id: string;
  label: string;
  processingType: string;
};

// getAiProcessingModelHint renders a short model price and quality hint below the selector.
function getAiProcessingModelHint(modelId: string) {
  return getAiModelDescription(modelId);
}

// getQuickActionDescription explains what each AI action creates in the recording detail tab.
function getQuickActionDescription(processingType: string) {
  const descriptions: Record<string, string> = {
    action_items: "Konkrétní úkoly, vlastníci, termíny.",
    crm_note: "Krátký obchodní zápis do CRM.",
    follow_up_email: "Formální e-mail zákazníkovi po hovoru.",
    meeting_minutes: "Interní zápis, rozhodnutí a rizika.",
    summary: "Krátké shrnutí hlavních bodů.",
    timeline_chapters: "Kapitoly hovoru podle témat."
  };

  return descriptions[processingType] ?? "Výstup z přepisu.";
}

// getQuickActionLabel returns the visible Czech label for a processing type.
function getQuickActionLabel(processingType: string) {
  return quickActions.find((action) => action.processingType === processingType)?.label ?? "AI výstup";
}

// createActiveRunId makes a local-only id for parallel optimistic AI processing indicators.
function createActiveRunId(processingType: string) {
  return `${processingType}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// getSelectedModelOption returns UI metadata for the currently selected model id.
function getSelectedModelOption(modelId: string) {
  return aiModelOptions.find((option) => option.id === modelId) ?? aiModelOptions[0];
}

// getAiProcessingErrorMessage renders provider failures with safe diagnostics when the API returns them.
function getAiProcessingErrorMessage(payload: { detail?: string | null; error?: string } | null) {
  if (payload?.detail) {
    return `${payload.error ?? "AI zpracování selhalo."} Detail: ${payload.detail}`;
  }

  return payload?.error ?? "AI zpracování selhalo.";
}

// AiProcessingControls runs stored prompt templates against a completed transcript.
export function AiProcessingControls({
  settings = defaultUserSettings,
  transcriptId
}: AiProcessingControlsProps) {
  const router = useRouter();
  const modelPickerRef = useRef<HTMLDetailsElement>(null);
  const modelOptions = aiModelOptions;
  const [activeRuns, setActiveRuns] = useState<ActiveAiRun[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [model, setModel] = useState<string>(settings.defaultOpenaiModel);
  const selectedModel = getSelectedModelOption(model);
  const canProcess = Boolean(transcriptId);

  // addActiveRun marks one AI action as running without blocking another run of the same action.
  function addActiveRun(processingType: string) {
    const run = {
      id: createActiveRunId(processingType),
      label: getQuickActionLabel(processingType),
      processingType
    };

    setActiveRuns((currentRuns) => [...currentRuns, run]);

    return run.id;
  }

  // removeActiveRun clears one finished optimistic AI indicator while preserving parallel jobs.
  function removeActiveRun(runId: string) {
    setActiveRuns((currentRuns) => currentRuns.filter((run) => run.id !== runId));
  }

  // processTranscript calls the server-side AI processing endpoint for one prompt type.
  async function processTranscript(processingType: string) {
    if (!transcriptId) {
      return;
    }

    const runId = addActiveRun(processingType);
    setMessage(`Generuji: ${getQuickActionLabel(processingType)}. Můžete spustit i další AI výstup.`);

    try {
      const response = await fetch(`/api/transcripts/${transcriptId}/process`, {
        body: JSON.stringify({ model, processingType }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as { detail?: string | null; error?: string } | null;

      if (!response.ok) {
        setMessage(getAiProcessingErrorMessage(payload));
        return;
      }

      setMessage("AI výstup je uložený v Supabase.");
      router.refresh();
    } catch {
      setMessage("Nepodařilo se spojit se serverem pro AI zpracování.");
    } finally {
      removeActiveRun(runId);
    }
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
            className={activeRuns.some((run) => run.processingType === action.processingType) ? "quick-action-running" : undefined}
            disabled={!canProcess}
            onClick={() => processTranscript(action.processingType)}
            type="button"
            key={action.label}
          >
            <action.icon size={15} />
            <span>
              <strong>{action.label}</strong>
              <small>
                {activeRuns.some((run) => run.processingType === action.processingType)
                  ? "Běží. Kliknutím spustíte další výstup."
                  : getQuickActionDescription(action.processingType)}
              </small>
            </span>
          </button>
        ))}
      </div>
      {activeRuns.length > 0 ? (
        <div className="ai-running-state" role="status" aria-live="polite">
          <strong>AI generuje výstup</strong>
          <span>{activeRuns.map((run) => run.label).join(", ")}</span>
        </div>
      ) : null}
      {message ? <p className="ai-state">{message}</p> : null}
    </>
  );
}
