import { speakerClassNames } from "@/components/transcript-tabs/constants";
import type { TranscriptSpeakerBlock } from "@/components/transcript-tabs/types";
import { getTranscriptAnchorId } from "@/lib/transcripts/navigation";
import {
  getConsecutiveTranscriptSpeakerGroups,
  hasRenderableSpeakerGroups
} from "@/lib/transcripts/search-chunks";
import type { TranscriptSpeakerSummary } from "@/lib/transcripts/speakers";

// formatTokenTimestamp renders provider millisecond offsets for transcript blocks.
export function formatTokenTimestamp(startMs: number | null, fallbackIndex: number) {
  if (startMs === null) {
    return `#${fallbackIndex + 1}`;
  }

  const totalSeconds = Math.floor(startMs / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

// getSpeakerClassName keeps repeated speaker ids visually stable in the transcript.
export function getSpeakerClassName(speaker: string | null) {
  if (!speaker) {
    return "speaker-teal";
  }

  const numericSpeaker = Number.parseInt(speaker, 10);
  const classIndex = Number.isNaN(numericSpeaker)
    ? Math.abs(speaker.split("").reduce((total, char) => total + char.charCodeAt(0), 0))
    : numericSpeaker;

  return speakerClassNames[classIndex % speakerClassNames.length];
}

// getTranscriptSpeakerBlocks groups consecutive Soniox tokens by diarized speaker.
export function getTranscriptSpeakerBlocks(segments: unknown, speakers: unknown): TranscriptSpeakerBlock[] {
  const groups = getConsecutiveTranscriptSpeakerGroups(segments, speakers);

  if (!hasRenderableSpeakerGroups(groups)) {
    return [];
  }

  const startMsOccurrences = new Map<number, number>();

  return groups.map((group, fallbackIndex) => {
    const timestampOccurrence = group.startMs === null
      ? 1
      : (startMsOccurrences.get(group.startMs) ?? 0) + 1;

    if (group.startMs !== null) {
      startMsOccurrences.set(group.startMs, timestampOccurrence);
    }

    return {
      anchorId: getTranscriptAnchorId(group.startMs, fallbackIndex, timestampOccurrence),
      endMs: group.endMs,
      label: formatTokenTimestamp(group.startMs, fallbackIndex),
      speakerId: group.speakerId,
      speakerClassName: getSpeakerClassName(group.speakerId),
      speakerLabel: group.speakerLabel,
      startMs: group.startMs,
      text: group.text
    };
  });
}

// getSpeakerSummaryMeta renders compact evidence for one detected speaker.
export function getSpeakerSummaryMeta(speaker: TranscriptSpeakerSummary) {
  const firstSeen = speaker.firstStartMs === null
    ? "bez času"
    : `od ${formatTokenTimestamp(speaker.firstStartMs, 0)}`;

  return `${speaker.tokenCount} tokenů · ${firstSeen}`;
}
