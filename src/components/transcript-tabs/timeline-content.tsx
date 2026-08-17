"use client";

import { useMemo } from "react";
import { AudioLines, Flag, Sparkles } from "lucide-react";
import {
  getTimelineChapterMeta,
  getPreferredTimelineChapters,
  getTimelineOutput,
  getTimelineRangeLabel
} from "@/components/transcript-tabs/timeline-utils";
import type { TranscriptTarget } from "@/components/transcript-tabs/types";
import { useAiProcessingRun } from "@/components/transcript-tabs/use-ai-processing-run";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
import type { RecordingMarkerRow, RecordingMarkerType } from "@/lib/recording-markers/types";
import { formatRecordingDate } from "@/lib/recordings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

const markerTypeLabels: Record<RecordingMarkerType, string> = {
  decision: "Rozhodnutí",
  follow_up: "Následný krok",
  important: "Důležitý moment",
  task: "Úkol"
};

// formatMarkerOffset renders a marker offset as a stable Czech clock label.
function formatMarkerOffset(offsetMs: number) {
  const totalSeconds = Math.max(0, Math.floor(offsetMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return hours > 0
    ? [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":")
    : [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

// TimelineContent renders recording markers before AI-generated topic chapters.
export function TimelineContent({
  activeTranscript,
  aiOutputs,
  defaultAiModel,
  markers,
  onOpenMarker,
  structuredItems
}: {
  activeTranscript: TranscriptRow | null;
  aiOutputs: AiOutputView[];
  defaultAiModel: string;
  markers: RecordingMarkerRow[];
  onOpenMarker: (target: TranscriptTarget, recordingId: string) => void;
  structuredItems: StructuredAiItems;
}) {
  const processing = useAiProcessingRun(activeTranscript?.id ?? null);
  const timelinePending = processing.isRunning("timeline_chapters");
  const timelineOutput = useMemo(() => getTimelineOutput(aiOutputs), [aiOutputs]);
  const chapters = useMemo(() => getPreferredTimelineChapters({
    aiOutputs,
    persistedChapters: structuredItems.chapters
  }), [aiOutputs, structuredItems.chapters]);
  const orderedMarkers = useMemo(() => [...markers].sort((left, right) =>
    left.offset_ms - right.offset_ms || left.id.localeCompare(right.id)
  ), [markers]);

  return (
    <div className="timeline-list timeline-list-rich">
      {orderedMarkers.length > 0 ? (
        <section className="timeline-marker-section" aria-labelledby="recording-markers-title">
          <header className="timeline-list-header">
            <div>
              <h3 id="recording-markers-title">Označené momenty</h3>
              <span>{orderedMarkers.length} uložených bodů nahrávky</span>
            </div>
            <Flag aria-hidden="true" size={17} />
          </header>
          <ol className="timeline-marker-list">
            {orderedMarkers.map((marker) => {
              const timeLabel = formatMarkerOffset(marker.offset_ms);
              const typeLabel = markerTypeLabels[marker.marker_type];

              return (
                <li key={marker.id}>
                  <button
                    aria-label={`${timeLabel}, ${typeLabel}${marker.note ? `, ${marker.note}` : ""}`}
                    className="timeline-row timeline-marker-row"
                    disabled={!activeTranscript}
                    onClick={() => {
                      if (!activeTranscript) {
                        return;
                      }

                      onOpenMarker({
                        endMs: null,
                        highlightText: marker.note,
                        playback: "play",
                        startMs: marker.offset_ms,
                        transcriptId: activeTranscript.id
                      }, marker.recording_id);
                    }}
                    type="button"
                  >
                    <time>{timeLabel}</time>
                    <span className="timeline-marker-copy">
                      <strong>{typeLabel}</strong>
                      {marker.note ? <span>{marker.note}</span> : <span>Bez poznámky</span>}
                      <small>{activeTranscript ? "Otevřít v přepisu" : "Přepis není dostupný"}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {!activeTranscript ? (
        <div className="transcript-empty">
          <AudioLines size={22} />
          <strong>Časová osa zatím není dostupná</strong>
          <p>Nejdřív dokončete přepis nahrávky.</p>
        </div>
      ) : chapters.length === 0 ? (
        <div className="transcript-empty">
          <AudioLines size={22} />
          <strong>Vytvořte obsahovou časovou osu</strong>
          <p>Časová osa vznikne z AI zpracování nad hotovým přepisem.</p>
          <button
            aria-describedby="timeline-generation-state"
            className="secondary-inline-action"
            disabled={timelinePending}
            onClick={() => void processing.run({
              model: defaultAiModel,
              processingType: "timeline_chapters"
            })}
            type="button"
          >
            <Sparkles aria-hidden="true" size={16} />
            <span>{timelinePending ? "Vytvářím časovou osu…" : "Vytvořit časovou osu"}</span>
          </button>
          <p
            className="timeline-generation-state"
            id="timeline-generation-state"
            role="status"
            aria-live="polite"
          >
            {processing.message ?? "Výsledek se uloží do této nahrávky."}
          </p>
        </div>
      ) : (
        <section className="timeline-chapter-section" aria-labelledby="timeline-chapters-title">
          <header className="timeline-list-header">
            <div>
              <strong id="timeline-chapters-title">Obsahová časová osa</strong>
              <span>{chapters.length} kapitol z AI zpracování</span>
            </div>
            {timelineOutput ? <time>{formatRecordingDate(timelineOutput.created_at)}</time> : null}
          </header>
          {chapters.map((chapter, index) => (
            <article className="timeline-row timeline-chapter" key={`${chapter.title}-${index}`}>
              <time>{getTimelineRangeLabel(chapter)}</time>
              <div>
                <header>
                  <strong>{chapter.title}</strong>
                  {getTimelineChapterMeta(chapter) ? <small>{getTimelineChapterMeta(chapter)}</small> : null}
                </header>
                <p>{chapter.summary}</p>
                {chapter.speakers.length > 0 ? (
                  <div className="timeline-chip-row" aria-label="Mluvčí kapitoly">
                    {chapter.speakers.map((speaker) => (
                      <span key={speaker}>{speaker}</span>
                    ))}
                  </div>
                ) : null}
                {chapter.relatedActionItems.length > 0 ? (
                  <ul>
                    {chapter.relatedActionItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
                {chapter.decisions.length > 0 ? (
                  <small>Rozhodnutí: {chapter.decisions.join("; ")}</small>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
