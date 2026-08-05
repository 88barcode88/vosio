import { speakerClassNames } from "@/components/transcript-tabs/constants";
import type { TranscriptSpeakerBlock } from "@/components/transcript-tabs/types";
import {
  flattenTranscriptTokens,
  getStoredTranscriptSpeakerSummaries,
  getTranscriptSpeakerDisplayName,
  getTranscriptSpeakerLabel,
  getTranscriptTokenEndMs,
  getTranscriptTokenSpeakerId,
  getTranscriptTokenStartMs,
  getTranscriptTokenText,
  type TranscriptSpeakerSummary
} from "@/lib/transcripts/speakers";
import { getTranscriptAnchorId } from "@/lib/transcripts/navigation";

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

// getSpeakerSummaryById creates a lookup for manual speaker labels in transcript blocks.
function getSpeakerSummaryById(speakers: TranscriptSpeakerSummary[]) {
  return new Map(speakers.map((speaker) => [speaker.id, speaker]));
}

// getTranscriptSpeakerBlocks groups consecutive Soniox tokens by diarized speaker.
export function getTranscriptSpeakerBlocks(segments: unknown, speakers: unknown): TranscriptSpeakerBlock[] {
  const tokens = flattenTranscriptTokens(segments);
  const speakerSummaryById = getSpeakerSummaryById(getStoredTranscriptSpeakerSummaries(speakers, segments));

  if (!tokens.some((token) => getTranscriptTokenSpeakerId(token))) {
    return [];
  }

  const startMsOccurrences = new Map<number, number>();

  return tokens.reduce<TranscriptSpeakerBlock[]>((blocks, token) => {
    const text = getTranscriptTokenText(token);

    if (!text.trim()) {
      return blocks;
    }

    const speaker = getTranscriptTokenSpeakerId(token);
    const speakerSummary = speaker ? speakerSummaryById.get(speaker) : null;
    const speakerLabel = speakerSummary ? getTranscriptSpeakerDisplayName(speakerSummary) : getTranscriptSpeakerLabel(speaker);
    const previous = blocks.at(-1);

    if (previous?.speakerId === speaker) {
      return [
        ...blocks.slice(0, -1),
        {
          ...previous,
          endMs: getTranscriptTokenEndMs(token),
          text: `${previous.text}${text}`
        }
      ];
    }

    const startMs = getTranscriptTokenStartMs(token);
    const fallbackIndex = blocks.length;
    const timestampOccurrence = startMs === null
      ? 1
      : (startMsOccurrences.get(startMs) ?? 0) + 1;

    if (startMs !== null) {
      startMsOccurrences.set(startMs, timestampOccurrence);
    }

    return [
      ...blocks,
      {
        anchorId: getTranscriptAnchorId(startMs, fallbackIndex, timestampOccurrence),
        endMs: getTranscriptTokenEndMs(token),
        label: formatTokenTimestamp(startMs, fallbackIndex),
        speakerId: speaker,
        speakerClassName: getSpeakerClassName(speaker),
        speakerLabel,
        startMs,
        text
      }
    ];
  }, []);
}

// getSpeakerSummaryMeta renders compact evidence for one detected speaker.
export function getSpeakerSummaryMeta(speaker: TranscriptSpeakerSummary) {
  const firstSeen = speaker.firstStartMs === null
    ? "bez času"
    : `od ${formatTokenTimestamp(speaker.firstStartMs, 0)}`;

  return `${speaker.tokenCount} tokenů · ${firstSeen}`;
}
