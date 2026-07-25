"use client";

import { useMemo } from "react";
import { AudioLines } from "lucide-react";
import {
  getTimelineChapterMeta,
  getPreferredTimelineChapters,
  getTimelineOutput,
  getTimelineRangeLabel
} from "@/components/transcript-tabs/timeline-utils";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
import { formatRecordingDate } from "@/lib/recordings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

// TimelineContent renders AI-generated topic chapters for the active transcript.
export function TimelineContent({
  activeTranscript,
  aiOutputs,
  onOpenAiTab,
  structuredItems
}: {
  activeTranscript: TranscriptRow | null;
  aiOutputs: AiOutputView[];
  onOpenAiTab: () => void;
  structuredItems: StructuredAiItems;
}) {
  const timelineOutput = useMemo(() => getTimelineOutput(aiOutputs), [aiOutputs]);
  const chapters = useMemo(() => getPreferredTimelineChapters({
    aiOutputs,
    persistedChapters: structuredItems.chapters
  }), [aiOutputs, structuredItems.chapters]);

  if (!activeTranscript) {
    return (
      <div className="transcript-empty">
        <AudioLines size={22} />
        <strong>Časová osa zatím není dostupná</strong>
        <p>Nejdřív dokončete přepis nahrávky.</p>
      </div>
    );
  }

  if (chapters.length === 0) {
    return (
      <div className="transcript-empty">
        <AudioLines size={22} />
        <strong>Vytvořte obsahovou časovou osu</strong>
        <p>Časová osa vznikne z AI zpracování nad hotovým přepisem.</p>
        <button className="secondary-inline-action" onClick={onOpenAiTab} type="button">
          Otevřít AI zpracování
        </button>
      </div>
    );
  }

  return (
    <div className="timeline-list timeline-list-rich">
      <header className="timeline-list-header">
        <div>
          <strong>Obsahová časová osa</strong>
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
    </div>
  );
}
