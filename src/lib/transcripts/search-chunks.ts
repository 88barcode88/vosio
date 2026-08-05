import {
  flattenTranscriptTokens,
  getStoredTranscriptSpeakerSummaries,
  getTranscriptSpeakerDisplayName,
  getTranscriptSpeakerLabel,
  getTranscriptTokenEndMs,
  getTranscriptTokenSpeakerId,
  getTranscriptTokenStartMs,
  getTranscriptTokenText
} from "@/lib/transcripts/speakers";

export type ConsecutiveTranscriptSpeakerGroup = {
  endMs: number | null;
  speakerId: string | null;
  speakerLabel: string;
  startMs: number | null;
  text: string;
};

export type TranscriptSearchChunk = {
  endMs: number | null;
  position: number;
  speakerLabel: string | null;
  startMs: number | null;
  text: string;
};

export type TranscriptSearchSource = {
  rawText: unknown;
  segments: unknown;
  speakers: unknown;
};

// getSafeTimestamp accepts only offsets that can satisfy the search schema constraints.
function getSafeTimestamp(timestamp: number | null) {
  return timestamp !== null && Number.isFinite(timestamp) && timestamp >= 0
    ? timestamp
    : null;
}

// normalizeSpeakerId treats blank provider ids as missing and stabilizes textual ids.
function normalizeSpeakerId(speakerId: string | null) {
  return speakerId?.trim() || null;
}

// getSafeGroupEnd drops an end offset that precedes the group's first known start.
function getSafeGroupEnd(startMs: number | null, endMs: number | null) {
  return startMs !== null && endMs !== null && endMs < startMs ? null : endMs;
}

// getConsecutiveTranscriptSpeakerGroups is the shared pure token grouping used by UI and search indexing.
export function getConsecutiveTranscriptSpeakerGroups(
  segments: unknown,
  speakers: unknown
): ConsecutiveTranscriptSpeakerGroup[] {
  const tokens = flattenTranscriptTokens(segments);
  const speakerSummaryById = new Map(
    getStoredTranscriptSpeakerSummaries(speakers, segments).map((speaker) => [speaker.id, speaker])
  );

  return tokens.reduce<ConsecutiveTranscriptSpeakerGroup[]>((groups, token) => {
    const text = getTranscriptTokenText(token);

    if (!text.trim()) {
      return groups;
    }

    const speakerId = normalizeSpeakerId(getTranscriptTokenSpeakerId(token));
    const speakerSummary = speakerId ? speakerSummaryById.get(speakerId) : null;
    const speakerLabel = speakerSummary
      ? getTranscriptSpeakerDisplayName(speakerSummary)
      : getTranscriptSpeakerLabel(speakerId);
    const tokenStartMs = getSafeTimestamp(getTranscriptTokenStartMs(token));
    const tokenEndMs = getSafeTimestamp(getTranscriptTokenEndMs(token));
    const previous = groups.at(-1);

    if (previous?.speakerId === speakerId) {
      const startMs = previous.startMs ?? tokenStartMs;
      const endMs = getSafeGroupEnd(startMs, tokenEndMs)
        ?? getSafeGroupEnd(startMs, previous.endMs);

      return [
        ...groups.slice(0, -1),
        {
          ...previous,
          endMs,
          startMs,
          text: `${previous.text}${text}`
        }
      ];
    }

    return [
      ...groups,
      {
        endMs: getSafeGroupEnd(tokenStartMs, tokenEndMs),
        speakerId,
        speakerLabel,
        startMs: tokenStartMs,
        text
      }
    ];
  }, []);
}

// hasRenderableSpeakerGroups mirrors the transcript UI rule for exposing token groups as navigation targets.
export function hasRenderableSpeakerGroups(groups: ConsecutiveTranscriptSpeakerGroup[]) {
  return groups.some((group) => group.speakerId);
}

// buildTranscriptSearchChunks creates ordered index rows and falls back to manual raw text when tokens are absent.
export function buildTranscriptSearchChunks(source: TranscriptSearchSource): TranscriptSearchChunk[] {
  const groups = getConsecutiveTranscriptSpeakerGroups(source.segments, source.speakers);

  if (hasRenderableSpeakerGroups(groups)) {
    return groups.map((group, index) => ({
      endMs: group.endMs,
      position: index + 1,
      speakerLabel: group.speakerId ? group.speakerLabel : null,
      startMs: group.startMs,
      text: group.text
    }));
  }

  const rawText = typeof source.rawText === "string" ? source.rawText.trim() : "";

  if (!rawText) {
    return [];
  }

  return [{
    endMs: null,
    position: 1,
    speakerLabel: null,
    startMs: null,
    text: rawText
  }];
}
