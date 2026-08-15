"use client";

import { useEffect, useRef, useState } from "react";
import {
  getSpeakerClassName,
  getSpeakerSummaryMeta
} from "@/components/transcript-tabs/speaker-blocks";
import { saveTranscriptSpeakerAutosaveAction } from "@/lib/transcripts/actions";
import {
  SPEAKER_SAVE_ERROR,
  type TranscriptSpeakerSaveInput,
  type TranscriptSpeakerSaveResult
} from "@/lib/transcripts/speaker-save-state";
import {
  getTranscriptSpeakerRoleLabel,
  type TranscriptSpeakerRole,
  type TranscriptSpeakerSummary
} from "@/lib/transcripts/speakers";

type SaveStatus = {
  kind: "error" | "saved" | "saving" | "warning";
  message: string;
  revision: number;
};

const roleOptions: Array<{ label: string; value: TranscriptSpeakerRole }> = [
  { label: "Nepřiřazeno", value: "unknown" },
  { label: "Klient", value: "client_customer" },
  { label: "Dodavatel / náš tým", value: "delivery_team" }
];

// SpeakerSummaryEditor autosaves controlled speaker drafts through one transcript-wide write queue.
export function SpeakerSummaryEditor({
  onSpeakersChange,
  speakers,
  transcriptId
}: {
  onSpeakersChange: (speakers: TranscriptSpeakerSummary[]) => void;
  speakers: TranscriptSpeakerSummary[];
  transcriptId: string;
}) {
  const [drafts, setDrafts] = useState(speakers);
  const [statuses, setStatuses] = useState<Record<string, SaveStatus>>({});
  const draftsRef = useRef(speakers);
  const confirmedRef = useRef(speakers);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const revisionsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    draftsRef.current = drafts;
    onSpeakersChange(drafts);
  }, [drafts, onSpeakersChange]);

  // updateDraft applies the visible value immediately without waiting for the server.
  function updateDraft(speakerId: string, update: Partial<Pick<TranscriptSpeakerSummary, "name" | "role">>) {
    const nextDrafts = draftsRef.current.map((speaker) => speaker.id === speakerId
      ? {
          ...speaker,
          ...update,
          roleLabel: update.role ? getTranscriptSpeakerRoleLabel(update.role) : speaker.roleLabel
        }
      : speaker);
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
  }

  // enqueueSave serializes whole-JSON writes and applies a settlement only to its matching revision.
  function enqueueSave(speakerId: string) {
    const speaker = draftsRef.current.find((candidate) => candidate.id === speakerId);

    if (!speaker) {
      return;
    }

    const revision = (revisionsRef.current[speakerId] ?? 0) + 1;
    revisionsRef.current[speakerId] = revision;
    const input: TranscriptSpeakerSaveInput = {
      name: speaker.name?.trim() || null,
      revision,
      role: speaker.role,
      speakerId,
      transcriptId
    };
    setStatuses((current) => ({
      ...current,
      [speakerId]: { kind: "saving", message: "Ukládám…", revision }
    }));

    queueRef.current = queueRef.current.catch(() => undefined).then(async () => {
      let result: TranscriptSpeakerSaveResult;
      try {
        result = await saveTranscriptSpeakerAutosaveAction(input);
      } catch {
        result = { message: SPEAKER_SAVE_ERROR, revision, status: "error" };
      }

      if (result.status === "success") {
        confirmedRef.current = confirmedRef.current.map((candidate) => candidate.id === speakerId
          ? result.savedSpeaker
          : candidate);
      }

      if (revisionsRef.current[speakerId] !== result.revision) {
        return;
      }

      if (result.status === "error") {
        setStatuses((current) => ({
          ...current,
          [speakerId]: { kind: "error", message: result.message, revision }
        }));
        return;
      }

      setStatuses((current) => ({
        ...current,
        [speakerId]: {
          kind: result.searchWarning ? "warning" : "saved",
          message: result.searchWarning ?? "Uloženo",
          revision
        }
      }));
    });
  }

  return (
    <div className="speaker-summary-list" role="list">
      {drafts.map((speaker) => {
        const status = statuses[speaker.id];

        return (
          <div className="speaker-summary-form" key={speaker.id} role="listitem">
            <div className="speaker-summary-identity">
              <span className={`speaker ${getSpeakerClassName(speaker.id)}`}>{speaker.label}</span>
              <small>{getSpeakerSummaryMeta(speaker)}</small>
            </div>
            <label className="speaker-summary-field">
              <span>Jméno</span>
              <input
                aria-label={`Jméno ${speaker.label}`}
                autoComplete="off"
                maxLength={80}
                onBlur={() => {
                  const confirmed = confirmedRef.current.find((candidate) => candidate.id === speaker.id);
                  if ((speaker.name?.trim() || null) !== (confirmed?.name ?? null)) {
                    enqueueSave(speaker.id);
                  }
                }}
                onChange={(event) => updateDraft(speaker.id, { name: event.target.value })}
                value={speaker.name ?? ""}
              />
            </label>
            <label className="speaker-summary-field">
              <span>Role</span>
              <select
                aria-label={`Role ${speaker.label}`}
                onChange={(event) => {
                  updateDraft(speaker.id, { role: event.target.value as TranscriptSpeakerRole });
                  queueMicrotask(() => enqueueSave(speaker.id));
                }}
                value={speaker.role}
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <strong className="speaker-summary-state">{speaker.name || speaker.label} · {speaker.roleLabel}</strong>
            <div className="speaker-summary-feedback" role="status" aria-live="polite">
              <span>{status?.message ?? ""}</span>
              {status?.kind === "error" ? (
                <button
                  aria-label={`Zkusit znovu uložit ${speaker.label}`}
                  onClick={() => enqueueSave(speaker.id)}
                  type="button"
                >
                  Zkusit znovu
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
