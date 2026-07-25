import {
  flattenTranscriptTokens,
  getStoredTranscriptSpeakerSummaries,
  getTranscriptSpeakerDisplayName,
  getTranscriptTokenEndMs,
  getTranscriptTokenSpeakerId,
  getTranscriptTokenStartMs,
  getTranscriptTokenText
} from "@/lib/transcripts/speakers";

const MAX_AI_SEGMENT_TEXT_CHARS = 1400;
const MAX_AI_SEGMENTS_TOTAL_TEXT_CHARS = 120000;

export type AiTranscriptPromptSegment = {
  end_time: string | null;
  speaker_id: string | null;
  speaker_label: string;
  start_time: string | null;
  text: string;
};

export type AiTranscriptPromptContext = {
  segments: AiTranscriptPromptSegment[];
  total_tokens_seen: number;
  truncated: boolean;
};

// formatPromptTimestamp converts provider millisecond offsets into compact HH:MM:SS prompt timestamps.
function formatPromptTimestamp(value: number | null) {
  if (value === null) {
    return null;
  }

  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

// getPromptSpeakerLabel returns the human speaker name available to AI without exposing full speaker objects.
function getPromptSpeakerLabel(speakerId: string | null, speakerLabels: Map<string, string>) {
  if (!speakerId) {
    return "Mluvčí ?";
  }

  return speakerLabels.get(speakerId) ?? `Mluvčí ${speakerId}`;
}

// shouldAppendToPromptSegment keeps AI prompt segments readable while avoiding huge token-level JSON.
function shouldAppendToPromptSegment(
  segment: AiTranscriptPromptSegment | undefined,
  speakerId: string | null,
  nextTextLength: number
) {
  if (!segment || segment.speaker_id !== speakerId) {
    return false;
  }

  return segment.text.length + nextTextLength <= MAX_AI_SEGMENT_TEXT_CHARS;
}

// createPromptSegment builds one compact speaker utterance for AI prompt context.
function createPromptSegment(input: {
  endMs: number | null;
  speakerId: string | null;
  speakerLabels: Map<string, string>;
  startMs: number | null;
  text: string;
}): AiTranscriptPromptSegment {
  return {
    end_time: formatPromptTimestamp(input.endMs),
    speaker_id: input.speakerId,
    speaker_label: getPromptSpeakerLabel(input.speakerId, input.speakerLabels),
    start_time: formatPromptTimestamp(input.startMs),
    text: input.text
  };
}

// appendPromptTokenText immutably appends one Soniox token into an existing compact segment.
function appendPromptTokenText(
  segment: AiTranscriptPromptSegment,
  text: string,
  endMs: number | null
): AiTranscriptPromptSegment {
  return {
    ...segment,
    end_time: formatPromptTimestamp(endMs) ?? segment.end_time,
    text: `${segment.text}${text}`
  };
}

// buildSpeakerLabelMap prepares manual speaker names for compact AI transcript segments.
function buildSpeakerLabelMap(segments: unknown, speakers: unknown) {
  return new Map(
    getStoredTranscriptSpeakerSummaries(speakers, segments).map((speaker) => [
      speaker.id,
      getTranscriptSpeakerDisplayName(speaker)
    ])
  );
}

// buildAiTranscriptPromptContext compacts token-level Soniox segments before they enter provider prompts.
export function buildAiTranscriptPromptContext(
  segments: unknown,
  speakers: unknown
): AiTranscriptPromptContext {
  const tokens = flattenTranscriptTokens(segments);
  const speakerLabels = buildSpeakerLabelMap(segments, speakers);
  let totalTextChars = 0;
  let truncated = false;

  const compactSegments = tokens.reduce<AiTranscriptPromptSegment[]>((currentSegments, token) => {
    if (truncated) {
      return currentSegments;
    }

    const text = getTranscriptTokenText(token);

    if (!text.trim()) {
      return currentSegments;
    }

    if (totalTextChars + text.length > MAX_AI_SEGMENTS_TOTAL_TEXT_CHARS) {
      truncated = true;
      return currentSegments;
    }

    const speakerId = getTranscriptTokenSpeakerId(token);
    const previousSegment = currentSegments.at(-1);
    const startMs = getTranscriptTokenStartMs(token);
    const endMs = getTranscriptTokenEndMs(token);
    totalTextChars += text.length;

    if (previousSegment && shouldAppendToPromptSegment(previousSegment, speakerId, text.length)) {
      return [
        ...currentSegments.slice(0, -1),
        appendPromptTokenText(previousSegment, text, endMs)
      ];
    }

    return [
      ...currentSegments,
      createPromptSegment({
        endMs,
        speakerId,
        speakerLabels,
        startMs,
        text
      })
    ];
  }, []);

  return {
    segments: compactSegments.map((segment) => ({
      ...segment,
      text: segment.text.trim()
    })),
    total_tokens_seen: tokens.length,
    truncated
  };
}
