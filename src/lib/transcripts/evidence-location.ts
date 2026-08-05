import {
  flattenTranscriptTokens,
  getTranscriptTokenEndMs,
  getTranscriptTokenStartMs,
  getTranscriptTokenText
} from "@/lib/transcripts/speakers";

export type EvidenceLocation = {
  endMs: number;
  startMs: number;
};

type EvidenceMatch = {
  endToken: unknown;
  startToken: unknown;
};

type CanonicalTokenStream = {
  endTokensByOffset: Map<number, unknown>;
  startTokensByOffset: Map<number, unknown>;
  text: string;
};

// Keeps evidence resolution bounded because prompt evidence is expected to be a short quote.
export const MAX_NORMALIZED_EVIDENCE_QUOTE_LENGTH = 2_000;

// normalizeEvidenceText makes quote comparison insensitive to case, spacing and punctuation.
function normalizeEvidenceText(value: string) {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("cs-CZ")
    .replace(/\p{P}+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// isUsableEvidenceTimestamp keeps values safe for the nonnegative Postgres bigint contract.
function isUsableEvidenceTimestamp(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

// buildCanonicalTokenStream normalizes transcript tokens once and records whole-token boundaries.
function buildCanonicalTokenStream(tokens: unknown[]): CanonicalTokenStream {
  const startTokensByOffset = new Map<number, unknown>();
  const endTokensByOffset = new Map<number, unknown>();
  let text = "";

  for (const token of tokens) {
    const normalizedToken = normalizeEvidenceText(getTranscriptTokenText(token));

    if (!normalizedToken) {
      continue;
    }

    if (text) {
      text += " ";
    }

    const startOffset = text.length;
    text += normalizedToken;
    startTokensByOffset.set(startOffset, token);
    endTokensByOffset.set(text.length, token);
  }

  return { endTokensByOffset, startTokensByOffset, text };
}

// findUniqueEvidenceMatch uses native substring search but accepts only unique whole-token ranges.
function findUniqueEvidenceMatch(stream: CanonicalTokenStream, normalizedQuote: string): EvidenceMatch | null {
  let uniqueMatch: EvidenceMatch | null = null;
  let searchOffset = 0;

  while (searchOffset <= stream.text.length - normalizedQuote.length) {
    const matchOffset = stream.text.indexOf(normalizedQuote, searchOffset);

    if (matchOffset === -1) {
      break;
    }

    const startToken = stream.startTokensByOffset.get(matchOffset);
    const endToken = stream.endTokensByOffset.get(matchOffset + normalizedQuote.length);

    if (startToken && endToken) {
      if (uniqueMatch) {
        return null;
      }

      uniqueMatch = { endToken, startToken };
    }

    searchOffset = matchOffset + 1;
  }

  return uniqueMatch;
}

// resolveEvidenceLocation accepts only one exact normalized quote match with complete saved token timestamps.
export function resolveEvidenceLocation(segments: unknown, quote: string | null | undefined): EvidenceLocation | null {
  const normalizedQuote = typeof quote === "string" ? normalizeEvidenceText(quote) : "";

  if (!normalizedQuote || normalizedQuote.length > MAX_NORMALIZED_EVIDENCE_QUOTE_LENGTH) {
    return null;
  }

  const match = findUniqueEvidenceMatch(
    buildCanonicalTokenStream(flattenTranscriptTokens(segments)),
    normalizedQuote
  );

  if (!match) {
    return null;
  }

  const startMs = getTranscriptTokenStartMs(match.startToken);
  const endMs = getTranscriptTokenEndMs(match.endToken);

  if (!isUsableEvidenceTimestamp(startMs) || !isUsableEvidenceTimestamp(endMs) || endMs < startMs) {
    return null;
  }

  return { endMs, startMs };
}
