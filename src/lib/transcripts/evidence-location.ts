import {
  getTranscriptTokenEndMs,
  getTranscriptTokenSpeakerId,
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
  // Token that produced each UTF-16 offset of text, used to map a matched word range back to timestamps.
  ownersByOffset: unknown[];
  text: string;
};

type EvidenceTextBlock = {
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

// countWholeEvidenceTextMatches counts normalized phrase matches without accepting partial words.
function countWholeEvidenceTextMatches(text: string, quote: string) {
  const haystack = ` ${text} `;
  const needle = ` ${quote} `;
  let count = 0;
  let offset = 0;

  while (offset <= haystack.length - needle.length) {
    const matchOffset = haystack.indexOf(needle, offset);

    if (matchOffset === -1) {
      break;
    }

    count += 1;
    offset = matchOffset + needle.length;
  }

  return count;
}

// resolveUniqueEvidenceTextBlock finds one renderable block when legacy evidence has no timestamps.
export function resolveUniqueEvidenceTextBlock<T extends EvidenceTextBlock>(
  blocks: T[],
  quote: string | null | undefined
): T | null {
  const normalizedQuote = typeof quote === "string" ? normalizeEvidenceText(quote) : "";

  if (!normalizedQuote || normalizedQuote.length > MAX_NORMALIZED_EVIDENCE_QUOTE_LENGTH) {
    return null;
  }

  let uniqueBlock: T | null = null;

  for (const block of blocks) {
    const matchCount = countWholeEvidenceTextMatches(normalizeEvidenceText(block.text), normalizedQuote);

    if (matchCount > 1 || (matchCount === 1 && uniqueBlock)) {
      return null;
    }

    if (matchCount === 1) {
      uniqueBlock = block;
    }
  }

  return uniqueBlock;
}

// isUsableEvidenceTimestamp keeps values safe for the nonnegative Postgres bigint contract.
function isUsableEvidenceTimestamp(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

// isEvidenceBoundaryChar marks characters that normalization turns into a word boundary (whitespace and punctuation).
function isEvidenceBoundaryChar(char: string) {
  return /^[\p{P}\s]$/u.test(char);
}

// listEvidenceTokens flattens segments like flattenTranscriptTokens but marks the first token of each nested segment as a word boundary.
function listEvidenceTokens(segments: unknown) {
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments.flatMap((segment, index) => {
    const nested = (segment as { tokens?: unknown } | null)?.tokens;

    if (!Array.isArray(nested)) {
      return [{ boundaryBefore: false, token: segment }];
    }

    return nested.map((token, tokenIndex) => ({ boundaryBefore: index > 0 && tokenIndex === 0, token }));
  });
}

// isPhraseToken detects a segment-level text (inner whitespace) that, unlike a Soniox sub-word piece, is a complete word group.
function isPhraseToken(text: string) {
  return /\S\s+\S/u.test(text.trim());
}

// buildCanonicalTokenStream rebuilds the spoken text from tokens (a token without leading whitespace continues the previous
// word, as Soniox splits Czech words into pieces), normalizes it like a quote and remembers which token owns each character.
function buildCanonicalTokenStream(tokens: ReturnType<typeof listEvidenceTokens>): CanonicalTokenStream {
  const ownersByOffset: unknown[] = [];
  let text = "";
  let pendingBoundary = false;
  let previousSpeaker: string | null | undefined;

  for (const { boundaryBefore, token } of tokens) {
    const speaker = getTranscriptTokenSpeakerId(token);
    const tokenText = getTranscriptTokenText(token);
    const phrase = isPhraseToken(tokenText);

    if (boundaryBefore || phrase || (previousSpeaker !== undefined && speaker !== previousSpeaker)) {
      pendingBoundary = true;
    }

    previousSpeaker = speaker;

    for (const char of tokenText.normalize("NFC").toLocaleLowerCase("cs-CZ")) {
      if (isEvidenceBoundaryChar(char)) {
        pendingBoundary = true;
        continue;
      }

      if (pendingBoundary && text) {
        text += " ";
        ownersByOffset.push(token);
      }

      pendingBoundary = false;
      text += char;

      for (let unit = 0; unit < char.length; unit += 1) {
        ownersByOffset.push(token);
      }
    }

    if (phrase) {
      pendingBoundary = true;
    }
  }

  return { ownersByOffset, text };
}

// findUniqueEvidenceMatch uses native substring search but accepts only unique whole-word ranges.
function findUniqueEvidenceMatch(stream: CanonicalTokenStream, normalizedQuote: string): EvidenceMatch | null {
  let uniqueMatch: EvidenceMatch | null = null;
  let searchOffset = 0;

  while (searchOffset <= stream.text.length - normalizedQuote.length) {
    const matchOffset = stream.text.indexOf(normalizedQuote, searchOffset);

    if (matchOffset === -1) {
      break;
    }

    const endOffset = matchOffset + normalizedQuote.length;
    const startsOnWord = matchOffset === 0 || stream.text[matchOffset - 1] === " ";
    const endsOnWord = endOffset === stream.text.length || stream.text[endOffset] === " ";

    if (startsOnWord && endsOnWord) {
      if (uniqueMatch) {
        return null;
      }

      uniqueMatch = {
        endToken: stream.ownersByOffset[endOffset - 1],
        startToken: stream.ownersByOffset[matchOffset]
      };
    }

    searchOffset = matchOffset + 1;
  }

  return uniqueMatch;
}

// resolveEvidenceLocation accepts only one exact whole-word normalized quote match with complete saved token timestamps.
export function resolveEvidenceLocation(segments: unknown, quote: string | null | undefined): EvidenceLocation | null {
  const normalizedQuote = typeof quote === "string" ? normalizeEvidenceText(quote) : "";

  if (!normalizedQuote || normalizedQuote.length > MAX_NORMALIZED_EVIDENCE_QUOTE_LENGTH) {
    return null;
  }

  const match = findUniqueEvidenceMatch(
    buildCanonicalTokenStream(listEvidenceTokens(segments)),
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
