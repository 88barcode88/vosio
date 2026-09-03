"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Copy, Download, Mail, Settings2, Sparkles } from "lucide-react";
import { AiProcessingControls } from "@/components/ai-processing-controls";
import { DeleteAiOutputForm } from "@/components/delete-ai-output-form";
import {
  getAiOutputMarkdownText,
  getAiOutputPreview,
  getAiOutputSummary,
  getAiOutputTitle,
  getFollowUpEmailSubject
} from "@/components/transcript-tabs/ai-output-formatting";
import {
  copyTextToClipboard,
  createMailtoHref,
  downloadMarkdownFile,
} from "@/components/transcript-tabs/export-utils";
import { getAiOutputMarkdownLines } from "@/components/transcript-tabs/markdown-utils";
import { StructuredItemsContent } from "@/components/transcript-tabs/structured-items-content";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
import {
  getManualAiJobDisplayStatus,
  type ManualAiJobStatus,
  type ManualAiJobSummary,
  type ManualAiOutputMetadata
} from "@/lib/ai/manual-job-state";
import { AI_MODEL_QUALITY_GUIDANCE } from "@/lib/model-options";
import { formatRecordingDate } from "@/lib/recordings/types";
import type { UserSettings } from "@/lib/settings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";
import type {
  TranscriptEvidenceReference,
  TranscriptTarget
} from "@/components/transcript-tabs/types";

// AiProcessingContent renders AI actions and saved outputs in the recording detail context.
export function AiProcessingContent({
  activeTranscript,
  aiOutputs,
  isLoading,
  jobs,
  loadOutput,
  onOpenEvidence,
  onJobAccepted,
  onReload,
  outputMetadata,
  resolveEvidenceTarget,
  structuredItems,
  stateError,
  userSettings
}: {
  activeTranscript: TranscriptRow | null;
  aiOutputs: AiOutputView[];
  isLoading?: boolean;
  jobs?: ManualAiJobSummary[];
  loadOutput?: (outputId: string) => Promise<unknown>;
  onOpenEvidence: (target: TranscriptTarget) => void;
  onJobAccepted?: (job: { id: string; status: ManualAiJobStatus }, processingType: string) => void;
  onReload?: () => Promise<void>;
  outputMetadata?: ManualAiOutputMetadata[];
  resolveEvidenceTarget: (reference: TranscriptEvidenceReference) => TranscriptTarget | null;
  structuredItems: StructuredAiItems;
  stateError?: string | null;
  userSettings: UserSettings;
}) {
  const hasStructuredItems = hasAnyStructuredItems(structuredItems);
  const artifacts = outputMetadata ?? aiOutputs.map((output) => ({
    body_loaded: true,
    created_at: output.created_at,
    id: output.id,
    processing_job_id: output.processing_job_id,
    processing_type: output.processing_type,
    transcript_id: output.transcript_id
  }));

  return (
    <div className="ai-tab-layout">
      <header className="ai-tab-header">
        <div>
          <Sparkles size={15} />
          <strong>AI zpracování</strong>
        </div>
        <span>{artifacts.length} výstupů</span>
      </header>
      <section className="ai-tab-actions">
        <div className="ai-tab-actions-title">
          <strong>Co z nahrávky vytěžit</strong>
          <span>Nový výstup se uloží pod tuto nahrávku.</span>
          <small>{AI_MODEL_QUALITY_GUIDANCE}</small>
        </div>
        <AiProcessingControls
          onJobAccepted={onJobAccepted}
          settings={userSettings}
          transcriptId={activeTranscript?.id ?? null}
        />
      </section>
      {jobs && jobs.length > 0 ? <ManualAiJobList jobs={jobs} /> : null}
      {stateError ? (
        <p className="ai-state" role="alert">
          {stateError} <button onClick={() => void onReload?.()} type="button">Zkusit znovu</button>
        </p>
      ) : null}
      {isLoading && artifacts.length === 0 ? <p className="ai-state">Načítám AI stav…</p> : null}
      {!isLoading && !stateError && artifacts.length === 0 ? (
        <div className="ai-empty-card">
          <Settings2 size={16} />
          <strong>Zatím žádné AI výstupy</strong>
          <p>Po dokončení přepisu spusťte shrnutí, úkoly, zápis ze schůzky, CRM poznámku, e-mail po hovoru nebo časovou osu.</p>
        </div>
      ) : null}
      <section className="notes-list ai-output-list" aria-label="Uložené AI výstupy">
        <StructuredItemsContent
          items={structuredItems}
          onOpenEvidence={onOpenEvidence}
          resolveEvidenceTarget={resolveEvidenceTarget}
        />
        {artifacts.map((metadata, index) => (
          <AiOutputCard
            defaultOpen={index === 0 && !hasStructuredItems}
            key={metadata.id}
            loadOutput={loadOutput}
            metadata={metadata}
            output={aiOutputs.find((output) => output.id === metadata.id) ?? null}
          />
        ))}
      </section>
    </div>
  );
}

const manualJobLabels = {
  done: "Hotovo",
  failed: "Selhalo",
  queued: "Ve frontě",
  running: "Probíhá",
  stalled: "Trvá déle než obvykle"
} as const;

// ManualAiJobList keeps accepted, failed, and stalled generations visible after returning to detail.
function ManualAiJobList({ jobs }: { jobs: ManualAiJobSummary[] }) {
  return (
    <section className="ai-running-state" aria-label="Stav AI požadavků">
      {jobs.slice(0, 12).map((job) => {
        const status = getManualAiJobDisplayStatus(job);
        return (
          <span key={job.id}>
            <strong>{getAiOutputTitle(job.processing_type)}</strong>: {manualJobLabels[status]}
            {job.error_message ? ` · ${job.error_message}` : ""}
          </span>
        );
      })}
    </section>
  );
}

// hasAnyStructuredItems keeps raw AI artifacts collapsed when normalized workspace rows exist.
function hasAnyStructuredItems(items: StructuredAiItems) {
  return items.tasks.length > 0 || items.decisions.length > 0 || items.risks.length > 0 || items.chapters.length > 0;
}

// AiOutputCard renders saved AI output as a readable collapsible artifact preview.
function AiOutputCard({
  defaultOpen,
  loadOutput,
  metadata,
  output
}: {
  defaultOpen?: boolean;
  loadOutput?: (outputId: string) => Promise<unknown>;
  metadata: ManualAiOutputMetadata;
  output: AiOutputView | null;
}) {
  const pathname = usePathname();
  const lines = useMemo(() => output ? getAiOutputMarkdownLines(output) : [], [output]);
  const markdown = useMemo(() => output ? getAiOutputMarkdownText(output) : "", [output]);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const isFollowUpEmail = metadata.processing_type === "follow_up_email";

  useEffect(() => {
    if (defaultOpen && !output) void loadOutput?.(metadata.id);
  }, [defaultOpen, loadOutput, metadata.id, output]);

  // copyAiOutput copies this generated artifact into the clipboard.
  async function copyAiOutput() {
    if (!output) return;
    try {
      await copyTextToClipboard(markdown);
      setCopyMessage("Zkopírováno.");
    } catch {
      setCopyMessage("Kopírování se nepovedlo.");
    }
  }

  // downloadAiOutput saves this generated artifact as a Markdown file.
  function downloadAiOutput() {
    if (!output) return;
    downloadMarkdownFile(getAiOutputTitle(output.processing_type), markdown);
    setCopyMessage("Staženo jako MD.");
  }

  return (
    <details
      className="note-card ai-output-detail"
      open={defaultOpen}
      onToggle={(event) => {
        if (event.currentTarget.open && !output) void loadOutput?.(metadata.id);
      }}
    >
      <summary>
        <span className="ai-output-title">
          <strong>{getAiOutputTitle(metadata.processing_type)}</strong>
          <small>{formatRecordingDate(metadata.created_at)}</small>
        </span>
        <em>{output ? getAiOutputSummary(output) : "Detail se načte po otevření."}</em>
      </summary>
      {output ? <div className="ai-output-actions">
        <button onClick={copyAiOutput} type="button">
          <Copy size={14} />
          <span>Kopírovat</span>
        </button>
        <button onClick={downloadAiOutput} type="button">
          <Download size={14} />
          <span>MD</span>
        </button>
        {isFollowUpEmail ? (
          <a
            data-touch-target="action"
            href={createMailtoHref(getFollowUpEmailSubject(output), getAiOutputPreview(output))}
          >
            <Mail size={14} />
            <span>Otevřít e-mail</span>
          </a>
        ) : null}
        <DeleteAiOutputForm next={pathname} outputId={output.id} />
        {copyMessage ? <small>{copyMessage}</small> : null}
      </div> : null}
      <div className="ai-markdown-preview">
        {!output ? <p>Načítám uložený AI výstup…</p> : null}
        {lines.map((line, index) => {
          if (line.kind === "heading") {
            return <strong className="ai-markdown-heading" key={`${line.text}-${index}`}>{line.text}</strong>;
          }

          if (line.kind === "bullet") {
            return <p className="ai-markdown-bullet" key={`${line.text}-${index}`}>{line.text}</p>;
          }

          if (line.kind === "table") {
            const [headRow, ...bodyRows] = line.rows;

            return (
              <div className="ai-markdown-table-wrap" key={`table-${index}`}>
                <table>
                  {headRow ? (
                    <thead>
                      <tr>
                        {headRow.map((cell, cellIndex) => (
                          <th key={`${cell}-${cellIndex}`}>{cell}</th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {bodyRows.map((row, rowIndex) => (
                      <tr key={`row-${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`${cell}-${cellIndex}`}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          return <p key={`${line.text}-${index}`}>{line.text}</p>;
        })}
      </div>
    </details>
  );
}
