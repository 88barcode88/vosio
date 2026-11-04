"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRecordingCapabilities } from "@/components/recording-capability-context";
import {
  TriangleAlert,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion
} from "lucide-react";
import {
  buildStructuredChecklistMarkdown,
  buildStructuredItemClipboardText,
  copyTextToClipboard,
  downloadMarkdownFile
} from "@/components/transcript-tabs/export-utils";
import {
  getEvidenceLocation,
  CopyableTitle,
  StructuredItemActions,
  useStructuredItemGroupDelete,
  type EvidenceSpeakerResolver
} from "@/components/transcript-tabs/structured-item-actions";
import { getNextStructuredTaskStatus } from "@/lib/ai/structured-status";
import type {
  StructuredAiItems,
  StructuredDecisionRow,
  StructuredOwnerCategory,
  StructuredRiskRow,
  StructuredTaskRow
} from "@/lib/ai/structured-types";
import type {
  TranscriptEvidenceReference,
  TranscriptTarget
} from "@/components/transcript-tabs/types";

const ownerOrder: StructuredOwnerCategory[] = ["Moje práce", "Klient", "Nejasné"];

type EvidenceTargetResolver = (reference: TranscriptEvidenceReference) => TranscriptTarget | null;

type EvidenceNavigationProps = {
  onOpenEvidence: (target: TranscriptTarget) => void;
  resolveEvidenceSpeaker?: EvidenceSpeakerResolver;
  resolveEvidenceTarget: EvidenceTargetResolver;
};

// StructuredItemsContent renders normalized AI rows as actionable workspace data.
export function StructuredItemsContent({
  items,
  checklistAction,
  checklistPending = false,
  onItemsDeleted,
  onOpenEvidence,
  onTaskDeleted,
  onTaskStatusConfirmed,
  resolveEvidenceSpeaker,
  resolveEvidenceTarget
}: {
  items: StructuredAiItems;
  checklistAction?: ReactNode;
  checklistPending?: boolean;
  onItemsDeleted?: (ids: string[]) => void;
  onOpenEvidence: (target: TranscriptTarget) => void;
  onTaskDeleted?: (task: StructuredTaskRow) => void;
  onTaskStatusConfirmed?: (task: StructuredTaskRow, status: StructuredTaskRow["status"]) => void;
  resolveEvidenceSpeaker?: EvidenceSpeakerResolver;
  resolveEvidenceTarget?: EvidenceTargetResolver;
}) {
  const [checklistMessage, setChecklistMessage] = useState<string | null>(null);
  const hasTasks = items.tasks.length > 0 || checklistPending;
  const hasStructuredItems = checklistPending || items.tasks.length > 0 || items.decisions.length > 0 || items.risks.length > 0;
  const activeEvidenceTargetResolver = resolveEvidenceTarget ?? resolveStoredEvidenceTarget;

  // copyChecklist copies the normalized task checklist as readable Markdown.
  async function copyChecklist() {
    await copyTextToClipboard(buildStructuredChecklistMarkdown(items.tasks));
    setChecklistMessage("Checklist zkopírován.");
  }

  // downloadChecklist saves the normalized task checklist as a Markdown file.
  function downloadChecklist() {
    downloadMarkdownFile("vosio-checklist", buildStructuredChecklistMarkdown(items.tasks));
    setChecklistMessage("Checklist stažen jako MD.");
  }

  if (!hasStructuredItems) {
    return null;
  }

  return (
    <section className="structured-ai-section" aria-label="Strukturované AI položky">
      {hasStructuredItems ? (
        <div className="structured-ai-block">
          <header>
            <strong>{hasTasks ? "Úkoly jako checklist" : "Checklist"}</strong>
            {hasTasks ? <span>{items.tasks.length} položek</span> : null}
            <div className="structured-checklist-actions" aria-label="Akce checklistu">
              {hasTasks ? <>
                <button disabled={checklistPending} onClick={copyChecklist} type="button">
                  <Copy size={13} />
                  Kopírovat
                </button>
                <button disabled={checklistPending} onClick={downloadChecklist} type="button">
                  <Download size={13} />
                  MD
                </button>
              </> : null}
              {checklistAction}
            </div>
          </header>
          {checklistMessage ? <p className="structured-checklist-message">{checklistMessage}</p> : null}
          <div className="structured-task-groups">
            {groupTasksByOwner(items.tasks).map((group) => (
              <section className="structured-task-group" data-owner-category={group.ownerCategory} key={group.ownerCategory}>
                <header>
                  <strong>{group.ownerCategory}</strong>
                  <span>{group.tasks.length}</span>
                </header>
                <div className="structured-task-list">
                  {group.tasks.map((task) => (
                    <StructuredTaskRowView
                      key={task.id ?? `${task.ai_output_id}-${task.position}`}
                      onOpenEvidence={onOpenEvidence}
                      onTaskDeleted={onTaskDeleted}
                      onTaskStatusConfirmed={onTaskStatusConfirmed}
                      resolveEvidenceSpeaker={resolveEvidenceSpeaker}
                      resolveEvidenceTarget={activeEvidenceTargetResolver}
                      task={task}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}
      {items.decisions.length > 0 ? (
        <StructuredDecisionList
          decisions={items.decisions}
          onItemsDeleted={onItemsDeleted}
          onOpenEvidence={onOpenEvidence}
          resolveEvidenceSpeaker={resolveEvidenceSpeaker}
          resolveEvidenceTarget={activeEvidenceTargetResolver}
        />
      ) : null}
      {items.risks.length > 0 ? (
        <StructuredRiskList
          onItemsDeleted={onItemsDeleted}
          onOpenEvidence={onOpenEvidence}
          resolveEvidenceSpeaker={resolveEvidenceSpeaker}
          resolveEvidenceTarget={activeEvidenceTargetResolver}
          risks={items.risks}
        />
      ) : null}
    </section>
  );
}

// groupTasksByOwner keeps the checklist in predictable business buckets.
function groupTasksByOwner(tasks: StructuredTaskRow[]) {
  return ownerOrder
    .map((ownerCategory) => ({
      ownerCategory,
      tasks: tasks.filter((task) => task.owner_category === ownerCategory)
    }))
    .filter((group) => group.tasks.length > 0);
}

// StructuredTaskRowView renders one persisted task with an optimistic status toggle.
function StructuredTaskRowView({
  onOpenEvidence,
  onTaskDeleted,
  onTaskStatusConfirmed,
  resolveEvidenceSpeaker,
  resolveEvidenceTarget,
  task
}: {
  task: StructuredTaskRow;
  onTaskDeleted?: (task: StructuredTaskRow) => void;
  onTaskStatusConfirmed?: (task: StructuredTaskRow, status: StructuredTaskRow["status"]) => void;
} & EvidenceNavigationProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { capabilities } = useRecordingCapabilities();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleted, setIsDeleted] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState(task.status);
  const pendingStatusActionRef = useRef<number | null>(null);
  const statusActionIdRef = useRef(0);
  const isDone = localStatus === "done";
  const meta = getTaskMeta(task);

  useEffect(() => {
    if (pendingStatusActionRef.current === null) {
      setLocalStatus(task.status);
    }
  }, [task.status]);

  // toggleTaskStatus saves one checklist status without leaving the current scroll position.
  function toggleTaskStatus() {
    if (!capabilities.editTaskStatus || !task.id || isPending || pendingStatusActionRef.current !== null) {
      return;
    }

    const previousStatus = localStatus;
    const nextStatus = getNextStructuredTaskStatus(localStatus);
    const actionId = statusActionIdRef.current + 1;
    statusActionIdRef.current = actionId;
    pendingStatusActionRef.current = actionId;

    setLocalStatus(nextStatus);
    setErrorMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/transcript-tasks/${task.id}/status`, {
          body: JSON.stringify({ status: nextStatus }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH"
        });

        const payload = await response.json().catch(() => null) as {
          ok?: unknown;
          status?: unknown;
        } | null;

        if (
          !response.ok
          || !payload
          || payload.ok !== true
          || payload.status !== nextStatus
        ) {
          throw new Error("Task status response was not accepted.");
        }

        if (pendingStatusActionRef.current !== actionId) {
          return;
        }

        setLocalStatus(nextStatus);
        setErrorMessage(null);
        onTaskStatusConfirmed?.(task, nextStatus);
      } catch {
        if (pendingStatusActionRef.current !== actionId) {
          return;
        }

        setLocalStatus(previousStatus);
        setErrorMessage("Stav úkolu se nepodařilo uložit.");
      } finally {
        if (pendingStatusActionRef.current === actionId) {
          pendingStatusActionRef.current = null;
        }
      }
    });
  }

  // deleteTask removes only this logical task projection and restores it after a failed request.
  async function deleteTask() {
    if (!capabilities.delete || !task.id || isDeleting || !window.confirm(
      `Smazat úkol „${task.title}“? Původní AI výstup zůstane uložený.`
    )) {
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);
    setIsDeleted(true);

    try {
      const response = await fetch(`/api/transcript-tasks/${task.id}`, {
        credentials: "same-origin",
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error("Task delete failed.");
      }

      onTaskDeleted?.(task);
    } catch {
      setIsDeleted(false);
      setDeleteError("Úkol se nepodařilo smazat. Zkuste to znovu.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <article
      className="structured-task-row"
      data-owner-category={task.owner_category}
      data-task-status={localStatus}
      hidden={isDeleted}
    >
      <button
        aria-label={isDone ? "Označit úkol jako nedokončený" : "Označit úkol jako hotový"}
        aria-pressed={isDone}
        disabled={!capabilities.editTaskStatus || !task.id || isPending}
        onClick={toggleTaskStatus}
        type="button"
      >
        {isDone ? <CheckCircle2 size={15} /> : <Circle size={15} />}
      </button>
      <div className="structured-task-copy">
        <CopyableTitle text={task.title} />
        {meta.length > 0 ? (
          <div className="structured-task-meta">
            {meta.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ) : null}
        {task.description ? <p>{task.description}</p> : null}
        <StructuredEvidence
          evidenceEndMs={task.evidence_end_ms}
          evidenceQuote={task.evidence_quote}
          evidenceStartMs={task.evidence_start_ms}
          onOpenEvidence={onOpenEvidence}
          resolveEvidenceTarget={resolveEvidenceTarget}
          transcriptId={task.transcript_id}
        />
        {errorMessage ? (
          <p className="structured-task-status-message" role="status">
            {errorMessage}
          </p>
        ) : null}
        {deleteError ? <p className="structured-task-delete-error" role="alert">{deleteError}</p> : null}
      </div>
      <StructuredItemActions
        canDelete={capabilities.delete && Boolean(task.id)}
        copyText={() => buildStructuredItemClipboardText({
          details: meta,
          evidenceLocation: getRowEvidenceLocation(task, resolveEvidenceTarget, resolveEvidenceSpeaker),
          evidenceQuote: task.evidence_quote,
          lines: [task.description],
          title: task.title
        })}
        deleteLabel={`Smazat úkol: ${task.title}`}
        isDeleting={isDeleting}
        onDelete={deleteTask}
      />
    </article>
  );
}

// getRowEvidenceLocation resolves time and speaker of a structured row's evidence quote for clipboard output.
function getRowEvidenceLocation(
  row: Pick<StructuredTaskRow, "evidence_end_ms" | "evidence_quote" | "evidence_start_ms" | "transcript_id">,
  resolveEvidenceTarget: EvidenceTargetResolver,
  resolveEvidenceSpeaker?: EvidenceSpeakerResolver
) {
  if (!row.evidence_quote) {
    return [];
  }

  return getEvidenceLocation({
    endMs: row.evidence_end_ms,
    quote: row.evidence_quote,
    startMs: row.evidence_start_ms,
    transcriptId: row.transcript_id
  }, resolveEvidenceTarget, resolveEvidenceSpeaker);
}

// getTaskMeta builds compact chips for deadline, owner and current state.
function getTaskMeta(task: StructuredTaskRow) {
  return [
    task.owner_name ?? task.owner_category,
    task.deadline ? `Termín: ${task.deadline}` : null,
    task.deadline_normalized ? `Datum: ${task.deadline_normalized}` : null,
    task.status !== "new" ? getTaskStatusLabel(task.status) : null,
    task.source_type === "inferred" ? "Odvozeno" : null
  ].filter((item): item is string => Boolean(item));
}

// getTaskStatusLabel maps stored task states into Czech UI labels.
function getTaskStatusLabel(status: StructuredTaskRow["status"]) {
  const labels: Record<StructuredTaskRow["status"], string> = {
    done: "Hotovo",
    ignored: "Ignorováno",
    in_progress: "Rozpracováno",
    new: "Nové",
    unclear: "Nejasné",
    waiting: "Čeká"
  };

  return labels[status];
}

// StructuredDecisionList renders confirmations separately from already agreed decisions.
function StructuredDecisionList({
  decisions,
  onItemsDeleted,
  ...evidenceProps
}: {
  decisions: StructuredDecisionRow[];
  onItemsDeleted?: (ids: string[]) => void;
} & EvidenceNavigationProps) {
  return (
    <div className="structured-ai-block structured-ai-compact-block">
      <header>
        <strong>Rozhodnutí</strong>
        <span>{decisions.length} položek</span>
      </header>
      <ul>
        {decisions.map((decision) => (
          <StructuredDecisionRowView
            decision={decision}
            key={decision.id ?? `${decision.ai_output_id}-${decision.position}`}
            onItemsDeleted={onItemsDeleted}
            {...evidenceProps}
          />
        ))}
      </ul>
    </div>
  );
}

// StructuredDecisionRowView renders one decision with text copy, full-item copy and logical-group delete.
function StructuredDecisionRowView({
  decision,
  onItemsDeleted,
  onOpenEvidence,
  resolveEvidenceSpeaker,
  resolveEvidenceTarget
}: {
  decision: StructuredDecisionRow;
  onItemsDeleted?: (ids: string[]) => void;
} & EvidenceNavigationProps) {
  const { capabilities } = useRecordingCapabilities();
  const label = getDecisionLabel(decision);
  const { deleteError, isDeleted, isDeleting, remove } = useStructuredItemGroupDelete({
    confirmText: `Smazat rozhodnutí „${decision.title}“? Původní AI výstup zůstane uložený.`,
    endpoint: capabilities.delete && decision.id ? `/api/transcript-decisions/${decision.id}` : null,
    failureText: "Rozhodnutí se nepodařilo smazat. Zkuste to znovu.",
    onDeleted: onItemsDeleted
  });

  return (
    <li data-decision-status={getDecisionState(decision)} hidden={isDeleted}>
      {getDecisionIcon(decision)}
      <span>
        <CopyableTitle text={decision.title} />
        <small>{label}</small>
        <StructuredEvidence
          evidenceEndMs={decision.evidence_end_ms}
          evidenceQuote={decision.evidence_quote}
          evidenceStartMs={decision.evidence_start_ms}
          onOpenEvidence={onOpenEvidence}
          resolveEvidenceTarget={resolveEvidenceTarget}
          transcriptId={decision.transcript_id}
        />
        {deleteError ? <p className="structured-task-delete-error" role="alert">{deleteError}</p> : null}
      </span>
      <StructuredItemActions
        canDelete={capabilities.delete && Boolean(decision.id)}
        copyText={() => buildStructuredItemClipboardText({
          details: [label],
          evidenceLocation: getRowEvidenceLocation(decision, resolveEvidenceTarget, resolveEvidenceSpeaker),
          evidenceQuote: decision.evidence_quote,
          title: decision.title
        })}
        deleteLabel={`Smazat rozhodnutí: ${decision.title}`}
        isDeleting={isDeleting}
        onDelete={() => void remove()}
      />
    </li>
  );
}

// getDecisionState classifies stored decision status for visual treatment.
function getDecisionState(decision: StructuredDecisionRow) {
  const status = decision.status?.toLowerCase() ?? "";

  if (["decided", "agreed", "confirmed"].includes(status)) {
    return "decided";
  }

  if (["needs_confirmation", "to_confirm", "proposed", "deferred", "unknown"].includes(status)) {
    return "needs_confirmation";
  }

  return "decision";
}

// getDecisionLabel returns a Czech status label for decision rows.
function getDecisionLabel(decision: StructuredDecisionRow) {
  const state = getDecisionState(decision);

  if (state === "decided") {
    return "Dohodnuto";
  }

  if (state === "needs_confirmation") {
    return "K potvrzení";
  }

  return decision.owner_category ?? "Rozhodnutí";
}

// getDecisionIcon chooses an icon that distinguishes agreement from pending confirmation.
function getDecisionIcon(decision: StructuredDecisionRow) {
  const state = getDecisionState(decision);

  if (state === "decided") {
    return <ShieldCheck size={13} />;
  }

  if (state === "needs_confirmation") {
    return <ShieldQuestion size={13} />;
  }

  return <ShieldAlert size={13} />;
}

// StructuredRiskList renders compact risks and blockers with impact details.
function StructuredRiskList({
  onItemsDeleted,
  risks,
  ...evidenceProps
}: {
  onItemsDeleted?: (ids: string[]) => void;
  risks: StructuredRiskRow[];
} & EvidenceNavigationProps) {
  return (
    <div className="structured-ai-block structured-ai-compact-block">
      <header>
        <strong>Rizika / blokery</strong>
        <span>{risks.length} položek</span>
      </header>
      <ul>
        {risks.map((risk) => (
          <StructuredRiskRowView
            key={risk.id ?? `${risk.ai_output_id}-${risk.position}`}
            onItemsDeleted={onItemsDeleted}
            risk={risk}
            {...evidenceProps}
          />
        ))}
      </ul>
    </div>
  );
}

// StructuredRiskRowView renders one risk/blocker with text copy, full-item copy and logical-group delete.
function StructuredRiskRowView({
  onItemsDeleted,
  onOpenEvidence,
  resolveEvidenceSpeaker,
  resolveEvidenceTarget,
  risk
}: {
  onItemsDeleted?: (ids: string[]) => void;
  risk: StructuredRiskRow;
} & EvidenceNavigationProps) {
  const { capabilities } = useRecordingCapabilities();
  const impact = risk.impact ? `Dopad: ${risk.impact}` : null;
  const mitigation = risk.mitigation ? `Další krok: ${risk.mitigation}` : null;
  const { deleteError, isDeleted, isDeleting, remove } = useStructuredItemGroupDelete({
    confirmText: `Smazat riziko „${risk.title}“? Původní AI výstup zůstane uložený.`,
    endpoint: capabilities.delete && risk.id ? `/api/transcript-risks/${risk.id}` : null,
    failureText: "Riziko se nepodařilo smazat. Zkuste to znovu.",
    onDeleted: onItemsDeleted
  });

  return (
    <li data-risk-row="true" hidden={isDeleted}>
      <TriangleAlert size={13} />
      <span>
        <CopyableTitle text={risk.title} />
        {impact ? <small>{impact}</small> : null}
        {mitigation ? <em>{mitigation}</em> : null}
        <StructuredEvidence
          evidenceEndMs={risk.evidence_end_ms}
          evidenceQuote={risk.evidence_quote}
          evidenceStartMs={risk.evidence_start_ms}
          onOpenEvidence={onOpenEvidence}
          resolveEvidenceTarget={resolveEvidenceTarget}
          transcriptId={risk.transcript_id}
        />
        {deleteError ? <p className="structured-task-delete-error" role="alert">{deleteError}</p> : null}
      </span>
      <StructuredItemActions
        canDelete={capabilities.delete && Boolean(risk.id)}
        copyText={() => buildStructuredItemClipboardText({
          evidenceLocation: getRowEvidenceLocation(risk, resolveEvidenceTarget, resolveEvidenceSpeaker),
          evidenceQuote: risk.evidence_quote,
          lines: [impact, mitigation],
          title: risk.title
        })}
        deleteLabel={`Smazat riziko: ${risk.title}`}
        isDeleting={isDeleting}
        onDelete={() => void remove()}
      />
    </li>
  );
}

// StructuredEvidence makes one resolvable quote the navigation action itself.
function StructuredEvidence({
  evidenceEndMs,
  evidenceQuote,
  evidenceStartMs,
  onOpenEvidence,
  resolveEvidenceTarget,
  transcriptId
}: {
  evidenceEndMs: number | null;
  evidenceQuote: string | null;
  evidenceStartMs: number | null;
  transcriptId: string;
} & EvidenceNavigationProps) {
  if (!evidenceQuote) {
    return null;
  }

  const evidenceTarget = resolveEvidenceTarget({
    endMs: evidenceEndMs,
    quote: evidenceQuote,
    startMs: evidenceStartMs,
    transcriptId
  });

  return (
    <div className="structured-evidence structured-evidence-compact">
      {evidenceTarget ? (
        <button
          aria-label={`Důkaz: ${evidenceQuote}`}
          className="structured-evidence-action"
          data-evidence-action="true"
          onClick={() => onOpenEvidence(evidenceTarget)}
          type="button"
        >
          "{evidenceQuote}"
        </button>
      ) : <p>"{evidenceQuote}"</p>}
    </div>
  );
}

// resolveStoredEvidenceTarget preserves direct navigation for callers that only provide saved ranges.
function resolveStoredEvidenceTarget(reference: TranscriptEvidenceReference): TranscriptTarget | null {
  if (
    reference.startMs === null
    || reference.endMs === null
    || !Number.isSafeInteger(reference.startMs)
    || !Number.isSafeInteger(reference.endMs)
    || reference.startMs < 0
    || reference.endMs < reference.startMs
  ) {
    return null;
  }

  return {
    endMs: reference.endMs,
    highlightText: reference.quote,
    playback: "play",
    startMs: reference.startMs,
    transcriptId: reference.transcriptId
  };
}
