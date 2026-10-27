"use client";

import { useState } from "react";
import { AiModelPicker, createAiModelSelection, getAiModelReasoningEffort } from "@/components/ai-model-picker";
import { useRecordingCapabilities } from "@/components/recording-capability-context";
import {
  type AiProcessingType,
  useAiProcessingRun
} from "@/components/transcript-tabs/use-ai-processing-run";
import { defaultUserSettings, type UserSettings } from "@/lib/settings/types";
import { getActiveAiModelOption } from "@/lib/model-options";
import { quickActions } from "@/lib/workspace-data";
import type { ManualAiJobStatus } from "@/lib/ai/manual-job-state";

type AiProcessingControlsProps = {
  onJobAccepted?: (job: { id: string; status: ManualAiJobStatus }, processingType: AiProcessingType) => void;
  settings?: UserSettings;
  transcriptId: string | null;
};

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

// AiProcessingControls runs stored prompt templates against a completed transcript.
export function AiProcessingControls({
  onJobAccepted,
  settings = defaultUserSettings,
  transcriptId
}: AiProcessingControlsProps) {
  const { capabilities } = useRecordingCapabilities();
  const [selection, setSelection] = useState(() => createAiModelSelection(settings.defaultOpenaiModel, settings.defaultReasoningEffort));
  const { model } = selection;
  const processing = useAiProcessingRun(transcriptId, onJobAccepted);
  const selectedModel = getActiveAiModelOption(model)!;
  const reasoningEffort = getAiModelReasoningEffort(selection);
  const canProcess = Boolean(transcriptId) && capabilities.runPersonalAi;

  // processTranscript delegates one existing quick action to the shared request lifecycle.
  async function processTranscript(processingType: AiProcessingType) {
    await processing.run({ model, processingType, ...(reasoningEffort ? { reasoningEffort } : {}) });
  }

  if (!capabilities.runPersonalAi) return <p>Uložené AI výstupy jsou dostupné ke čtení.</p>;
  return (
    <>
      <details className="ai-settings-details">
        <summary>
          <span>Model</span>
          <strong>{selectedModel.label}{reasoningEffort ? ` · ${reasoningEffort}` : ""}</strong>
        </summary>
        <div className="ai-settings" aria-label="Nastavení AI modelu">
          <AiModelPicker
            disabled={!canProcess}
            onChange={setSelection}
            scope="Pro nové ruční výstupy této nahrávky."
            value={selection}
          />
        </div>
      </details>
      <div className="quick-grid">
        {quickActions.map((action) => (
          <button
            className={processing.isRunning(action.processingType) ? "quick-action-running" : undefined}
            disabled={!canProcess}
            title={getQuickActionDescription(action.processingType)}
            onClick={() => processTranscript(action.processingType)}
            type="button"
            key={action.label}
          >
            <action.icon size={16} />
            <span>
              <strong>{action.label}</strong>
              <small className="visually-hidden">
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
