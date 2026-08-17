"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion
} from "lucide-react";
import {
  buildStructuredChecklistMarkdown,
  copyTextToClipboard,
  downloadMarkdownFile
} from "@/components/transcript-tabs/export-utils";
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
  resolveEvidenceTarget: EvidenceTargetResolver;
};

// StructuredItemsContent renders normalized AI rows as actionable workspace data.
export function StructuredItemsContent({
  items,
  onOpenEvidence,
  resolveEvidenceTarget
}: {
  items: StructuredAiItems;
  onOpenEvidence: (target: TranscriptTarget) => void;
  resolveEvidenceTarget?: EvidenceTargetResolver;
}) {
  const [checklistMessage, setChecklistMessage] = useState<string | null>(null);
  const hasStructuredItems = items.tasks.length > 0 || items.decisions.length > 0 || items.risks.length > 0;
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
      {items.tasks.length > 0 ? (
        <div className="structured-ai-block">
          <header>
            <strong>Úkoly jako checklist</strong>
            <span>{items.tasks.length} položek</span>
            <div className="structured-checklist-actions" aria-label="Export checklistu">
              <button onClick={copyChecklist} type="button">
                <Copy size={13} />
                Kopírovat
              </button>
              <button onClick={downloadChecklist} type="button">
                <Download size={13} />
                MD
              </button>
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
          onOpenEvidence={onOpenEvidence}
          resolveEvidenceTarget={activeEvidenceTargetResolver}
        />
      ) : null}
      {items.risks.length > 0 ? (
        <StructuredRiskList
          onOpenEvidence={onOpenEvidence}
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
  resolveEvidenceTarget,
  task
}: {
  task: StructuredTaskRow;
} & EvidenceNavigationProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleted, setIsDeleted] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState(task.status);
  const router = useRouter();
  const isDone = localStatus === "done";
  const meta = getTaskMeta(task);

  useEffect(() => {
    setLocalStatus(task.status);
  }, [task.status]);

  // toggleTaskStatus saves one checklist status without leaving the current scroll position.
  function toggleTaskStatus() {
    if (!task.id || isPending) {
      return;
    }

    const previousStatus = localStatus;
    const nextStatus = getNextStructuredTaskStatus(localStatus);

    setLocalStatus(nextStatus);
    setErrorMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/transcript-tasks/${task.id}/status`, {
          body: JSON.stringify({ status: nextStatus }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH"
        });

        if (!response.ok) {
          setLocalStatus(previousStatus);
          setErrorMessage("Stav úkolu se nepodařilo uložit.");
        }
      } catch {
        setLocalStatus(previousStatus);
        setErrorMessage("Stav úkolu se nepodařilo uložit. Zkontrolujte připojení.");
      }
    });
  }

  // deleteTask removes only this logical task projection and restores it after a failed request.
  async function deleteTask() {
    if (!task.id || isDeleting || !window.confirm(
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

      router.refresh();
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
        disabled={!task.id || isPending}
        onClick={toggleTaskStatus}
        type="button"
      >
        {isDone ? <CheckCircle2 size={15} /> : <Circle size={15} />}
      </button>
      <div className="structured-task-copy">
        <strong>{task.title}</strong>
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
      <button
        aria-label={`Smazat úkol: ${task.title}`}
        className="structured-task-delete"
        disabled={!task.id || isDeleting}
        onClick={deleteTask}
        title={`Smazat úkol: ${task.title}`}
        type="button"
      >
        <Trash2 aria-hidden="true" size={15} />
      </button>
    </article>
  );
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
  onOpenEvidence,
  resolveEvidenceTarget
}: {
  decisions: StructuredDecisionRow[];
} & EvidenceNavigationProps) {
  return (
    <div className="structured-ai-block structured-ai-compact-block">
      <header>
        <strong>Rozhodnutí</strong>
        <span>{decisions.length} položek</span>
      </header>
      <ul>
        {decisions.map((decision) => (
          <li data-decision-status={getDecisionState(decision)} key={decision.id ?? `${decision.ai_output_id}-${decision.position}`}>
            {getDecisionIcon(decision)}
            <span>
              <strong>{decision.title}</strong>
              <small>{getDecisionLabel(decision)}</small>
              <StructuredEvidence
                evidenceEndMs={decision.evidence_end_ms}
                evidenceQuote={decision.evidence_quote}
                evidenceStartMs={decision.evidence_start_ms}
                onOpenEvidence={onOpenEvidence}
                resolveEvidenceTarget={resolveEvidenceTarget}
                transcriptId={decision.transcript_id}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
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
  onOpenEvidence,
  resolveEvidenceTarget,
  risks
}: {
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
          <li data-risk-row="true" key={risk.id ?? `${risk.ai_output_id}-${risk.position}`}>
            <AlertTriangle size={13} />
            <span>
              <strong>{risk.title}</strong>
              {risk.impact ? <small>Dopad: {risk.impact}</small> : null}
              {risk.mitigation ? <em>Další krok: {risk.mitigation}</em> : null}
              <StructuredEvidence
                evidenceEndMs={risk.evidence_end_ms}
                evidenceQuote={risk.evidence_quote}
                evidenceStartMs={risk.evidence_start_ms}
                onOpenEvidence={onOpenEvidence}
                resolveEvidenceTarget={resolveEvidenceTarget}
                transcriptId={risk.transcript_id}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
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
