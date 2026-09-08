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
import {
  MANUAL_AI_CLEANUP_BATCH_LIMIT,
  type ManualAiCleanupAction,
  type ManualAiCleanupClassification,
  type ManualAiCleanupMetadata,
  type ManualAiCleanupMutationResponse,
  type ManualAiCleanupPage,
  type ManualAiCleanupResultStatus
} from "@/lib/ai/manual-job-cleanup-contract";
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
  classifications = [],
  cleanup = { eligible_count: 0, next_cursor: null },
  isLoading,
  jobs,
  loadOutput,
  onOpenEvidence,
  onJobAccepted,
  onCleanupMutation,
  onOutputsRemoved,
  onReload,
  outputMetadata,
  resolveEvidenceTarget,
  structuredItems,
  onTaskDeleted,
  onTaskStatusConfirmed,
  stateError,
  userSettings
}: {
  activeTranscript: TranscriptRow | null;
  aiOutputs: AiOutputView[];
  classifications?: ManualAiCleanupClassification[];
  cleanup?: ManualAiCleanupMetadata;
  isLoading?: boolean;
  jobs?: ManualAiJobSummary[];
  loadOutput?: (outputId: string) => Promise<unknown>;
  onOpenEvidence: (target: TranscriptTarget) => void;
  onJobAccepted?: (job: { id: string; status: ManualAiJobStatus }, processingType: string) => void;
  onCleanupMutation?: (mutation: ManualAiCleanupMutationResponse) => void;
  onOutputsRemoved?: (outputIds: string[]) => void;
  onReload?: () => Promise<void>;
  outputMetadata?: ManualAiOutputMetadata[];
  resolveEvidenceTarget: (reference: TranscriptEvidenceReference) => TranscriptTarget | null;
  structuredItems: StructuredAiItems;
  onTaskDeleted?: Parameters<typeof StructuredItemsContent>[0]["onTaskDeleted"];
  onTaskStatusConfirmed?: Parameters<typeof StructuredItemsContent>[0]["onTaskStatusConfirmed"];
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
      {(jobs && jobs.length > 0) || cleanup.eligible_count > 0 ? (
        <ManualAiJobList
          classifications={classifications}
          cleanup={cleanup}
          jobs={jobs ?? []}
          onCleanupMutation={onCleanupMutation}
          onReload={onReload}
          onRetry={(job) => retryProcessing.run({ model: job.model, processingType: job.processing_type as AiProcessingType })}
          transcriptId={activeTranscript?.id ?? null}
        />
      ) : null}
      {retryProcessing.message ? <p className="ai-state" role="status">{retryProcessing.message}</p> : null}
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
          onTaskDeleted={onTaskDeleted}
          onTaskStatusConfirmed={onTaskStatusConfirmed}
          onOpenEvidence={onOpenEvidence}
          resolveEvidenceTarget={resolveEvidenceTarget}
        />
        {artifacts.map((metadata, index) => (
          <AiOutputCard
            defaultOpen={index === 0 && !hasStructuredItems}
            key={metadata.id}
            loadOutput={loadOutput}
            metadata={metadata}
            onOutputsRemoved={onOutputsRemoved}
            output={aiOutputs.find((output) => output.id === metadata.id) ?? null}
          />
        ))}
      </section>
    </div>
  );
}

const manualJobLabels = {
  cancelled: "Zrušeno",
  done: "Hotovo",
  failed: "Selhalo",
  queued: "Ve frontě",
  running: "Probíhá",
  stalled: "Trvá déle než obvykle"
} as const;

const cleanupActionLabels = {
  delete: "Vyčistit záznam",
  interrupt: "Ukončit požadavek",
  reconcile: "Obnovit stav"
} as const;

const cleanupResultLabels: Record<ManualAiCleanupResultStatus, string> = {
  busy: "stále běží",
  conflict: "mezitím změněno",
  deleted: "odstraněno",
  missing: "už neexistuje",
  protected: "chráněno výstupem",
  reconciled: "opraveno"
};

// ManualAiJobList exposes only authoritative server actions in an initially closed operator panel.
function ManualAiJobList({
  classifications,
  cleanup,
  jobs,
  onCleanupMutation,
  onReload,
  onRetry,
  transcriptId
}: {
  classifications: ManualAiCleanupClassification[];
  cleanup: ManualAiCleanupMetadata;
  jobs: ManualAiJobSummary[];
  onCleanupMutation?: (mutation: ManualAiCleanupMutationResponse) => void;
  onReload?: () => Promise<void>;
  onRetry: (job: ManualAiJobSummary) => Promise<boolean>;
  transcriptId: string | null;
}) {
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [isBulkPending, setIsBulkPending] = useState(false);
  const [clockMs, setClockMs] = useState<number | null>(null);
  const [bulkResumeCursor, setBulkResumeCursor] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const classificationById = useMemo(
    () => new Map(classifications.map((classification) => [classification.job_id, classification])),
    [classifications]
  );
  const visibleJobs = jobs.filter((job) => job.status !== "done");
  const activeCount = classifications.filter((classification) => classification.poll_eligible).length;
  const errorCount = visibleJobs.filter((job) => {
    const reason = classificationById.get(job.id)?.cleanup_reason;
    return job.status === "failed" || job.status === "cancelled"
      || reason === "eligible_stale_unclaimed" || reason === "unsupported_legacy";
  }).length;

  useEffect(() => {
    let timer: number | null = null;
    // updateRetryClock unlocks persisted rate-limit deadlines without any network polling.
    const updateRetryClock = () => {
      const now = Date.now();
      setClockMs(now);
      const nextRetryAt = jobs
        .filter((job) => job.status === "failed" && job.failure_code === "rate_limited" && job.retry_after_at)
        .map((job) => Date.parse(job.retry_after_at!))
        .filter((retryAt) => Number.isFinite(retryAt) && retryAt > now)
        .sort((left, right) => left - right)[0];
      if (nextRetryAt) timer = window.setTimeout(updateRetryClock, Math.min(nextRetryAt - now + 50, 2_147_483_647));
    };
    updateRetryClock();
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, [jobs]);

  // cleanupJobs posts one exact bounded batch and applies only the server's explicit mutation fields.
  async function cleanupJobs(jobIds: string[]) {
    if (!transcriptId || jobIds.length === 0 || jobIds.length > MANUAL_AI_CLEANUP_BATCH_LIMIT) return null;
    const response = await fetch(`/api/transcripts/${transcriptId}/manual-ai/cleanup`, {
      body: JSON.stringify({ job_ids: jobIds }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = await response.json().catch(() => null) as ManualAiCleanupMutationResponse | null;
    if (!response.ok || !payload || !Array.isArray(payload.results)
      || !Array.isArray(payload.removed_job_ids) || !Array.isArray(payload.changed_jobs)) {
      throw new Error("cleanup_failed");
    }
    onCleanupMutation?.(payload);
    return payload;
  }

  // runJobAction executes only the exact action advertised by the authoritative classifier.
  async function runJobAction(jobId: string, action: ManualAiCleanupAction) {
    if (pendingJobId || isBulkPending) return;
    setPendingJobId(jobId);
    setRecoveryMessage(null);
    try {
      if (action === "delete") {
        const payload = await cleanupJobs([jobId]);
        const result = payload?.results[0]?.result;
        setRecoveryMessage(result ? `Výsledek: ${cleanupResultLabels[result]}.` : "AI stav se nepodařilo obnovit.");
      } else {
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
      }
      await onReload?.();
    } catch {
      setRecoveryMessage("AI stav se nepodařilo obnovit.");
    } finally {
      setPendingJobId(null);
    }
  }

  // cleanupAll streams GET page to POST batch so candidate ids and aggregation remain bounded.
  async function cleanupAll() {
    if (!transcriptId || isBulkPending || pendingJobId) return;
    setIsBulkPending(true);
    setRecoveryMessage(null);
    let cursor = bulkResumeCursor;
    let processed = 0;
    const resultCounts = new Map<ManualAiCleanupResultStatus, number>();
    try {
      do {
        const pageResponse = await fetch(
          `/api/transcripts/${transcriptId}/manual-ai/cleanup${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
          { cache: "no-store" }
        );
        const page = await pageResponse.json().catch(() => null) as ManualAiCleanupPage | null;
        if (!pageResponse.ok || !page || !Array.isArray(page.candidates)
          || page.candidates.length > MANUAL_AI_CLEANUP_BATCH_LIMIT
          || new Set(page.candidates.map((candidate) => candidate.job_id)).size !== page.candidates.length) {
          throw new Error("cleanup_page_failed");
        }
        if (page.candidates.length > 0) {
          const mutation = await cleanupJobs(page.candidates.map((candidate) => candidate.job_id));
          mutation?.results.forEach((result) => {
            resultCounts.set(result.result, (resultCounts.get(result.result) ?? 0) + 1);
          });
          processed += page.candidates.length;
        }
        if (page.next_cursor && page.next_cursor === cursor) throw new Error("cleanup_cursor_stalled");
        cursor = page.next_cursor;
        setBulkResumeCursor(cursor);
      } while (cursor);
      const summary = Array.from(resultCounts.entries())
        .map(([result, count]) => `${cleanupResultLabels[result]} ${count}`)
        .join(", ");
      setRecoveryMessage(`Kontrola dokončena: ${processed} záznamů${summary ? ` (${summary})` : ""}.`);
      await onReload?.();
    } catch {
      setBulkResumeCursor(cursor);
      setRecoveryMessage("Čištění se přerušilo. Zkuste pokračovat znovu.");
    } finally {
      setIsBulkPending(false);
    }
  }

  return (
    <details className="ai-running-state">
      <summary>
        <strong>Stav AI požadavků</strong>
        <span>{activeCount} aktivní · {errorCount} chyb · {cleanup.eligible_count} k vyčištění</span>
      </summary>
      <div className="ai-job-panel" aria-live="polite">
      {visibleJobs.slice(0, 12).map((job) => {
        const status = getManualAiJobDisplayStatus(job);
        const classification = classificationById.get(job.id);
        const retryAt = job.retry_after_at ? Date.parse(job.retry_after_at) : Number.NaN;
        const retryBlocked = job.failure_code === "rate_limited"
          && Number.isFinite(retryAt)
          && (clockMs === null || retryAt > clockMs);
        return (
          <div className="ai-job-row" key={job.id}>
            <span><strong>{getAiOutputTitle(job.processing_type)}</strong>: {manualJobLabels[status]}</span>
            {job.status === "failed" ? <small>{getManualAiFailureMessage(job.failure_code)}</small> : null}
            {classification?.cleanup_reason === "unsupported_legacy" ? (
              <small>Starší protokol nelze bezpečně automaticky spravovat. Je nutná ruční kontrola.</small>
            ) : null}
            {classification?.actions.map((action) => (
              <button disabled={pendingJobId !== null || isBulkPending} key={action} onClick={() => void runJobAction(job.id, action)} type="button">
                {pendingJobId === job.id ? "Pracuji…" : cleanupActionLabels[action]}
              </button>
            ))}
            {job.status === "failed" ? (
              <button
                disabled={pendingJobId !== null || isBulkPending || retryBlocked}
                onClick={() => {
                  setPendingJobId(job.id);
                  void onRetry(job).finally(() => setPendingJobId(null));
                }}
                type="button"
              >
                Zkusit znovu
              </button>
            ) : null}
          </div>
        );
      })}
      {cleanup.eligible_count > 0 ? (
        <button className="ai-job-cleanup-all" disabled={isBulkPending || pendingJobId !== null} onClick={() => void cleanupAll()} type="button">
          {isBulkPending ? "Čistím…" : bulkResumeCursor ? "Pokračovat v čištění" : `Vyčistit způsobilé (${cleanup.eligible_count})`}
        </button>
      ) : null}
      {recoveryMessage ? <p role="status">{recoveryMessage}</p> : null}
      </div>
    </details>
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
  onOutputsRemoved,
  output
}: {
  defaultOpen?: boolean;
  loadOutput?: (outputId: string) => Promise<unknown>;
  metadata: ManualAiOutputMetadata;
  onOutputsRemoved?: (outputIds: string[]) => void;
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
        <DeleteAiOutputForm next={pathname} onDeleted={onOutputsRemoved} outputId={output.id} />
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
