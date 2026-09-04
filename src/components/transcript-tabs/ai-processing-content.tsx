"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { type AiProcessingType, useAiProcessingRun } from "@/components/transcript-tabs/use-ai-processing-run";
import { getManualAiFailureMessage } from "@/lib/ai/provider-errors";

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
  const retryProcessing = useAiProcessingRun(activeTranscript?.id ?? null, onJobAccepted);
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
      {jobs && jobs.length > 0 ? (
        <ManualAiJobList
          jobs={jobs}
          onReconcile={onReload}
          onRetry={(job) => retryProcessing.run({ model: job.model, processingType: job.processing_type as AiProcessingType })}
          transcriptId={activeTranscript?.id ?? null}
        />
      ) : null}
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
function ManualAiJobList({
  jobs,
  onReconcile,
  onRetry,
  transcriptId
}: {
  jobs: ManualAiJobSummary[];
  onReconcile?: () => Promise<void>;
  onRetry: (job: ManualAiJobSummary) => Promise<boolean>;
  transcriptId: string | null;
}) {
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState<number | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  useEffect(() => {
    const now = Date.now();
    setClockMs(now);
    const nextRetryAt = jobs
      .filter((job) => job.failure_code === "rate_limited" && job.retry_after_at)
      .map((job) => Date.parse(job.retry_after_at!))
      .filter((retryAt) => Number.isFinite(retryAt) && retryAt > now)
      .sort((left, right) => left - right)[0];
    if (!nextRetryAt) return;
    const timer = window.setTimeout(() => setClockMs(Date.now()), Math.min(nextRetryAt - now + 50, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [jobs]);

  // reconcileJob requests one safe recovery action, then refreshes only the shared local AI metadata.
  async function reconcileJob(jobId: string, action: "interrupt" | "reconcile") {
    if (!transcriptId || pendingJobId) return;
    setPendingJobId(jobId);
    setRecoveryMessage(null);
    try {
      const response = await fetch(`/api/transcripts/${transcriptId}/manual-ai/reconcile`, {
        body: JSON.stringify({ action, jobId }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json().catch(() => null) as { status?: string } | null;
      const messages: Record<string, string> = {
        busy: "Zpracování ještě běží.",
        done: "Uložený AI výstup byl obnoven.",
        interrupted: "Přerušené zpracování bylo bezpečně ukončeno.",
        missing: "AI požadavek už není dostupný.",
        operator_required: "Tento starší AI požadavek vyžaduje ruční kontrolu.",
        schedule: "AI zpracování bylo znovu zařazeno.",
        terminal: "AI požadavek už je ukončený."
      };
      setRecoveryMessage(response.status === 409
        ? "AI požadavek se mezitím změnil. Obnovte jeho stav."
        : response.ok && payload?.status && messages[payload.status]
          ? messages[payload.status]
          : "AI stav se nepodařilo obnovit.");
      await onReconcile?.();
    } catch {
      setRecoveryMessage("AI stav se nepodařilo obnovit.");
    } finally {
      setPendingJobId(null);
    }
  }

  return (
    <section className="ai-running-state" aria-label="Stav AI požadavků">
      {jobs.slice(0, 12).map((job) => {
        const status = getManualAiJobDisplayStatus(job);
        const retryAt = job.retry_after_at ? Date.parse(job.retry_after_at) : Number.NaN;
        const retryBlocked = job.failure_code === "rate_limited"
          && Number.isFinite(retryAt)
          && (clockMs === null || retryAt > clockMs);
        const leaseExpiresAt = job.lease_expires_at ? Date.parse(job.lease_expires_at) : Number.NaN;
        const canInterruptQueued = job.status === "queued"
          && job.attempt_count === 0
          && job.max_attempts === 1
          && job.lease_expires_at === null;
        const canInterruptStaleRunning = status === "stalled"
          && job.status === "running"
          && job.attempt_count === 1
          && job.max_attempts === 1
          && Number.isFinite(leaseExpiresAt)
          && clockMs !== null
          && leaseExpiresAt <= clockMs;
        return (
          <span key={job.id}>
            <strong>{getAiOutputTitle(job.processing_type)}</strong>: {manualJobLabels[status]}
            {job.status === "failed" ? ` · ${getManualAiFailureMessage(job.failure_code)}` : ""}
            {retryBlocked ? ` Další pokus bude dostupný ${new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short" }).format(retryAt)}.` : ""}
            {status === "stalled" ? (
              <button disabled={pendingJobId !== null} onClick={() => void reconcileJob(job.id, "reconcile")} type="button">
                {pendingJobId === job.id ? "Obnovuji…" : "Obnovit stav"}
              </button>
            ) : null}
            {canInterruptQueued || canInterruptStaleRunning ? (
              <button disabled={pendingJobId !== null} onClick={() => void reconcileJob(job.id, "interrupt")} type="button">
                {pendingJobId === job.id ? "Ukončuji…" : "Ukončit požadavek"}
              </button>
            ) : null}
            {job.status === "failed" ? (
              <button
                disabled={pendingJobId !== null || retryBlocked}
                onClick={() => {
                  setPendingJobId(job.id);
                  void onRetry(job).finally(() => setPendingJobId(null));
                }}
                type="button"
              >
                Zkusit znovu
              </button>
            ) : null}
          </span>
        );
      })}
      {recoveryMessage ? <span role="status">{recoveryMessage}</span> : null}
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
  const [isOpen, setIsOpen] = useState(Boolean(defaultOpen));
  const [loadState, setLoadState] = useState<"error" | "idle" | "loading">("idle");
  const loadAttemptedRef = useRef(false);
  const loadRequestRef = useRef<Promise<void> | null>(null);
  const isFollowUpEmail = metadata.processing_type === "follow_up_email";

  // loadBody keeps one historical disclosure retryable without closing it during parent hydration.
  const loadBody = useCallback(async (retry = false) => {
    if (output) return;
    if (loadRequestRef.current) return loadRequestRef.current;
    if (loadAttemptedRef.current && !retry) return;

    loadAttemptedRef.current = true;
    setLoadState("loading");
    const request = (async () => {
      try {
        const loaded = await loadOutput?.(metadata.id);
        setLoadState(loaded ? "idle" : "error");
      } catch {
        setLoadState("error");
      }
    })().finally(() => {
      loadRequestRef.current = null;
    });
    loadRequestRef.current = request;
    return request;
  }, [loadOutput, metadata.id, output]);

  useEffect(() => {
    if (defaultOpen && !output) void loadBody();
  }, [defaultOpen, loadBody, output]);

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
      open={isOpen}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setIsOpen(open);
        if (open && !output) void loadBody();
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
        {!output && loadState === "loading" ? <p>Načítám uložený AI výstup…</p> : null}
        {!output && loadState === "error" ? (
          <p role="alert">
            AI výstup se nepodařilo načíst. <button onClick={() => void loadBody(true)} type="button">Zkusit znovu</button>
          </p>
        ) : null}
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
