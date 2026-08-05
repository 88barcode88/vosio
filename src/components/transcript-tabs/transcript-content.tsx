"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { speakerRoleOptions } from "@/components/transcript-tabs/constants";
import {
  getSpeakerClassName,
  getSpeakerSummaryMeta,
  getTranscriptSpeakerBlocks
} from "@/components/transcript-tabs/speaker-blocks";
import type { RecordingRow } from "@/lib/recordings/types";
import { updateTranscriptSpeakerAction } from "@/lib/transcripts/actions";
import {
  getStoredTranscriptSpeakerSummaries,
  getTranscriptSpeakerDisplayName
} from "@/lib/transcripts/speakers";
import type { TranscriptRow } from "@/lib/transcripts/types";

// getPendingTranscriptTitle returns the main empty-state title for the transcript tab.
function getPendingTranscriptTitle(activeRecording: RecordingRow | null) {
  if (!activeRecording) {
    return "Nahrajte první nahrávku";
  }

  if (activeRecording.status === "transcribing") {
    return "Soniox přepis běží";
  }

  if (activeRecording.status === "failed") {
    return "Přepis selhal";
  }

  return "Přepis zatím není dokončený";
}

// getPendingTranscriptDescription explains what the user should expect for the current state.
function getPendingTranscriptDescription(activeRecording: RecordingRow | null) {
  if (!activeRecording) {
    return "Po uploadu se tady objeví stav přepisu a později samotný transcript.";
  }

  if (activeRecording.status === "transcribing") {
    return "Soniox job je založený a běží mimo prohlížeč. Vosio teď stav kontroluje automaticky a po dokončení načte uložený transcript.";
  }

  if (activeRecording.status === "failed") {
    return "Soniox nebo ukládání přepisu vrátilo chybu. Zkontrolujte stav nebo zkuste přepis spustit znovu.";
  }

  if (activeRecording.status === "uploaded") {
    return "Audio je uložené. Spusťte Soniox job, potom bude Vosio stav kontrolovat automaticky.";
  }

  return "Čekám na dokončení aktuálního kroku nahrávky.";
}

// SpeakerSummary renders and edits stored diarization metadata for one transcript.
function SpeakerSummary({ activeTranscript }: { activeTranscript: TranscriptRow }) {
  const pathname = usePathname();
  const speakers = getStoredTranscriptSpeakerSummaries(activeTranscript.speakers, activeTranscript.segments);

  if (speakers.length === 0) {
    return null;
  }

  return (
    <section className="speaker-summary" aria-label="Souhrn mluvčích">
      <div className="speaker-summary-header">
        <strong>Mluvčí v přepisu</strong>
        <span>Pojmenujte mluvčí a potvrďte, jestli patří na klienta nebo na náš tým. AI to použije jako kontext.</span>
      </div>
      <div className="speaker-summary-list" role="list">
        {speakers.map((speaker) => (
          <form action={updateTranscriptSpeakerAction} className="speaker-summary-form" key={speaker.id} role="listitem">
            <input name="transcriptId" type="hidden" value={activeTranscript.id} />
            <input name="speakerId" type="hidden" value={speaker.id} />
            <input name="next" type="hidden" value={pathname} />
            <div className="speaker-summary-identity">
              <span className={`speaker ${getSpeakerClassName(speaker.id)}`}>{speaker.label}</span>
              <small>{getSpeakerSummaryMeta(speaker)}</small>
            </div>
            <label className="speaker-summary-field">
              <span>Jméno</span>
              <input
                autoComplete="off"
                defaultValue={speaker.name ?? ""}
                maxLength={80}
                name="name"
                placeholder="např. Anna Nováková"
              />
            </label>
            <label className="speaker-summary-field">
              <span>Role</span>
              <select defaultValue={speaker.role} name="role">
                {speakerRoleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <strong className="speaker-summary-state">{getTranscriptSpeakerDisplayName(speaker)} · {speaker.roleLabel}</strong>
            <button type="submit">Uložit</button>
          </form>
        ))}
      </div>
    </section>
  );
}

// TranscriptContent renders saved transcript blocks or the pending transcription empty state.
export function TranscriptContent({
  activeBlockAnchorId = null,
  activeRecording,
  activeTranscript,
  onOpenTime
}: {
  activeBlockAnchorId?: string | null;
  activeRecording: RecordingRow | null;
  activeTranscript: TranscriptRow | null;
  onOpenTime?: (startMs: number, anchorId: string) => void;
}) {
  const speakerBlocks = useMemo(
    () => activeTranscript ? getTranscriptSpeakerBlocks(activeTranscript.segments, activeTranscript.speakers) : [],
    [activeTranscript]
  );

  if (activeTranscript) {
    if (speakerBlocks.length > 0) {
      return (
        <div className="transcript-list transcript-content">
          <SpeakerSummary activeTranscript={activeTranscript} />
          <div className="transcript-table-scroll">
            <div className="transcript-table" role="table" aria-label="Přepis podle mluvčích">
              <div className="transcript-table-head" role="row">
                <span role="columnheader">Čas</span>
                <span role="columnheader">Mluvčí</span>
                <span role="columnheader">Text</span>
              </div>
              {speakerBlocks.map((block) => (
                <div
                  aria-current={activeBlockAnchorId === block.anchorId ? "true" : undefined}
                  className={activeBlockAnchorId === block.anchorId
                    ? "transcript-table-row transcript-table-row-highlighted"
                    : "transcript-table-row"}
                  id={block.anchorId}
                  key={block.anchorId}
                  role="row"
                  tabIndex={-1}
                >
                  <time role="cell">
                    {block.startMs !== null && onOpenTime ? (
                      <button
                        aria-label={`Otevřít přepis od ${block.label}`}
                        onClick={() => onOpenTime(block.startMs as number, block.anchorId)}
                        type="button"
                      >
                        {block.label}
                      </button>
                    ) : block.label}
                  </time>
                  <span className={`speaker ${block.speakerClassName}`} role="cell">{block.speakerLabel}</span>
                  <p role="cell">{block.text.trim()}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="transcript-list transcript-list-scroll">
        <SpeakerSummary activeTranscript={activeTranscript} />
        <section className="transcript-raw-block" aria-label="Soniox přepis">
          <strong>Soniox přepis</strong>
          <p>{activeTranscript.raw_text}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="transcript-empty">
      <UploadCloud size={34} />
      <strong>{getPendingTranscriptTitle(activeRecording)}</strong>
      <p>{getPendingTranscriptDescription(activeRecording)}</p>
    </div>
  );
}
