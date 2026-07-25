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
import type { RecordingRow } from "@/lib/recordings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

// ExportControls lets users copy or download the recording, transcript, or selected AI output.
export function ExportControls({
  activeAiOutputs,
  activeRecording,
  activeStructuredItems,
  activeTranscript
}: {
  activeAiOutputs: AiOutputView[];
  activeRecording: RecordingRow | null;
  activeStructuredItems: StructuredAiItems;
  activeTranscript: TranscriptRow | null;
}) {
  const targets = useMemo(
    () => getExportTargets(activeTranscript, activeAiOutputs, activeStructuredItems),
    [activeAiOutputs, activeStructuredItems, activeTranscript]
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
  function getSelectedMarkdown() {
    return selectedTarget
      ? getExportMarkdown(selectedTarget, activeRecording, activeTranscript, activeAiOutputs, activeStructuredItems)
      : "";
  }

  // copySelectedExport copies the selected export target into the clipboard.
  async function copySelectedExport() {
    if (!canExport) {
      return;
    }

    try {
      await copyTextToClipboard(getSelectedMarkdown());
      setMessage("Zkopírováno.");
    } catch {
      setMessage("Kopírování se nepovedlo.");
    }
  }

  // downloadSelectedExport saves the selected export target as a Markdown file.
  function downloadSelectedExport() {
    if (!canExport) {
      return;
    }

    const baseName = selectedTarget.type === "ai_output"
      ? `${activeRecording?.title ?? "vosio"}-${getAiOutputTitle(selectedTarget.output.processing_type)}`
      : `${activeRecording?.title ?? "vosio"}-${selectedTarget.label}`;

    downloadMarkdownFile(baseName, getSelectedMarkdown());
    setMessage("Export stažen jako Markdown.");
  }

  return (
    <details className="export-controls">
      <summary>
        <Download size={15} />
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
          <button disabled={!canExport} onClick={downloadSelectedExport} type="button">
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
