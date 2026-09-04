"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Download } from "lucide-react";
import { getAiOutputTitle } from "@/components/transcript-tabs/ai-output-formatting";
import {
  copyTextToClipboard,
  downloadMarkdownFile,
  getExportMarkdown,
  getExportTargets
} from "@/components/transcript-tabs/export-utils";
import type { AiOutputView } from "@/lib/ai/types";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { RecordingClientView } from "@/lib/recordings/client-view";
import type { TranscriptRow } from "@/lib/transcripts/types";
import { useOptionalTranscriptAiState } from "@/components/transcript-tabs/use-transcript-ai-state";

// ExportControls lets users copy or download the recording, transcript, or selected AI output.
export function ExportControls({
  activeAiOutputs = [],
  activeRecording,
  activeStructuredItems = { chapters: [], decisions: [], risks: [], tasks: [] },
  activeTranscript
}: {
  activeAiOutputs?: AiOutputView[];
  activeRecording: RecordingClientView | null;
  activeStructuredItems?: StructuredAiItems;
  activeTranscript: TranscriptRow | null;
}) {
  const lazyAiState = useOptionalTranscriptAiState();
  const displayedOutputs = lazyAiState?.loadedOutputs ?? activeAiOutputs;
  const displayedStructuredItems = lazyAiState?.structuredItems ?? activeStructuredItems;
  const targets = useMemo(
    () => getExportTargets(activeTranscript, displayedOutputs, displayedStructuredItems, lazyAiState?.outputs),
    [activeTranscript, displayedOutputs, displayedStructuredItems, lazyAiState?.outputs]
  );
  const [selectedTargetId, setSelectedTargetId] = useState(targets[0]?.id ?? "recording");
  const [message, setMessage] = useState<string | null>(null);
  const selectedTarget = useMemo(
    () => targets.find((target) => target.id === selectedTargetId) ?? targets[0],
    [selectedTargetId, targets]
  );
  const canExport = Boolean(selectedTarget);

  useEffect(() => {
    if (!targets.some((target) => target.id === selectedTargetId)) {
      setSelectedTargetId(targets[0]?.id ?? "recording");
    }
  }, [selectedTargetId, targets]);

  // getSelectedMarkdown reads the currently selected export target.
  function getSelectedMarkdown(
    aiOutputs = displayedOutputs,
    structuredItems = displayedStructuredItems,
    target = selectedTarget
  ) {
    return selectedTarget
      ? getExportMarkdown(target!, activeRecording, activeTranscript, aiOutputs, structuredItems)
      : "";
  }

  // loadSelectedMarkdown hydrates AI bodies only when the selected export actually contains AI artifacts.
  async function loadSelectedMarkdown() {
    if (!selectedTarget || selectedTarget.type === "transcript") return getSelectedMarkdown();
    if (!lazyAiState) return getSelectedMarkdown();
    if (selectedTarget.type === "ai_output") {
      const payload = await lazyAiState.loadOutput(selectedTarget.id);
      if (!payload) throw new Error("output_load_failed");
      return getSelectedMarkdown([payload.output], payload.structuredItems, { ...selectedTarget, output: payload.output });
    }
    const hydrated = await lazyAiState.loadAllOutputs();
    if (!hydrated) throw new Error("output_load_failed");
    return getSelectedMarkdown(hydrated.loadedOutputs, hydrated.structuredItems);
  }

  // copySelectedExport copies the selected export target into the clipboard.
  async function copySelectedExport() {
    if (!canExport) {
      return;
    }

    try {
      await copyTextToClipboard(await loadSelectedMarkdown());
      setMessage("Zkopírováno.");
    } catch {
      setMessage("Kopírování se nepovedlo.");
    }
  }

  // downloadSelectedExport saves the selected export target as a Markdown file.
  async function downloadSelectedExport() {
    if (!canExport) {
      return;
    }

    const baseName = selectedTarget.type === "ai_output"
      ? `${activeRecording?.title ?? "vosio"}-${getAiOutputTitle(selectedTarget.output?.processing_type ?? null)}`
      : `${activeRecording?.title ?? "vosio"}-${selectedTarget.label}`;

    try {
      downloadMarkdownFile(baseName, await loadSelectedMarkdown());
      setMessage("Export stažen jako Markdown.");
    } catch {
      setMessage("Export se nepovedl.");
    }
  }

  return (
    <details
      className="export-controls"
      onToggle={(event) => {
        if (event.currentTarget.open) void lazyAiState?.loadForPurpose("metadata");
      }}
    >
      <summary>
        <Download size={16} />
        <span>Export</span>
      </summary>
      <div className="export-controls-menu">
        <label>
          <span>Co exportovat</span>
          <select
            onChange={(event) => setSelectedTargetId(event.target.value)}
            value={selectedTargetId}
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </label>
        <div className="export-controls-actions">
          <button disabled={!canExport} onClick={() => void downloadSelectedExport()} type="button">
            <Download size={14} />
            <span>MD</span>
          </button>
          <button disabled={!canExport} onClick={copySelectedExport} type="button">
            <Copy size={14} />
            <span>Kopírovat</span>
          </button>
        </div>
        {message ? <p>{message}</p> : null}
      </div>
    </details>
  );
}
