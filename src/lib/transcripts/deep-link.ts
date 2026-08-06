import type {
  TranscriptSpeakerBlock,
  TranscriptTarget
} from "@/components/transcript-tabs/types";

export const TRANSCRIPT_DEEP_LINK_MAX_AT_MS = 86_400_000;
export const TRANSCRIPT_DEEP_LINK_MAX_HIGHLIGHT_LENGTH = 120;
export const TRANSCRIPT_RAW_ANCHOR_ID = "transcript-raw";

export type TranscriptDeepLinkRequest = {
  atMs: number | null;
  highlightText: string | null;
};

export type ParsedTranscriptDeepLink = {
  explicitTranscriptTab: boolean;
  request: TranscriptDeepLinkRequest | null;
};

export type ResolvedTranscriptDeepLink = {
  recordingId: string;
  request: TranscriptDeepLinkRequest;
  target: TranscriptTarget;
};

export type TranscriptHighlightPart = {
  highlighted: boolean;
  text: string;
};

type TranscriptDeepLinkQuery = Record<string, string | string[] | undefined>;

// normalizeTranscriptDeepLinkText collapses URL and transcript whitespace for stable matching.
export function normalizeTranscriptDeepLinkText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

// parseTranscriptDeepLink accepts only the canonical single-value transcript URL contract.
export function parseTranscriptDeepLink(query: TranscriptDeepLinkQuery): ParsedTranscriptDeepLink {
  if (query.tab !== "transcript") {
    return { explicitTranscriptTab: false, request: null };
  }

  const atValue = query.at;
  const highlightValue = query.highlight;
  let atMs: number | null = null;
  let highlightText: string | null = null;

  if (typeof atValue !== "undefined") {
    if (typeof atValue !== "string" || !/^(0|[1-9]\d*)$/u.test(atValue)) {
      return { explicitTranscriptTab: true, request: null };
    }

    const parsedAt = Number(atValue);

    if (!Number.isSafeInteger(parsedAt) || parsedAt > TRANSCRIPT_DEEP_LINK_MAX_AT_MS) {
      return { explicitTranscriptTab: true, request: null };
    }

    atMs = parsedAt;
  }

  if (typeof highlightValue !== "undefined") {
    if (typeof highlightValue !== "string") {
      return { explicitTranscriptTab: true, request: null };
    }

    const normalizedHighlight = normalizeTranscriptDeepLinkText(highlightValue);

    if (
      normalizedHighlight.length === 0
      || normalizedHighlight.length > TRANSCRIPT_DEEP_LINK_MAX_HIGHLIGHT_LENGTH
    ) {
      return { explicitTranscriptTab: true, request: null };
    }

    highlightText = normalizedHighlight;
  }

  return {
    explicitTranscriptTab: true,
    request: atMs !== null || highlightText !== null
      ? { atMs, highlightText }
      : null
  };
}

// parseTranscriptDeepLinkSearchParams preserves duplicate relevant values so strict parsing can reject them.
export function parseTranscriptDeepLinkSearchParams(searchParams: URLSearchParams) {
  const query: TranscriptDeepLinkQuery = {};

  for (const key of ["at", "highlight", "tab"] as const) {
    const values = searchParams.getAll(key);

    if (values.length === 1) query[key] = values[0];
    if (values.length > 1) query[key] = values;
  }

  return parseTranscriptDeepLink(query);
}

// transcriptDeepLinkRequestsMatch compares the exact normalized server and browser target signatures.
export function transcriptDeepLinkRequestsMatch(
  left: TranscriptDeepLinkRequest | null,
  right: TranscriptDeepLinkRequest | null
) {
  return left?.atMs === right?.atMs
    && left?.highlightText === right?.highlightText
    && Boolean(left) === Boolean(right);
}

// resolveTranscriptDeepLink maps one safe request onto the current renderable transcript only.
export function resolveTranscriptDeepLink({
  recordingId,
  rawText,
  request,
  speakerBlocks,
  transcriptId
}: {
  recordingId: string;
  rawText: string;
  request: TranscriptDeepLinkRequest;
  speakerBlocks: TranscriptSpeakerBlock[];
  transcriptId: string;
}): ResolvedTranscriptDeepLink | null {
  if (request.atMs !== null) {
    const timedBlock = getTimestampTranscriptBlock(speakerBlocks, request.atMs);
    const anchorId = timedBlock?.anchorId
      ?? (speakerBlocks.length === 0 && rawText.trim() ? TRANSCRIPT_RAW_ANCHOR_ID : undefined);

    if (!anchorId) {
      return null;
    }

    const selectedText = timedBlock?.text ?? rawText;
    const highlightText = request.highlightText
      && includesNormalizedText(selectedText, request.highlightText)
      ? request.highlightText
      : null;

    return {
      recordingId,
      request: { ...request },
      target: {
        anchorId,
        highlightText,
        playback: "seek",
        startMs: request.atMs,
        transcriptId
      }
    };
  }

  if (!request.highlightText) {
    return null;
  }

  const highlightText = request.highlightText;

  if (speakerBlocks.length > 0) {
    const matches = speakerBlocks.flatMap((block) => {
      const matchCount = countNormalizedOccurrences(block.text, highlightText);

      return matchCount === 1 ? [block] : matchCount > 1 ? [block, block] : [];
    });

    if (matches.length !== 1) {
      return null;
    }

    return {
      recordingId,
      request: { ...request },
      target: {
        anchorId: matches[0]?.anchorId,
        highlightText,
        playback: "none",
        startMs: null,
        transcriptId
      }
    };
  }

  if (countNormalizedOccurrences(rawText, highlightText) !== 1) {
    return null;
  }

  return {
    recordingId,
    request: { ...request },
    target: {
      anchorId: TRANSCRIPT_RAW_ANCHOR_ID,
      highlightText,
      playback: "none",
      startMs: null,
      transcriptId
    }
  };
}

// splitTranscriptHighlight returns inert React-safe text parts for one unique normalized match.
export function splitTranscriptHighlight(
  text: string,
  highlightText: string | null | undefined
): TranscriptHighlightPart[] {
  if (!highlightText) {
    return [{ highlighted: false, text }];
  }

  const pattern = createWhitespaceFlexiblePattern(highlightText);
  const matches = Array.from(text.matchAll(pattern));

  if (matches.length !== 1 || typeof matches[0]?.index !== "number") {
    return [{ highlighted: false, text }];
  }

  const match = matches[0];
  const start = match.index;
  const end = start + match[0].length;

  return [
    { highlighted: false, text: text.slice(0, start) },
    { highlighted: true, text: text.slice(start, end) },
    { highlighted: false, text: text.slice(end) }
  ].filter((part) => part.text.length > 0);
}

// getTimestampTranscriptBlock prefers containment, then the next block, then the closest prior block.
function getTimestampTranscriptBlock(
  speakerBlocks: TranscriptSpeakerBlock[],
  atMs: number
) {
  const timedBlocks = speakerBlocks
    .map((block, index) => ({ block, index }))
    .filter((item) => item.block.startMs !== null);
  const containing = timedBlocks.find(({ block }) =>
    block.startMs === atMs
    || (
      block.startMs !== null
      && block.endMs !== null
      && block.startMs < atMs
      && atMs < block.endMs
    )
  );

  if (containing) {
    return containing.block;
  }

  const next = timedBlocks
    .filter(({ block }) => (block.startMs as number) > atMs)
    .sort((left, right) =>
      (left.block.startMs as number) - (right.block.startMs as number)
      || left.index - right.index
      || left.block.anchorId.localeCompare(right.block.anchorId)
    )[0];

  if (next) {
    return next.block;
  }

  return timedBlocks
    .sort((left, right) =>
      Math.abs((left.block.startMs as number) - atMs)
      - Math.abs((right.block.startMs as number) - atMs)
      || (right.block.startMs as number) - (left.block.startMs as number)
      || left.index - right.index
      || left.block.anchorId.localeCompare(right.block.anchorId)
    )[0]?.block ?? null;
}

// includesNormalizedText checks one case-insensitive whitespace-normalized substring.
function includesNormalizedText(text: string, query: string) {
  return normalizeTranscriptDeepLinkText(text).toLocaleLowerCase("cs-CZ")
    .includes(normalizeTranscriptDeepLinkText(query).toLocaleLowerCase("cs-CZ"));
}

// countNormalizedOccurrences counts non-overlapping normalized matches across one renderable block.
function countNormalizedOccurrences(text: string, query: string) {
  return Array.from(text.matchAll(createWhitespaceFlexiblePattern(query))).length;
}

// createWhitespaceFlexiblePattern preserves punctuation while treating collapsed whitespace equally.
function createWhitespaceFlexiblePattern(query: string) {
  const escapedTokens = normalizeTranscriptDeepLinkText(query)
    .split(" ")
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));

  return new RegExp(escapedTokens.join("\\s+"), "giu");
}
